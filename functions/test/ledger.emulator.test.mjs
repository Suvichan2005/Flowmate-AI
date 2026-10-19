import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { RequestFailure, dayKey, monthKey, validateGenerationBody } from '../lib/policy.js';
import {
  briefingLedgerRefs, failTurn, finishBriefing, finishTurn, reserveBriefing,
  reserveBriefingGenerationCall, reserveGenerationCall, reserveTurn, turnLedgerRefs,
} from '../lib/ledger.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is required; these tests must never run against production');
const app = initializeApp({ projectId: 'demo-flowmate-managed-ai-test' }, 'ledger-test-' + randomUUID());
const db = getFirestore(app);
db.settings({ host, ssl: false });
const uid = () => 'test_' + randomUUID().replaceAll('-', '');
const stableDate = new Date('2026-10-15T12:00:00+05:30');

test('managed requests reject caller-supplied identity, owner, entity, or workspace authority fields', () => {
  const valid = {
    turnId: 'turn_ownership_0001', callId: 'call_ownership_00001',
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }], config: { systemInstruction: '' },
  };
  for (const key of ['uid', 'ownerUid', 'ownerId', 'entityIds', 'workspaceSnapshot']) {
    assert.throws(() => validateGenerationBody({ ...valid, [key]: 'other-user' }), error =>
      error instanceof RequestFailure && error.code === 'INVALID_REQUEST');
  }
});

before(async () => {
  for (const collection of await db.listCollections()) {
    for (const document of await collection.listDocuments()) await document.delete();
  }
  await db.doc('system/managedAi').set({ enabled: true, mode: 'general' });
});
after(async () => { await db.terminate(); });

test('test mode authorizes an exact UID, never an email alone', async () => {
  const allowedUid = uid();
  const blockedUid = uid();
  const email = 'flowmate-managed-ai-smoke@example.com';
  await db.doc('system/managedAi').set({ enabled: true, mode: 'test', allowedTestUids: [allowedUid] });
  const allowed = turnLedgerRefs(db, allowedUid, 'turn_allowlisted_0001', 'call_allowlisted_00001', new Date(), email);
  await reserveTurn(db, allowed);
  assert.equal((await db.doc(`managedAiUsers/${allowedUid}`).get()).exists, true);
  const blocked = turnLedgerRefs(db, blockedUid, 'turn_blocked_uid_0001', 'call_blocked_uid_00001', new Date(), 'unapproved@example.com');
  await assert.rejects(reserveTurn(db, blocked), error => error.code === 'MANAGED_AI_DISABLED');
  await failTurn(db, allowed, false);
  await db.doc('system/managedAi').set({ enabled: true, mode: 'general' });
});

test('privileged identities have no turn, monthly call, or ordinary rate ceiling while usage is still counted', async () => {
  const privilegedUid = uid();
  const email = 'owner-approved@example.test';
  await db.doc(`managedAiAllowlist/${privilegedUid}`).set({ uid: privilegedUid, emailLower: email, status: 'active' });
  for (let index = 0; index < 55; index += 1) {
    const suffix = String(index).padStart(8, '0');
    const now = Date.now() + index * 10;
    const refs = turnLedgerRefs(db, privilegedUid, `privileged_turn_${suffix}`, `privileged_call_${suffix}`, new Date(now), email);
    await reserveTurn(db, refs, now);
    await reserveGenerationCall(db, refs);
    await finishTurn(db, refs, true);
  }
  assert.equal((await db.doc(`managedAiPrivilegedUsers/${privilegedUid}`).get()).get('successfulTurns'), 55);
  const privilegedRefs = turnLedgerRefs(db, privilegedUid, 'privileged_usage_0001', 'privileged_usage_00001', stableDate, email);
  assert.equal((await privilegedRefs.privilegedMonth.get()).get('callsReserved'), 55);
  assert.equal((await privilegedRefs.privilegedUserMonth.get()).get('callsReserved'), 55);

  const currentPrivilegedMonth = turnLedgerRefs(db, privilegedUid, 'privileged_over_500', 'privileged_call_over_500', new Date(), email);
  await currentPrivilegedMonth.privilegedMonth.set({ callsReserved: 500 }, { merge: true });
  await reserveTurn(db, currentPrivilegedMonth);
  await reserveGenerationCall(db, currentPrivilegedMonth);
  assert.equal((await currentPrivilegedMonth.privilegedMonth.get()).get('callsReserved'), 501);
  await finishTurn(db, currentPrivilegedMonth, true);

  await db.doc(`managedAiAllowlist/${privilegedUid}`).set({ status: 'revoked' }, { merge: true });
  const revoked = turnLedgerRefs(db, privilegedUid, 'privileged_revoked_0001', 'privileged_revoked_00001', new Date(), email);
  await reserveTurn(db, revoked);
  assert.equal(revoked.isPrivileged, false);
  await failTurn(db, revoked, false);
});

test('failed requests release the reservation; account allowance counts 150 successful turns', async () => {
  const userId = uid();
  const failed = turnLedgerRefs(db, userId, 'turn_failed_0000001', 'call_failed_00000001');
  await reserveTurn(db, failed);
  await failTurn(db, failed, false);
  for (let index = 0; index < 150; index += 1) {
    const suffix = String(index).padStart(8, '0');
    const now = Date.now() + index * 66_000;
    const refs = turnLedgerRefs(db, userId, `turn_success_${suffix}`, `call_success_${suffix}`, stableDate);
    await reserveTurn(db, refs, now);
    await reserveGenerationCall(db, refs);
    await finishTurn(db, refs, true);
  }
  const exhausted = turnLedgerRefs(db, userId, 'turn_allowance_exhausted_01', 'call_allowance_exhausted_01');
  await assert.rejects(reserveTurn(db, exhausted), error => error.code === 'TURN_ALLOWANCE_EXHAUSTED');
  assert.equal((await db.doc(`managedAiUsers/${userId}`).get()).get('successfulTurns'), 150);
});

test('guests receive 30 chat turns per month separate from account records', async () => {
  const guestId = uid();
  for (let index = 0; index < 30; index += 1) {
    const suffix = String(index).padStart(8, '0');
    const now = Date.now() + index * 66_000;
    const refs = turnLedgerRefs(db, guestId, `guest_success_${suffix}`, `guest_call_${suffix}`, stableDate, undefined, 'guest');
    await reserveTurn(db, refs, now);
    await reserveGenerationCall(db, refs);
    await finishTurn(db, refs, true);
  }
  assert.equal((await db.doc(`managedAiGuests/${guestId}`).get()).get('successfulTurns'), 30);
  const exhausted = turnLedgerRefs(db, guestId, 'guest_allowance_exhausted_01', 'guest_call_allowance_exhausted_01', new Date(), undefined, 'guest');
  await assert.rejects(reserveTurn(db, exhausted), error => error.code === 'GUEST_TURN_ALLOWANCE_EXHAUSTED');
  const accountRefs = turnLedgerRefs(db, guestId, 'account_success_00000000', 'account_call_00000000');
  await reserveTurn(db, accountRefs);
  assert.equal((await db.doc(`managedAiUsers/${guestId}`).get()).get('reservedTurns'), 1);
  await failTurn(db, accountRefs, false);
});

test('briefings have a separate monthly quota and failed model calls do not consume a successful briefing', async () => {
  const guestId = uid();
  const date = new Date();
  const first = briefingLedgerRefs(db, guestId, 'briefing_failed_0001', date, undefined, 'guest');
  const globalCallsBefore = Number((await first.month.get()).get('callsReserved') || 0);
  await reserveBriefing(db, first);
  await reserveBriefingGenerationCall(db, first);
  await finishBriefing(db, first, false);
  assert.equal((await first.userMonth.get()).get('successfulBriefings') || 0, 0);
  assert.equal((await first.month.get()).get('callsReserved'), globalCallsBefore + 1);

  for (let index = 0; index < 90; index += 1) {
    const refs = briefingLedgerRefs(db, guestId, `briefing_success_${String(index).padStart(8, '0')}`, date, undefined, 'guest');
    await reserveBriefing(db, refs, Date.now() + (index + 1) * 60_001);
    await reserveBriefingGenerationCall(db, refs);
    await finishBriefing(db, refs, true);
  }
  assert.equal((await first.userMonth.get()).get('successfulBriefings'), 90);
  const next = briefingLedgerRefs(db, guestId, 'briefing_success_00000090', date, undefined, 'guest');
  await assert.rejects(reserveBriefing(db, next), error => error.code === 'BRIEFING_ALLOWANCE_EXHAUSTED');

  const chat = turnLedgerRefs(db, guestId, 'chat_independent_0001', 'chat_independent_00001', stableDate, undefined, 'guest');
  await reserveTurn(db, chat);
  await failTurn(db, chat, false);
});

test('monthly allowances reset in the next Asia/Kolkata calendar month', async () => {
  const guestId = uid();
  const october = new Date('2026-10-15T12:00:00+05:30');
  const november = new Date('2026-11-01T00:05:00+05:30');
  const prior = turnLedgerRefs(db, guestId, 'turn_october_month_0001', 'call_october_month_0001', october, undefined, 'guest');
  await reserveTurn(db, prior);
  await reserveGenerationCall(db, prior);
  await finishTurn(db, prior, true);
  const nextMonth = turnLedgerRefs(db, guestId, 'turn_november_month_0001', 'call_november_month_0001', november, undefined, 'guest');
  await reserveTurn(db, nextMonth);
  assert.equal((await nextMonth.userMonth.get()).get('successfulTurns'), undefined);
  await failTurn(db, nextMonth, false);

  const briefing = briefingLedgerRefs(db, guestId, 'briefing_october_month_01', october, undefined, 'guest');
  await reserveBriefing(db, briefing);
  await reserveBriefingGenerationCall(db, briefing);
  await finishBriefing(db, briefing, true);
  const nextMonthBriefing = briefingLedgerRefs(db, guestId, 'briefing_november_month_01', november, undefined, 'guest');
  await reserveBriefing(db, nextMonthBriefing);
  await finishBriefing(db, nextMonthBriefing, false);
});

test('only one overlapping request succeeds for a UID', async () => {
  const userId = uid();
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => {
    const refs = turnLedgerRefs(db, userId, 'turn_' + String(index).padStart(16, '0'), 'call_' + String(index).padStart(16, '0'));
    return reserveTurn(db, refs);
  }));
  assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(value => value.status === 'rejected' && value.reason instanceof RequestFailure && value.reason.code === 'USER_CALL_IN_PROGRESS').length, 19);
  assert.equal((await db.doc(`managedAiUsers/${userId}`).get()).get('reservedTurns'), 1);
});

test('failed provider attempts remain in the per-user and global monthly call ledgers', async () => {
  const userId = uid();
  const refs = turnLedgerRefs(db, userId, 'turn_billable_00001', 'call_billable_000001');
  const globalCallsBefore = Number((await refs.month.get()).get('callsReserved') || 0);
  await reserveTurn(db, refs);
  await reserveGenerationCall(db, refs);
  await failTurn(db, refs, true);
  assert.equal((await refs.month.get()).get('callsReserved'), globalCallsBefore + 1);
  assert.equal((await refs.userMonth.get()).get('callsReserved'), 1);
  assert.equal((await refs.call.get()).get('status'), 'failed');
});

test('short-term per-UID rate limit rejects the 21st reservation in a minute', async () => {
  const userId = uid();
  for (let index = 0; index < 20; index += 1) {
    const suffix = String(index).padStart(8, '0');
    const refs = turnLedgerRefs(db, userId, `turn_rate_${suffix}`, `call_rate_${suffix}`);
    await reserveTurn(db, refs);
    await failTurn(db, refs, false);
  }
  const blocked = turnLedgerRefs(db, userId, 'turn_rate_blocked', 'call_rate_blocked_01');
  await assert.rejects(reserveTurn(db, blocked), error => error.code === 'RATE_LIMITED');
});

test('ordinary model-call usage remains observable without an artificial monthly application ceiling', async () => {
  const monthRef = db.doc(`managedAiMonthly/${monthKey(new Date())}`);
  await monthRef.set({ callsReserved: 500 });
  const results = [];
  for (let index = 0; index < 20; index += 1) {
    const refs = turnLedgerRefs(db, uid(), 'turn_global_' + String(index).padStart(12, '0'), 'call_global_' + String(index).padStart(12, '0'));
    try { await reserveGenerationCall(db, refs); results.push({ status: 'fulfilled' }); }
    catch (error) { results.push({ status: 'rejected', reason: error }); }
  }
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 20);
  assert.equal((await monthRef.get()).get('callsReserved'), 520);

  const mixedUid = uid();
  const briefing = briefingLedgerRefs(db, mixedUid, 'briefing_shared_budget', new Date());
  await reserveBriefing(db, briefing);
  await reserveBriefingGenerationCall(db, briefing);
  assert.equal((await monthRef.get()).get('callsReserved'), 521, 'monthly call metadata is telemetry, not a shared quota');
  await finishBriefing(db, briefing, false);
});

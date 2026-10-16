import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { RequestFailure, monthKey } from '../lib/policy.js';
import { failTurn, finishTurn, reserveGenerationCall, reserveTurn, turnLedgerRefs } from '../lib/ledger.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is required; these tests must never run against production');
const app = initializeApp({ projectId: 'demo-flowmate-managed-ai-test' }, 'ledger-test-' + randomUUID());
const db = getFirestore(app);
db.settings({ host, ssl: false });
const uid = () => 'test_' + randomUUID().replaceAll('-', '');

before(async () => { await db.doc('system/managedAi').set({ enabled: true }); });
after(async () => { await db.terminate(); });

test('only one overlapping reservation succeeds for a UID', async () => {
  const userId = uid();
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => {
    const refs = turnLedgerRefs(db, userId, 'turn_' + String(index).padStart(16, '0'), 'call_' + String(index).padStart(16, '0'));
    return reserveTurn(db, refs);
  }));
  assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(value => value.status === 'rejected' && value.reason instanceof RequestFailure && value.reason.code === 'USER_CALL_IN_PROGRESS').length, 19);
  assert.equal((await db.doc('managedAiUsers/' + userId).get()).get('reservedTurns'), 1);
});

test('failed requests release the user slot; exactly ten successes consume lifetime allowance', async () => {
  const userId = uid();
  const failed = turnLedgerRefs(db, userId, 'turn_failed_0000001', 'call_failed_00000001');
  await reserveTurn(db, failed);
  await failTurn(db, failed, false);

  for (let index = 0; index < 10; index += 1) {
    const suffix = String(index).padStart(8, '0');
    const refs = turnLedgerRefs(db, userId, 'turn_success_' + suffix, 'call_success_' + suffix);
    await reserveTurn(db, refs);
    await reserveGenerationCall(db, refs);
    await finishTurn(db, refs, true);
  }
  const exhausted = turnLedgerRefs(db, userId, 'turn_success_00000010', 'call_success_00000010');
  await assert.rejects(reserveTurn(db, exhausted), error => error.code === 'TURN_ALLOWANCE_EXHAUSTED');
  assert.equal((await db.doc('managedAiUsers/' + userId).get()).get('successfulTurns'), 10);
});

test('billable generation attempts remain charged even when the user turn fails', async () => {
  const userId = uid();
  const refs = turnLedgerRefs(db, userId, 'turn_billable_00001', 'call_billable_000001', new Date('2099-01-02T00:00:00.000Z'));
  await reserveTurn(db, refs);
  await reserveGenerationCall(db, refs);
  await failTurn(db, refs, true);

  assert.equal((await refs.month.get()).get('callsReserved'), 1);
  assert.equal((await db.doc('managedAiUsers/' + userId).get()).get('successfulTurns') || 0, 0);
  assert.equal((await refs.call.get()).get('status'), 'failed');
});

test('short-term per-UID rate limit rejects the 21st reservation in a minute', async () => {
  const userId = uid();
  for (let index = 0; index < 20; index += 1) {
    const suffix = String(index).padStart(8, '0');
    const refs = turnLedgerRefs(db, userId, 'turn_rate_' + suffix, 'call_rate_' + suffix);
    await reserveTurn(db, refs);
    await failTurn(db, refs, false);
  }
  const blocked = turnLedgerRefs(db, userId, 'turn_rate_blocked', 'call_rate_blocked_01');
  await assert.rejects(reserveTurn(db, blocked), error => error.code === 'RATE_LIMITED');
});

test('global monthly reservation remains at exactly 500 under concurrent users', async () => {
  const monthRef = db.doc('managedAiMonthly/' + monthKey(new Date()));
  await monthRef.set({ callsReserved: 499 });
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => {
    const refs = turnLedgerRefs(db, uid(), 'turn_global_' + String(index).padStart(12, '0'), 'call_global_' + String(index).padStart(12, '0'));
    return reserveGenerationCall(db, refs);
  }));
  const successes = results.filter(value => value.status === 'fulfilled').length;
  const rejected = results.filter(value => value.status === 'rejected' && value.reason instanceof RequestFailure && value.reason.code === 'GLOBAL_LIMIT_REACHED').length;
  assert.equal(successes, 1);
  assert.equal(rejected, 19);
  assert.equal((await monthRef.get()).get('callsReserved'), 500);
});

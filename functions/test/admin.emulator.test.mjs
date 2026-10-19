import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { handleManagedAiAdmin } from '../lib/admin.js';
import { reserveTurn, turnLedgerRefs, failTurn } from '../lib/ledger.js';

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!authHost || !firestoreHost) throw new Error('Auth and Firestore emulator hosts are required; these tests never run against production');
const app = initializeApp({ projectId: 'demo-flowmate-managed-ai-test' });
const auth = getAuth(app);
const db = getFirestore(app);
db.settings({ host: firestoreHost, ssl: false });

function invoke(method, body, identity) {
  const req = { path: '/admin/access', method, body };
  const res = {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
  return handleManagedAiAdmin(db, req, res, identity, 50).then(() => res);
}

let owner;
let other;
before(async () => {
  for (const collection of await db.listCollections()) {
    for (const document of await collection.listDocuments()) await document.delete();
  }
  owner = await auth.createUser({ email: `owner-${randomUUID()}@example.test`, emailVerified: true });
  other = await auth.createUser({ email: `other-${randomUUID()}@example.test`, emailVerified: true });
  await db.doc('system/managedAi').set({ adminUids: [owner.uid], enabled: true, mode: 'general' });
});
after(async () => { await db.terminate(); });

test('admin routes are server-side UID restricted', async () => {
  const response = await invoke('GET', undefined, { uid: other.uid, email: other.email, emailVerified: true, anonymous: false });
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.error.code, 'ADMIN_REQUIRED');
});

test('owner can grant only the exact verified Firebase UID and revoke immediately', async () => {
  const target = await auth.createUser({ email: `target-${randomUUID()}@example.test`, emailVerified: true });
  const ownerIdentity = { uid: owner.uid, email: owner.email, emailVerified: true, anonymous: false };
  const granted = await invoke('POST', { action: 'add', email: target.email }, ownerIdentity);
  assert.equal(granted.statusCode, 200);
  assert.equal(granted.payload.status, 'active');
  assert.equal(granted.payload.uid, target.uid);
  assert.equal((await db.doc(`managedAiAllowlist/${target.uid}`).get()).get('emailLower'), target.email.toLowerCase());

  const revoked = await invoke('POST', { action: 'revoke', target: target.email }, ownerIdentity);
  assert.equal(revoked.statusCode, 200);
  assert.equal((await db.doc(`managedAiAllowlist/${target.uid}`).get()).get('status'), 'revoked');
});

test('pending email invitation activates only for the matching verified UID', async () => {
  const pendingEmail = `pending-${randomUUID()}@example.test`;
  const ownerIdentity = { uid: owner.uid, email: owner.email, emailVerified: true, anonymous: false };
  const pending = await invoke('POST', { action: 'add', email: pendingEmail }, ownerIdentity);
  assert.equal(pending.payload.status, 'pending');
  const target = await auth.createUser({ email: pendingEmail, emailVerified: false });
  await auth.updateUser(target.uid, { emailVerified: true });
  const refs = turnLedgerRefs(db, target.uid, 'pending_invite_turn0001', 'pending_invite_call0001', new Date(), pendingEmail, 'account', 50);
  await reserveTurn(db, refs);
  assert.equal(refs.isPrivileged, true);
  assert.equal((await db.doc(`managedAiAllowlist/${target.uid}`).get()).get('status'), 'active');
  await failTurn(db, refs, false);
});

test('owner kill switch changes are audited atomically', async () => {
  const identity = { uid: owner.uid, email: owner.email, emailVerified: true, anonymous: false };
  const response = await invoke('POST', { action: 'setEnabled', enabled: false }, identity);
  assert.equal(response.statusCode, 200);
  assert.equal((await db.doc('system/managedAi').get()).get('enabled'), false);
  assert.equal((await db.collection('managedAiAdminAudit').where('action', '==', 'managed_ai_disable').get()).size, 1);
});

test('managed AI cannot be enabled without owner-set budget protection', async () => {
  const identity = { uid: owner.uid, email: owner.email, emailVerified: true, anonymous: false };
  await db.doc('system/managedAi').set({ enabled: false, mode: 'general' }, { merge: true });
  await db.doc('system/managedAiBudgetPolicy').delete();
  const denied = await invoke('POST', { action: 'setEnabled', enabled: true }, identity);
  assert.equal(denied.statusCode, 409);
  assert.equal(denied.payload.error.code, 'MANAGED_AI_BUDGET_UNAVAILABLE');
  assert.equal((await db.doc('system/managedAi').get()).get('enabled'), false);

  const configured = await invoke('POST', {
    action: 'setBudgetPolicy', projectMonthlyLimitCents: 1000,
    userMonthlyLimitCents: 500, maxTurnExposureCents: 100,
  }, identity);
  assert.equal(configured.statusCode, 200);
  const policy = await db.doc('system/managedAiBudgetPolicy').get();
  assert.equal(policy.get('projectMonthlyLimitMicroUsd'), 10_000_000);
  assert.equal(policy.get('userMonthlyLimitMicroUsd'), 5_000_000);
  await db.doc('system/managedAiBudgetPolicy').set({ emergencyStop: true, emergencyStopReason: 'test' }, { merge: true });
  const editedWhileStopped = await invoke('POST', {
    action: 'setBudgetPolicy', projectMonthlyLimitCents: 1200,
    userMonthlyLimitCents: 600, maxTurnExposureCents: 120,
  }, identity);
  assert.equal(editedWhileStopped.statusCode, 200);
  assert.equal((await db.doc('system/managedAiBudgetPolicy').get()).get('emergencyStop'), true);
  const blockedByStop = await invoke('POST', { action: 'setEnabled', enabled: true }, identity);
  assert.equal(blockedByStop.statusCode, 409);
  const cleared = await invoke('POST', { action: 'clearEmergencyStop' }, identity);
  assert.equal(cleared.statusCode, 200);
  const enabled = await invoke('POST', { action: 'setEnabled', enabled: true }, identity);
  assert.equal(enabled.statusCode, 200);
  assert.equal((await db.doc('system/managedAi').get()).get('enabled'), true);
  await db.doc('system/managedAi').set({ enabled: false, mode: 'general' }, { merge: true });
  await db.doc('system/managedAiBudgetPolicy').delete();
});

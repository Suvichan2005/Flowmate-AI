import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { handleManagedAiAdmin } from '../lib/admin.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is required; this test never runs against production');
const app = initializeApp({ projectId: 'demo-flowmate-managed-ai-test' }, `budget-admin-${randomUUID()}`);
const db = getFirestore(app);
db.settings({ host, ssl: false });
const owner = { uid: `budget-owner-${randomUUID()}`, email: 'budget-owner@example.test', emailVerified: true, anonymous: false };
const wrongOwner = { ...owner, uid: `not-owner-${randomUUID()}` };
const controlRef = db.doc('system/managedAi');
const policyRef = db.doc('system/managedAiBudgetPolicy');
let priorControl;
let priorPolicy;

async function invoke(body, identity = owner) {
  const req = { path: '/admin/access', method: 'POST', body };
  const res = { statusCode: 200, payload: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } };
  await handleManagedAiAdmin(db, req, res, identity, 50);
  return res;
}

before(async () => {
  [priorControl, priorPolicy] = await Promise.all([controlRef.get(), policyRef.get()]);
  const priorUids = Array.isArray(priorControl.get('adminUids')) ? priorControl.get('adminUids') : [];
  await controlRef.set({ adminUids: [...new Set([...priorUids, owner.uid])], enabled: false, mode: 'general' }, { merge: true });
  await policyRef.delete();
});

after(async () => {
  const audit = await db.collection('managedAiAdminAudit').where('actorUid', '==', owner.uid).get();
  await Promise.all(audit.docs.map(document => document.ref.delete()));
  if (priorControl.exists) await controlRef.set(priorControl.data()); else await controlRef.delete();
  if (priorPolicy.exists) await policyRef.set(priorPolicy.data()); else await policyRef.delete();
  await db.terminate();
});

test('owner budget route validates policy, preserves emergency stop, and gates managed text activation', async () => {
  const deniedOwner = await invoke({ action: 'setBudgetPolicy', projectMonthlyLimitCents: 1000, userMonthlyLimitCents: 500, maxTurnExposureCents: 100 }, wrongOwner);
  assert.equal(deniedOwner.statusCode, 403);

  const invalid = await invoke({ action: 'setBudgetPolicy', projectMonthlyLimitCents: 100, userMonthlyLimitCents: 500, maxTurnExposureCents: 600 });
  assert.equal(invalid.statusCode, 400);

  const noPolicy = await invoke({ action: 'setEnabled', enabled: true });
  assert.equal(noPolicy.statusCode, 409);
  assert.equal((await controlRef.get()).get('enabled'), false);

  const configured = await invoke({ action: 'setBudgetPolicy', projectMonthlyLimitCents: 1000, userMonthlyLimitCents: 500, maxTurnExposureCents: 100 });
  assert.equal(configured.statusCode, 200);
  const policy = await policyRef.get();
  assert.equal(policy.get('projectMonthlyLimitMicroUsd'), 10_000_000);
  assert.equal(policy.get('userMonthlyLimitMicroUsd'), 5_000_000);
  assert.equal(policy.get('maxTurnExposureMicroUsd'), 1_000_000);

  await policyRef.set({ emergencyStop: true, emergencyStopReason: 'test' }, { merge: true });
  const edited = await invoke({ action: 'setBudgetPolicy', projectMonthlyLimitCents: 1200, userMonthlyLimitCents: 600, maxTurnExposureCents: 120 });
  assert.equal(edited.statusCode, 200);
  assert.equal((await policyRef.get()).get('emergencyStop'), true);
  assert.equal((await invoke({ action: 'setEnabled', enabled: true })).statusCode, 409);
  assert.equal((await invoke({ action: 'clearEmergencyStop' })).statusCode, 200);
  assert.equal((await invoke({ action: 'setEnabled', enabled: true })).statusCode, 200);
  assert.equal((await invoke({ action: 'setEnabled', enabled: false })).statusCode, 200);
});

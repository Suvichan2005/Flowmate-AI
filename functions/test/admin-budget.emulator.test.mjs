import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { handleManagedAiAdmin } from '../lib/admin.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is required; this test never runs against production');
const app = initializeApp({ projectId: 'demo-flowmate-managed-ai-test' }, `budget-admin-${randomUUID()}`);
const db = getFirestore(app);
db.settings({ host, ssl: false });
const owner = { uid: `budget-owner-${randomUUID()}`, email: 'budget-owner@example.test', emailVerified: true, anonymous: false };
const wrongOwner = { ...owner, uid: `not-owner-${randomUUID()}` };
const controlRef = db.doc('system/managedAi');
const liveControlRef = db.doc('system/managedLive');
const policyRef = db.doc('system/managedAiBudgetPolicy');
let priorControl;
let priorLiveControl;
let priorPolicy;
let reconciliationFixture;

async function invoke(body, identity = owner) {
  const req = { path: '/admin/access', method: 'POST', body };
  const res = { statusCode: 200, payload: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } };
  await handleManagedAiAdmin(db, req, res, identity, 50);
  return res;
}

async function readOverview(identity = owner) {
  const req = { path: '/admin/access', method: 'GET', body: undefined };
  const res = { statusCode: 200, payload: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } };
  await handleManagedAiAdmin(db, req, res, identity, 50);
  return res;
}

before(async () => {
  [priorControl, priorLiveControl, priorPolicy] = await Promise.all([controlRef.get(), liveControlRef.get(), policyRef.get()]);
  const priorUids = Array.isArray(priorControl.get('adminUids')) ? priorControl.get('adminUids') : [];
  await controlRef.set({ adminUids: [...new Set([...priorUids, owner.uid])], enabled: false, mode: 'general' }, { merge: true });
  await policyRef.delete();
});

after(async () => {
  const audit = await db.collection('managedAiAdminAudit').where('actorUid', '==', owner.uid).get();
  await Promise.all(audit.docs.map(document => document.ref.delete()));
  if (reconciliationFixture) await Promise.all(reconciliationFixture.map(ref => ref.delete()));
  if (priorControl.exists) await controlRef.set(priorControl.data()); else await controlRef.delete();
  if (priorLiveControl.exists) await liveControlRef.set(priorLiveControl.data()); else await liveControlRef.delete();
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
  assert.equal((await invoke({ action: 'setLiveEnabled', enabled: true })).statusCode, 409);
  assert.equal((await controlRef.get()).get('enabled'), false);

  const configured = await invoke({ action: 'setBudgetPolicy', projectMonthlyLimitCents: 1000, userMonthlyLimitCents: 500, maxTurnExposureCents: 100 });
  assert.equal(configured.statusCode, 200);
  const policy = await policyRef.get();
  assert.equal(policy.get('projectMonthlyLimitMicroUsd'), 10_000_000);
  assert.equal(policy.get('userMonthlyLimitMicroUsd'), 5_000_000);
  assert.equal(policy.get('maxTurnExposureMicroUsd'), 1_000_000);
  assert.equal((await invoke({ action: 'setLiveEnabled', enabled: true })).statusCode, 409, 'Live stays unavailable while managed access is disabled');

  await policyRef.set({ emergencyStop: true, emergencyStopReason: 'test' }, { merge: true });
  const edited = await invoke({ action: 'setBudgetPolicy', projectMonthlyLimitCents: 1200, userMonthlyLimitCents: 600, maxTurnExposureCents: 120 });
  assert.equal(edited.statusCode, 200);
  assert.equal((await policyRef.get()).get('emergencyStop'), true);
  assert.equal((await invoke({ action: 'setEnabled', enabled: true })).statusCode, 409);
  assert.equal((await invoke({ action: 'setLiveEnabled', enabled: true })).statusCode, 409);
  assert.equal((await invoke({ action: 'clearEmergencyStop' })).statusCode, 200);

  await policyRef.set({ maxTurnExposureMicroUsd: 100_000 }, { merge: true });
  assert.equal((await invoke({ action: 'setLiveEnabled', enabled: true })).statusCode, 409);
  await policyRef.set({ maxTurnExposureMicroUsd: 1_200_000 }, { merge: true });

  await controlRef.set({ enabled: true, mode: 'test', allowedTestUids: ['test-live-uid'] }, { merge: true });
  const overview = await readOverview();
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.payload.managedMode, 'test');
  assert.equal(overview.payload.liveEnableReady, true);
  assert.equal((await invoke({ action: 'setLiveEnabled', enabled: true })).statusCode, 200);
  const enabledLiveControl = await controlRef.get();
  assert.equal(enabledLiveControl.get('mode'), 'test');
  assert.deepEqual(enabledLiveControl.get('allowedTestUids'), ['test-live-uid']);
  assert.equal((await db.doc('system/managedLive').get()).get('enabled'), true);
  assert.equal((await invoke({ action: 'setLiveEnabled', enabled: false })).statusCode, 200);

  assert.equal((await invoke({ action: 'setEnabled', enabled: true })).statusCode, 200);
  assert.equal((await invoke({ action: 'setEnabled', enabled: false })).statusCode, 200);
});

test('owner can inspect and evidence-reconcile a stale uncertain reservation once', async () => {
  const month = '2026-10';
  const hash = 'a'.repeat(64);
  const callId = 'b'.repeat(64);
  const projectRef = db.doc(`managedAiCostProjectMonthly/${month}`);
  const userRef = db.doc(`managedAiCostUserMonthly/${month}_${hash}`);
  const turnRef = db.doc(`managedAiTurns/${hash}`);
  const callRef = db.doc(`managedAiCalls/${callId}`);
  reconciliationFixture = [projectRef, userRef, turnRef, callRef];
  await Promise.all([
    projectRef.set({ reservedMicroUsd: 500_000, settledMicroUsd: 125_000 }),
    userRef.set({ reservedMicroUsd: 500_000, settledMicroUsd: 125_000 }),
    turnRef.set({ costReservedMicroUsd: 500_000, costSettledMicroUsd: 0 }),
    callRef.set({
      costStatus: 'uncertain', costMonth: month, purpose: 'chat', model: 'gemini-3.8-flash',
      costReservedMicroUsd: 500_000, costInputTokens: 12_000, costMaximumOutputTokens: 8_192,
      costUserBudgetPath: userRef.path, costTurnPath: turnRef.path,
      costUncertainAt: Timestamp.fromMillis(Date.now() - 30 * 60_000),
    }),
  ]);

  const listed = await invoke({ action: 'listUncertainCostReservations' });
  assert.equal(listed.statusCode, 200);
  const reservation = listed.payload.reservations.find(value => value.callId === callId);
  assert.equal(reservation.reconciliationReady, true);
  assert.equal(reservation.reservedMicroUsd, 500_000);
  assert.equal(Object.hasOwn(reservation, 'uid'), false);
  assert.equal((await invoke({ action: 'listUncertainCostReservations' }, wrongOwner)).statusCode, 403);

  const result = await invoke({
    action: 'reconcileCostReservation', callId, decision: 'confirmed_not_billed',
    evidenceRef: 'provider-incident-2026-10-20-001',
  });
  assert.equal(result.statusCode, 200);
  assert.equal((await callRef.get()).get('costStatus'), 'released_confirmed_not_billed');
  assert.equal((await projectRef.get()).get('reservedMicroUsd'), 0);
  assert.equal((await userRef.get()).get('reservedMicroUsd'), 0);
  assert.equal((await turnRef.get()).get('costReservedMicroUsd'), 0);
  assert.equal((await projectRef.get()).get('settledMicroUsd'), 125_000);
  assert.equal((await invoke({
    action: 'reconcileCostReservation', callId, decision: 'confirmed_not_billed',
    evidenceRef: 'provider-incident-2026-10-20-001',
  })).statusCode, 409);
});

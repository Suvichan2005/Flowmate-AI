import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-flowmate-managed-ai-test';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!authHost || !firestoreHost) throw new Error('Auth and Firestore emulator hosts are required; these tests must never run against production');
const app = initializeApp({ projectId }, 'http-test-' + randomUUID());
const db = getFirestore(app);
db.settings({ host: firestoreHost, ssl: false });
const endpoint = `http://127.0.0.1:5001/${projectId}/asia-south1/managedGemini`;
const appCheckRequired = process.env.APP_CHECK_REQUIRED === 'true';
let anonymousIdToken;
let guestUid;
let unverifiedAccountToken;
let unverifiedAccountUid;

before(async () => {
  await db.doc('system/managedAi').delete(); // absent kill switch must fail closed
  const anonymousResponse = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  assert.equal(anonymousResponse.status, 200, 'anonymous identity must come from Firebase Auth Emulator');
  const anonymous = await anonymousResponse.json();
  anonymousIdToken = anonymous.idToken;
  guestUid = anonymous.localId;

  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `managed-test-${randomUUID()}@example.test`, password: 'test-only-password-123', returnSecureToken: true }),
  });
  assert.equal(response.status, 200, 'test identity must come from Firebase Auth Emulator');
  const account = await response.json();
  unverifiedAccountToken = account.idToken;
  unverifiedAccountUid = account.localId;
});
after(async () => { await db.terminate(); });

test('rejects unexpected browser origins before authentication', async () => {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Origin: 'https://not-flowmate.invalid', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 403);
});

test('rejects requests without a verified Firebase identity', async () => {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Origin: 'https://flowmate-ai.web.app', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
});

test('rejects caller-supplied ownership and workspace identifiers before usage reservation', { skip: appCheckRequired }, async () => {
  const monthlyBefore = await db.collection('managedAiMonthly').get();
  const callsBefore = monthlyBefore.docs.reduce((sum, doc) => sum + Number(doc.get('callsReserved') || 0), 0);
  const response = await fetch(endpoint, {
    method: 'POST', headers: {
      Origin: 'https://flowmate-ai.web.app', Authorization: `Bearer ${anonymousIdToken}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify({
      turnId: 'turn_owner_reject_0001', callId: 'call_owner_reject_0001', ownerUid: 'victim-user',
      contents: [{ role: 'user', parts: [{ text: 'This must not call Gemini' }] }], config: { systemInstruction: 'test' },
    }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
  assert.equal((await db.doc(`managedAiGuests/${guestUid}`).get()).exists, false);
  const monthlyAfter = await db.collection('managedAiMonthly').get();
  assert.equal(monthlyAfter.docs.reduce((sum, doc) => sum + Number(doc.get('callsReserved') || 0), 0), callsBefore);
});

test('unverified email/password accounts are rejected before any usage reservation', async () => {
  const response = await fetch(endpoint, {
    method: 'POST', headers: {
      Origin: 'https://flowmate-ai.web.app', Authorization: `Bearer ${unverifiedAccountToken}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify({
      turnId: 'turn_unverified_0001', callId: 'call_unverified_0001',
      contents: [{ role: 'user', parts: [{ text: 'This must not call Gemini' }] }], config: { systemInstruction: 'test' },
    }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'EMAIL_VERIFICATION_REQUIRED');
  assert.equal((await db.doc(`managedAiUsers/${unverifiedAccountUid}`).get()).exists, false);
});

test('anonymous identity with missing or invalid App Check remains unreserved', { skip: !appCheckRequired }, async () => {
  const body = JSON.stringify({
    turnId: 'turn_guest_appcheck_0001', callId: 'call_guest_appcheck_0001',
    contents: [{ role: 'user', parts: [{ text: 'This must not call Gemini' }] }], config: { systemInstruction: 'test' },
  });
  const before = await db.collection('managedAiMonthly').get();
  const beforeCalls = before.docs.reduce((sum, doc) => sum + Number(doc.get('callsReserved') || 0), 0);
  for (const token of [undefined, 'invalid-app-check-token']) {
    const headers = {
      Origin: 'https://flowmate-ai.web.app', Authorization: `Bearer ${anonymousIdToken}`, 'Content-Type': 'application/json',
    };
    if (token) headers['X-Firebase-AppCheck'] = token;
    const response = await fetch(endpoint, { method: 'POST', headers, body });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'APP_CHECK_REQUIRED');
  }
  assert.equal((await db.doc(`managedAiGuests/${guestUid}`).get()).exists, false);
  const after = await db.collection('managedAiMonthly').get();
  assert.equal(after.docs.reduce((sum, doc) => sum + Number(doc.get('callsReserved') || 0), 0), beforeCalls);
});

test('authenticated identities are blocked by the default-off kill switch when App Check is not enforced', { skip: appCheckRequired }, async () => {
  const monthlyBefore = await db.collection('managedAiMonthly').get();
  const callsBefore = monthlyBefore.docs.reduce((sum, doc) => sum + Number(doc.get('callsReserved') || 0), 0);
  const response = await fetch(endpoint, {
    method: 'POST', headers: {
      Origin: 'https://flowmate-ai.web.app', Authorization: `Bearer ${anonymousIdToken}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify({
      turnId: 'turn_0000000000000001', callId: 'call_00000000000001',
      contents: [{ role: 'user', parts: [{ text: 'This must not call Gemini' }] }],
      config: { systemInstruction: 'test', tools: [] },
    }),
  });
  assert.equal(response.status, appCheckRequired ? 401 : 503);
  assert.equal((await response.json()).error.code, appCheckRequired ? 'APP_CHECK_REQUIRED' : 'MANAGED_AI_DISABLED');
  assert.equal((await db.doc(`managedAiGuests/${guestUid}`).get()).exists, false);
  const monthlyAfter = await db.collection('managedAiMonthly').get();
  assert.equal(monthlyAfter.docs.reduce((sum, doc) => sum + Number(doc.get('callsReserved') || 0), 0), callsBefore);
});

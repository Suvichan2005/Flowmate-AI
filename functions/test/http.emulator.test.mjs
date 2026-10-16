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
let idToken;

before(async () => {
  await db.doc('system/managedAi').delete(); // absent kill switch must fail closed
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `managed-test-${randomUUID()}@example.test`, password: 'test-only-password-123', returnSecureToken: true }),
  });
  assert.equal(response.status, 200, 'test identity must come from Firebase Auth Emulator');
  idToken = (await response.json()).idToken;
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

test('verified identities are blocked by App Check enforcement or the default-off kill switch', async () => {
  const response = await fetch(endpoint, {
    method: 'POST', headers: {
      Origin: 'https://flowmate-ai.web.app', Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify({
      turnId: 'turn_0000000000000001', callId: 'call_00000000000001',
      contents: [{ role: 'user', parts: [{ text: 'This must not call Gemini' }] }],
      config: { systemInstruction: 'test', tools: [] },
    }),
  });
  assert.equal(response.status, appCheckRequired ? 401 : 503);
  assert.equal((await response.json()).error.code, appCheckRequired ? 'APP_CHECK_REQUIRED' : 'MANAGED_AI_DISABLED');
  assert.equal((await db.collection('managedAiUsers').get()).size, 0);
  assert.equal((await db.collection('managedAiMonthly').get()).size, 0);
});

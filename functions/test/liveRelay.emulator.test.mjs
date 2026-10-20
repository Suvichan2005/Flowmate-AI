import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { after, before } from 'node:test';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import WebSocket from 'ws';

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!firestoreHost || !authHost) throw new Error('Auth and Firestore emulator hosts are required; this test never runs against production');

const app = initializeApp({ projectId: 'demo-flowmate-managed-ai-test' });
const db = getFirestore(app);
db.settings({ host: firestoreHost, ssl: false });
let server;
let uid;
let idToken;
let port;
let previousManagedAi;
let previousManagedLive;
let ticketDocId;
const origin = 'http://localhost:5173';

async function createAnonymousIdentity() {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

async function requestTicket(token) {
  return fetch(`http://127.0.0.1:${port}/session`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-3.8-live', reasoningLevel: 'medium', systemInstruction: 'Test only', tools: [] }),
  });
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.APP_CHECK_REQUIRED = 'true';
  delete process.env.GEMINI_API_KEY;
  const identity = await createAnonymousIdentity();
  uid = identity.localId;
  idToken = identity.idToken;
  previousManagedAi = await db.doc('system/managedAi').get();
  previousManagedLive = await db.doc('system/managedLive').get();
  await db.doc('system/managedAi').set({ enabled: true, mode: 'test', allowedTestUids: [uid] });
  await db.doc('system/managedLive').set({ enabled: true });
  const { createServer } = await import('node:net');
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const { startLiveRelayServer } = await import('../lib/liveRelayServer.js');
  server = startLiveRelayServer(port);
  if (!server.listening) await once(server, 'listening');
});

after(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await db.doc(`managedAiLiveSessions/${uid}`).delete().catch(() => {});
  await db.doc(`managedAiLiveTokenRates/${uid}`).delete().catch(() => {});
  if (ticketDocId) await db.doc(`managedAiLiveTickets/${ticketDocId}`).delete().catch(() => {});
  if (previousManagedAi?.exists) await db.doc('system/managedAi').set(previousManagedAi.data());
  else await db.doc('system/managedAi').delete().catch(() => {});
  if (previousManagedLive?.exists) await db.doc('system/managedLive').set(previousManagedLive.data());
  else await db.doc('system/managedLive').delete().catch(() => {});
  await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  }).catch(() => {});
  await db.terminate();
  await app.delete();
  delete process.env.APP_CHECK_REQUIRED;
  delete process.env.NODE_ENV;
});

test('relay requires App Check, binds one-use tickets to an allowed identity and rejects before provider invocation when unconfigured', async () => {
  const missingAppCheck = await requestTicket(idToken);
  assert.equal(missingAppCheck.status, 401);
  assert.equal((await missingAppCheck.json()).error.code, 'APP_CHECK_REQUIRED');

  process.env.APP_CHECK_REQUIRED = 'false'; // emulator-only test path; production must keep it true
  const deniedIdentity = await createAnonymousIdentity();
  const denied = await requestTicket(deniedIdentity.idToken);
  assert.equal(denied.status, 503);
  assert.equal((await denied.json()).error.code, 'MANAGED_AI_DISABLED');
  await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: deniedIdentity.idToken }),
  });

  const ticketResponse = await requestTicket(idToken);
  const ticketResponseText = await ticketResponse.text();
  assert.equal(ticketResponse.status, 200, ticketResponseText);
  const ticket = JSON.parse(ticketResponseText);
  assert.equal(typeof ticket.ticket, 'string');
  const { createHash } = await import('node:crypto');
  ticketDocId = createHash('sha256').update(ticket.ticket).digest('hex');
  assert.equal(ticket.webSocketUrl, `ws://127.0.0.1:${port}/ws`);

  const providerDenied = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${ticket.webSocketUrl}?ticket=${encodeURIComponent(ticket.ticket)}`, { origin });
    const timer = setTimeout(() => reject(new Error('Timed out waiting for the relay to reject an unconfigured provider')), 5_000);
    socket.once('open', () => socket.send(JSON.stringify({ type: 'setup', payload: {
      model: ticket.model, reasoningLevel: 'medium', systemInstruction: 'Test only', tools: [],
    } })));
    socket.once('message', raw => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()));
    });
    socket.once('error', reject);
  });
  assert.deepEqual(providerDenied, { type: 'error', error: { code: 'MANAGED_AI_NOT_CONFIGURED' } });
  const session = await db.doc(`managedAiLiveSessions/${uid}`).get();
  assert.equal(session.get('status'), 'error');

  const replay = await new Promise(resolve => {
    const socket = new WebSocket(`${ticket.webSocketUrl}?ticket=${encodeURIComponent(ticket.ticket)}`, { origin });
    socket.once('open', () => resolve('unexpected-open'));
    socket.once('error', () => resolve('rejected'));
  });
  assert.equal(replay, 'rejected');
});

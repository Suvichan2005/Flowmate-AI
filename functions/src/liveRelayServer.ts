import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Behavior, GoogleGenAI, Modality, ThinkingLevel, type FunctionDeclaration, type LiveConnectConfig, type LiveServerMessage } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { briefingLedgerRefs, isManagedAiEnabledForIdentity, markCostExposureUncertain, reserveCostExposure, settleCostExposure } from './ledger.js';
import { RequestFailure } from './policy.js';
import {
  assertLiveSessionEnvelopeIsSafe, LIVE_CONTEXT_COMPRESSION_TARGET_TOKENS,
  LIVE_CONTEXT_COMPRESSION_TRIGGER_TOKENS, LIVE_PRICE_VERSION,
  LIVE_SESSION_MAX_AUDIO_INPUT_BYTES, LIVE_SESSION_MAX_DURATION_MS,
  LIVE_SESSION_MAX_GENERATIONS, LIVE_SESSION_MAX_OUTPUT_TOKENS,
  LIVE_SESSION_MAX_OUTPUT_TOKENS_PER_GENERATION, LIVE_SESSION_MAX_TEXT_CONTROL_BYTES,
  LIVE_SESSION_RESERVATION_MICRO_USD, LIVE_SESSION_STOP_AT_MICRO_USD,
} from './liveCost.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const MODEL_IDS = new Set(['gemini-3.8-live', 'gemini-3.8-live-extended-thinking']);
const LIVE_TOOLS = new Set(['schedule_event', 'create_entity', 'log_activity', 'read_calendar', 'search_entities', 'search_memory', 'propose_memory_update', 'record_commitment_evidence']);
const MAX_AUDIO_FRAME_BYTES = 8_192;
const MAX_AUDIO_OUTPUT_BYTES = 3_932_160;
const MAX_OUTPUT_TEXT_BYTES = 8_000;
const MAX_TOOL_RESPONSE_BYTES = 8_192;
const MAX_TOOL_RESPONSES = 5;
const MAX_SESSION_AGE_MS = LIVE_SESSION_MAX_DURATION_MS + 30_000;
const TICKET_TTL_MS = 30_000;
const activeRelays = new Set<RelaySession>();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const uidRef = (uid: string) => createHash('sha256').update(uid).digest('hex').slice(0, 20);
const now = () => Date.now();
const allowedOrigins = () => new Set((process.env.FLOWMATE_ALLOWED_ORIGINS || 'https://flowmate-ai.web.app,https://flowmate-ai.firebaseapp.com,https://flowmate-ai--managed-ai-preview-8jatmmwd.web.app,http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => value.trim()).filter(Boolean));

interface Identity { uid: string; email?: string; allowance: 'guest' | 'account'; privileged: boolean; }
interface Ticket { uid: string; sessionId: string; origin: string; model: string; reasoningLevel: string; allowance: 'guest' | 'account'; privileged: boolean; setupHash: string; }
interface LiveUsageTotals { microUsd: number; events: number; inputTokens: number; outputTokens: number; }
interface RelaySession {
  socket: WebSocket;
  provider: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null;
  refs: ReturnType<typeof briefingLedgerRefs> | null;
  openedAt: number;
  inputAudioBytes: number;
  outputAudioBytes: number;
  controlBytes: number;
  outputTextBytes: number;
  toolResponses: number;
  generations: number;
  outputTokensThisGeneration: number;
  hasUsage: boolean;
  usage: LiveUsageTotals;
  providerSetupComplete: boolean;
  providerConnectAttempted: boolean;
  finishing: boolean;
  timer: NodeJS.Timeout;
  ticket: Ticket;
}

function json(res: ServerResponse, status: number, value: unknown, origin?: string) {
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(value));
}

function fail(res: ServerResponse, status: number, code: string, origin?: string) {
  res.statusCode = status;
  json(res, status, { error: { code } }, origin);
}

async function readJson(req: IncomingMessage, maxBytes = 48_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.length;
    if (bytes > maxBytes) throw new RequestFailure('INVALID_REQUEST', 413);
    chunks.push(data);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed as Record<string, unknown>;
  } catch { throw new RequestFailure('INVALID_REQUEST', 400); }
}

async function verifyIdentity(req: IncomingMessage): Promise<Identity> {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) throw new RequestFailure('AUTH_REQUIRED', 401);
  let decoded;
  try { decoded = await getAuth().verifyIdToken(authorization.slice(7), true); }
  catch { throw new RequestFailure('AUTH_REQUIRED', 401); }
  const allowance = decoded.firebase?.sign_in_provider === 'anonymous' ? 'guest' : 'account';
  if (allowance === 'account' && decoded.email_verified !== true) throw new RequestFailure('EMAIL_VERIFICATION_REQUIRED', 403);
  const appCheckRequired = process.env.APP_CHECK_REQUIRED !== 'false';
  if (appCheckRequired) {
    const token = req.headers['x-firebase-appcheck'];
    if (typeof token !== 'string') throw new RequestFailure('APP_CHECK_REQUIRED', 401);
    try { await getAppCheck().verifyToken(token); }
    catch { throw new RequestFailure('APP_CHECK_REQUIRED', 401); }
  }
  const email = decoded.email;
  const allow = await db.doc(`managedAiAllowlist/${decoded.uid}`).get();
  const privileged = allowance === 'account' && Boolean(email)
    && allow.get('status') === 'active' && allow.get('uid') === decoded.uid
    && allow.get('emailLower') === email?.trim().toLowerCase();
  return { uid: decoded.uid, email, allowance, privileged };
}

function validateSetup(body: Record<string, unknown>) {
  if (Object.keys(body).some(key => !['model', 'reasoningLevel', 'systemInstruction', 'tools'].includes(key))) throw new RequestFailure('INVALID_REQUEST', 400);
  const model = typeof body.model === 'string' ? body.model : 'gemini-3.8-live';
  const reasoningLevel = typeof body.reasoningLevel === 'string' ? body.reasoningLevel.toLowerCase() : 'medium';
  const systemInstruction = typeof body.systemInstruction === 'string' ? body.systemInstruction.trim() : '';
  const rawTools = body.tools === undefined ? [] : body.tools;
  if (!MODEL_IDS.has(model) || !systemInstruction || systemInstruction.length > 4_000 || !Array.isArray(rawTools) || rawTools.length > 8) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  if (model === 'gemini-3.8-live-extended-thinking' && !['low', 'medium', 'high'].includes(reasoningLevel)) throw new RequestFailure('UNSUPPORTED_REASONING_LEVEL', 422);
  const tools = rawTools.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RequestFailure('INVALID_REQUEST', 400);
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => !['name', 'description', 'parameters'].includes(key))
      || typeof item.name !== 'string' || !LIVE_TOOLS.has(item.name)
      || typeof item.description !== 'string' || item.description.length > 1_200
      || !item.parameters || typeof item.parameters !== 'object' || Array.isArray(item.parameters)
      || JSON.stringify(item.parameters).length > 12_000) throw new RequestFailure('INVALID_REQUEST', 400);
    return { name: item.name, description: item.description, parameters: item.parameters };
  });
  const normalized = { model, reasoningLevel, systemInstruction, tools };
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > LIVE_SESSION_MAX_TEXT_CONTROL_BYTES) throw new RequestFailure('INVALID_REQUEST', 413);
  return normalized;
}

async function createTicket(req: IncomingMessage, res: ServerResponse, origin: string) {
  const body = await readJson(req);
  const setup = validateSetup(body);
  const identity = await verifyIdentity(req);
  if (setup.model === 'gemini-3.8-live-extended-thinking' && !identity.privileged) throw new RequestFailure('MODEL_NOT_ALLOWED_FOR_ACCOUNT', 403);
  const [aiControl, liveControl] = await Promise.all([db.doc('system/managedAi').get(), db.doc('system/managedLive').get()]);
  if (liveControl.get('enabled') !== true || !isManagedAiEnabledForIdentity(aiControl.data(), identity.uid, identity.privileged)) throw new RequestFailure('MANAGED_AI_DISABLED', 503);
  assertLiveSessionEnvelopeIsSafe();

  const rateRef = db.doc(`managedAiLiveTokenRates/${identity.uid}`);
  await db.runTransaction(async transaction => {
    const rate = await transaction.get(rateRef);
    const start = Number(rate.get('windowStartMs') || 0);
    const count = start > now() - 60_000 ? Number(rate.get('count') || 0) : 0;
    if (count >= 3) throw new RequestFailure('RATE_LIMITED', 429);
    transaction.set(rateRef, { windowStartMs: start > now() - 60_000 ? start : now(), count: count + 1, updatedAt: Timestamp.now() }, { merge: true });
  });

  const sessionId = randomUUID();
  const ticket = randomBytes(32).toString('base64url');
  const ticketRef = db.doc(`managedAiLiveTickets/${sha256(ticket)}`);
  const sessionRef = db.doc(`managedAiLiveSessions/${identity.uid}`);
  const expiresAtMs = now() + TICKET_TTL_MS;
  const setupHash = sha256(JSON.stringify(setup));
  await db.runTransaction(async transaction => {
    const [current, ai, live] = await Promise.all([
      transaction.get(sessionRef), transaction.get(db.doc('system/managedAi')), transaction.get(db.doc('system/managedLive')),
    ]);
    const existingExpiry = Number(current.get('expiresAtMs') || 0);
    if (current.exists && current.get('status') !== 'ended' && existingExpiry > now()) throw new RequestFailure('LIVE_SESSION_ALREADY_ACTIVE', 409);
    if (live.get('enabled') !== true || !isManagedAiEnabledForIdentity(ai.data(), identity.uid, identity.privileged)) throw new RequestFailure('MANAGED_AI_DISABLED', 503);
    transaction.create(ticketRef, {
      uid: identity.uid, sessionId, origin, model: setup.model, reasoningLevel: setup.reasoningLevel,
      allowance: identity.allowance, privileged: identity.privileged, setupHash,
      createdAt: Timestamp.now(), expiresAtMs,
    });
    transaction.set(sessionRef, { sessionId, status: 'ticket_issued', model: setup.model, createdAt: Timestamp.now(), expiresAtMs }, { merge: true });
  });
  const host = req.headers.host || '';
  const cloudRunHost = /^[A-Za-z0-9.-]+\.run\.app$/.test(host);
  const localTestHost = process.env.NODE_ENV === 'test' && /^(?:localhost|127\.0\.0\.1):\d+$/.test(host);
  if (!cloudRunHost && !localTestHost) throw new RequestFailure('LIVE_RELAY_UNAVAILABLE', 503);
  json(res, 200, { ticket, sessionId, model: setup.model, reasoningLevel: setup.model === 'gemini-3.8-live-extended-thinking' ? setup.reasoningLevel : null, expiresAt: new Date(expiresAtMs).toISOString(), webSocketUrl: `${cloudRunHost ? 'wss' : 'ws'}://${host}/ws` }, origin);
}

async function consumeTicket(ticket: string, origin: string): Promise<Ticket> {
  if (!ticket || ticket.length > 256) throw new RequestFailure('LIVE_TICKET_INVALID', 401);
  const ticketRef = db.doc(`managedAiLiveTickets/${sha256(ticket)}`);
  const ticketResult = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ticketRef);
    if (!snapshot.exists || snapshot.get('usedAt') || Number(snapshot.get('expiresAtMs') || 0) <= now() || snapshot.get('origin') !== origin) {
      throw new RequestFailure('LIVE_TICKET_INVALID', 401);
    }
    const uid = String(snapshot.get('uid') || '');
    const sessionId = String(snapshot.get('sessionId') || '');
    const sessionRef = db.doc(`managedAiLiveSessions/${uid}`);
    const current = await transaction.get(sessionRef);
    if (current.get('sessionId') !== sessionId || current.get('status') !== 'ticket_issued') throw new RequestFailure('LIVE_SESSION_ALREADY_ACTIVE', 409);
    transaction.update(ticketRef, { usedAt: Timestamp.now() });
    // Keep failed ticket handshakes from pinning an identity lease for the full
    // session duration. The longer lease is installed only after setup arrives.
    transaction.update(sessionRef, { status: 'connecting', expiresAtMs: now() + TICKET_TTL_MS });
    return snapshot.data() as Ticket;
  });
  return ticketResult;
}

function modalityCost(details: unknown, fallbackTokens: number, rates: Record<string, number>): number | null {
  if (!Array.isArray(details)) return null;
  let sum = 0;
  let cost = 0;
  for (const item of details) {
    if (!item || typeof item !== 'object') return null;
    const modality = String((item as { modality?: unknown }).modality || '');
    const tokens = (item as { tokenCount?: unknown }).tokenCount;
    if (!Number.isSafeInteger(tokens) || Number(tokens) < 0 || !rates[modality]) return null;
    sum += Number(tokens);
    cost += Math.ceil(Number(tokens) * rates[modality] / 1_000_000);
  }
  return sum === fallbackTokens ? cost : null;
}

export function usageCost(message: LiveServerMessage): { microUsd: number; inputTokens: number; outputTokens: number } | null {
  const usage = message.usageMetadata as Record<string, unknown> | undefined;
  if (!usage) return null;
  const prompt = usage.promptTokenCount;
  const response = usage.responseTokenCount;
  const thoughts = usage.thoughtsTokenCount ?? 0;
  const toolInput = usage.toolUsePromptTokenCount ?? 0;
  const total = usage.totalTokenCount;
  const values = [prompt, response, thoughts, toolInput];
  if (!values.every(value => Number.isSafeInteger(value) && Number(value) >= 0)) return null;
  const inputTokens = Number(prompt) + Number(toolInput);
  const outputTokens = Number(response) + Number(thoughts);
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) return null;
  if (inputTokens + outputTokens === 0) return null;
  if (total !== undefined && total !== inputTokens + outputTokens) return null;
  const inputRates = { TEXT: 750_000, AUDIO: 3_000_000, IMAGE: 1_000_000, VIDEO: 1_000_000 };
  const outputRates = { TEXT: 4_500_000, AUDIO: 12_000_000 };
  const promptCost = modalityCost(usage.promptTokensDetails, Number(prompt), inputRates);
  const toolCost = Number(toolInput) === 0 ? 0 : modalityCost(usage.toolUsePromptTokensDetails, Number(toolInput), inputRates);
  const responseCost = modalityCost(usage.responseTokensDetails, Number(response), outputRates);
  if (promptCost === null || toolCost === null || responseCost === null) return null;
  return { microUsd: promptCost + toolCost + responseCost + Math.ceil(Number(thoughts) * 12_000_000 / 1_000_000), inputTokens, outputTokens };
}

export function audioInputByteLength(data: unknown): number | null {
  if (typeof data !== 'string' || data.length > 10_924
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return null;
  const bytes = Buffer.from(data, 'base64').byteLength;
  return bytes > 0 && bytes <= MAX_AUDIO_FRAME_BYTES ? bytes : null;
}

function sendWsError(socket: WebSocket, code: string, closeCode = 4400) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'error', error: { code } }));
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(closeCode, code.slice(0, 100));
}

async function setSessionStatus(ticket: Ticket, status: string, patch: Record<string, unknown> = {}) {
  const sessionRef = db.doc(`managedAiLiveSessions/${ticket.uid}`);
  await db.runTransaction(async transaction => {
    const current = await transaction.get(sessionRef);
    if (current.get('sessionId') !== ticket.sessionId) return;
    if (status === 'active' && current.get('status') !== 'connecting') return;
    if (['ended', 'limit', 'error'].includes(String(current.get('status') || ''))) return;
    transaction.set(sessionRef, { ...patch, status }, { merge: true });
  });
}

async function finishRelay(relay: RelaySession, outcome: 'ended' | 'limit' | 'error') {
  if (relay.finishing) return;
  relay.finishing = true;
  clearTimeout(relay.timer);
  try { relay.provider?.close(); } catch { /* the provider socket may already be closed */ }
  try {
    await setSessionStatus(relay.ticket, outcome === 'ended' ? 'ended' : outcome, { endedAt: Timestamp.now(), expiresAtMs: now() });
  } catch { /* lease expires; cost settlement below remains authoritative */ }
  try {
    if (!relay.refs) return;
    if (!relay.hasUsage) {
      if (!relay.providerSetupComplete && !relay.providerConnectAttempted) {
        try { await settleCostExposure(relay.refs, 0, LIVE_PRICE_VERSION); }
        catch { await markCostExposureUncertain(relay.refs); }
      } else {
        try { await markCostExposureUncertain(relay.refs); } catch { /* reservation remains fail-closed */ }
      }
      return;
    }
    try { await settleCostExposure(relay.refs, relay.usage.microUsd, LIVE_PRICE_VERSION); }
    catch { try { await markCostExposureUncertain(relay.refs); } catch { /* preserve original reservation */ } }
  } finally {
    activeRelays.delete(relay);
  }
}

async function openProviderRelay(socket: WebSocket, ticket: Ticket, body: Record<string, unknown>) {
  const setup = validateSetup(body);
  if (sha256(JSON.stringify(setup)) !== ticket.setupHash || setup.model !== ticket.model) throw new RequestFailure('LIVE_SETUP_MISMATCH', 400);
  if (!process.env.GEMINI_API_KEY) throw new RequestFailure('MANAGED_AI_NOT_CONFIGURED', 503);
  const dbModel = ticket.model as 'gemini-3.8-live' | 'gemini-3.8-live-extended-thinking';
  const uidRefs = briefingLedgerRefs(db, ticket.uid, ticket.sessionId, new Date(), undefined, ticket.allowance);
  uidRefs.isPrivileged = ticket.privileged;
  const refs = uidRefs;
  await db.runTransaction(async transaction => {
    const existing = await transaction.get(refs.call);
    if (existing.exists) throw new RequestFailure('REQUEST_ALREADY_PROCESSED', 409);
    transaction.create(refs.call, { status: 'reserved', operation: 'managed_live_session', createdAt: Timestamp.now() });
  });
  try {
    await reserveCostExposure(db, refs, {
      estimatedMicroUsd: LIVE_SESSION_RESERVATION_MICRO_USD,
      pricingVersion: LIVE_PRICE_VERSION,
      inputTokens: LIVE_CONTEXT_COMPRESSION_TRIGGER_TOKENS,
      maximumOutputTokens: LIVE_SESSION_MAX_OUTPUT_TOKENS_PER_GENERATION,
    });
  } catch (error) {
    try { await refs.call.delete(); } catch { /* leave the denial record if cleanup fails */ }
    try { await setSessionStatus(ticket, 'ended', { endedAt: Timestamp.now(), expiresAtMs: now() }); } catch { /* lease expiry remains the fallback */ }
    throw error;
  }

  const relay: RelaySession = {
    socket, provider: null, refs, openedAt: now(), inputAudioBytes: 0, outputAudioBytes: 0,
    controlBytes: Buffer.byteLength(JSON.stringify(setup), 'utf8'), outputTextBytes: 0, toolResponses: 0,
    generations: 0, outputTokensThisGeneration: 0, hasUsage: false, usage: { microUsd: 0, events: 0, inputTokens: 0, outputTokens: 0 },
    providerSetupComplete: false, providerConnectAttempted: false, finishing: false, ticket,
    timer: setTimeout(() => { sendWsError(socket, 'LIVE_SESSION_LIMIT_REACHED', 4410); void finishRelay(relay, 'limit'); }, LIVE_SESSION_MAX_DURATION_MS),
  };
  activeRelays.add(relay);
  try { await setSessionStatus(ticket, 'connecting', { expiresAtMs: now() + MAX_SESSION_AGE_MS }); }
  catch (error) { await finishRelay(relay, 'error'); throw error; }
  socket.once('close', () => { void finishRelay(relay, 'ended'); });
  socket.once('error', () => { void finishRelay(relay, 'error'); });
  if (relay.finishing || socket.readyState !== WebSocket.OPEN) {
    await finishRelay(relay, 'ended');
    return;
  }
  const declarations = setup.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(dbModel === 'gemini-3.8-live-extended-thinking' ? { behavior: Behavior.NON_BLOCKING } : {}),
  })) as FunctionDeclaration[];
  const config: LiveConnectConfig = {
    responseModalities: [Modality.AUDIO],
    maxOutputTokens: LIVE_SESSION_MAX_OUTPUT_TOKENS_PER_GENERATION,
    contextWindowCompression: {
      triggerTokens: String(LIVE_CONTEXT_COMPRESSION_TRIGGER_TOKENS),
      slidingWindow: { targetTokens: String(LIVE_CONTEXT_COMPRESSION_TARGET_TOKENS) },
    },
    systemInstruction: { parts: [{ text: setup.systemInstruction }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    ...(declarations.length ? { tools: [{ functionDeclarations: declarations }] } : {}),
    ...(dbModel === 'gemini-3.8-live-extended-thinking' ? { thinkingConfig: { thinkingLevel: setup.reasoningLevel.toUpperCase() as ThinkingLevel } } : {}),
  };
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1beta' } });
  relay.providerConnectAttempted = true;
  try { relay.provider = await ai.live.connect({
    model: dbModel,
    config,
    callbacks: {
      onmessage: message => {
        if (message.setupComplete) {
          relay.providerSetupComplete = true;
          void setSessionStatus(ticket, 'active', { providerConnectedAt: Timestamp.now() });
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'message', message }));
          return;
        }
        if (message.usageMetadata) {
          const measured = usageCost(message);
          if (!measured) {
            sendWsError(socket, 'LIVE_USAGE_UNAVAILABLE', 4411);
            void finishRelay(relay, 'error');
            return;
          }
          relay.hasUsage = true;
          relay.generations += 1;
          relay.outputTokensThisGeneration = measured.outputTokens;
          relay.usage.events += 1;
          relay.usage.microUsd += measured.microUsd;
          relay.usage.inputTokens += measured.inputTokens;
          relay.usage.outputTokens += measured.outputTokens;
          const buffered = Math.ceil(relay.usage.microUsd * 1.5);
          if (relay.generations > LIVE_SESSION_MAX_GENERATIONS
            || relay.outputTokensThisGeneration > LIVE_SESSION_MAX_OUTPUT_TOKENS_PER_GENERATION
            || relay.usage.outputTokens > LIVE_SESSION_MAX_OUTPUT_TOKENS
            || buffered >= LIVE_SESSION_STOP_AT_MICRO_USD) {
            sendWsError(socket, 'LIVE_SESSION_LIMIT_REACHED', 4410);
            void finishRelay(relay, 'limit');
            return;
          }
        }
        // Managed Live sessions have a hard single-socket budget. Do not expose
        // provider resume handles that could be reused outside the relay.
        if (message.sessionResumptionUpdate) return;
        const audioBytes = serverAudioBytes(message);
        const textBytes = serverTextBytes(message);
        if (audioBytes < 0 || textBytes < 0 || relay.outputAudioBytes + audioBytes > MAX_AUDIO_OUTPUT_BYTES
          || relay.outputTextBytes + textBytes > MAX_OUTPUT_TEXT_BYTES) {
          sendWsError(socket, 'LIVE_SESSION_LIMIT_REACHED', 4410);
          void finishRelay(relay, 'limit');
          return;
        }
        relay.outputAudioBytes += audioBytes;
        relay.outputTextBytes += textBytes;
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'message', message }));
      },
      onerror: () => { sendWsError(socket, 'LIVE_PROVIDER_UNAVAILABLE', 4412); void finishRelay(relay, 'error'); },
      onclose: () => { if (!relay.finishing && socket.readyState === WebSocket.OPEN) socket.close(1011, 'provider-closed'); void finishRelay(relay, 'ended'); },
    },
  }); } catch (error) {
    await finishRelay(relay, 'error');
    throw error;
  }
  if (relay.finishing || socket.readyState !== WebSocket.OPEN) {
    try { relay.provider.close(); } catch { /* socket was already closed */ }
    await finishRelay(relay, 'error');
    return;
  }
  socket.on('message', raw => {
    void (async () => {
      if (relay.finishing) return;
      if (now() - relay.openedAt > LIVE_SESSION_MAX_DURATION_MS) throw new RequestFailure('LIVE_SESSION_LIMIT_REACHED', 429);
      let frame: unknown;
      try { frame = JSON.parse(raw.toString('utf8')); } catch { throw new RequestFailure('INVALID_REQUEST', 400); }
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new RequestFailure('INVALID_REQUEST', 400);
      const value = frame as Record<string, unknown>;
      if (value.type === 'inputAudio') {
        const audio = value.payload as Record<string, unknown> | undefined;
        if (!audio || audio.mimeType !== 'audio/pcm;rate=16000' || typeof audio.data !== 'string') throw new RequestFailure('INVALID_REQUEST', 400);
        const bytes = audioInputByteLength(audio.data);
        if (bytes === null) throw new RequestFailure('INVALID_REQUEST', 400);
        if (relay.inputAudioBytes + bytes > LIVE_SESSION_MAX_AUDIO_INPUT_BYTES) throw new RequestFailure('LIVE_SESSION_LIMIT_REACHED', 429);
        relay.inputAudioBytes += bytes;
        relay.provider?.sendRealtimeInput({ audio: { mimeType: 'audio/pcm;rate=16000', data: audio.data } });
      } else if (value.type === 'toolResponse') {
        const payload = value.payload;
        const serialized = JSON.stringify(payload);
        const bytes = Buffer.byteLength(serialized, 'utf8');
        if (!payload || typeof payload !== 'object' || bytes > MAX_TOOL_RESPONSE_BYTES || relay.controlBytes + bytes > LIVE_SESSION_MAX_TEXT_CONTROL_BYTES || ++relay.toolResponses > MAX_TOOL_RESPONSES) throw new RequestFailure('LIVE_SESSION_LIMIT_REACHED', 429);
        relay.controlBytes += bytes;
        relay.provider?.sendToolResponse(payload as Parameters<NonNullable<typeof relay.provider>['sendToolResponse']>[0]);
      } else {
        throw new RequestFailure('INVALID_REQUEST', 400);
      }
    })().catch(error => {
      const code = error instanceof RequestFailure ? error.code : 'LIVE_PROVIDER_UNAVAILABLE';
      sendWsError(socket, code, code === 'LIVE_SESSION_LIMIT_REACHED' ? 4410 : 4400);
      void finishRelay(relay, code === 'LIVE_SESSION_LIMIT_REACHED' ? 'limit' : 'error');
    });
  });
}

function serverAudioBytes(message: LiveServerMessage): number {
  const parts = message.serverContent?.modelTurn?.parts || [];
  let bytes = 0;
  for (const part of parts) {
    if (!part.inlineData) continue;
    if (!part.inlineData.mimeType?.startsWith('audio/pcm') || typeof part.inlineData.data !== 'string') return -1;
    bytes += Buffer.from(part.inlineData.data, 'base64').byteLength;
  }
  return bytes;
}

function serverTextBytes(message: LiveServerMessage): number {
  let bytes = 0;
  for (const part of message.serverContent?.modelTurn?.parts || []) {
    if (typeof part.text === 'string') bytes += Buffer.byteLength(part.text, 'utf8');
    if (part.functionCall) bytes += Buffer.byteLength(JSON.stringify(part.functionCall), 'utf8');
  }
  const inputTranscript = message.serverContent?.inputTranscription?.text;
  const outputTranscript = message.serverContent?.outputTranscription?.text;
  if (typeof inputTranscript === 'string') bytes += Buffer.byteLength(inputTranscript, 'utf8');
  if (typeof outputTranscript === 'string') bytes += Buffer.byteLength(outputTranscript, 'utf8');
  return bytes;
}

export function startLiveRelayServer(port = Number(process.env.PORT || 8080)) {
  assertLiveSessionEnvelopeIsSafe();
  const server = createServer((req, res) => {
    const origin = req.headers.origin || '';
    if (!allowedOrigins().has(origin)) { fail(res, 403, 'APP_ORIGIN_NOT_ALLOWED'); return; }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (req.url !== '/session' || req.method !== 'POST') { fail(res, 404, 'NOT_FOUND', origin); return; }
    void createTicket(req, res, origin).catch(error => {
      const failure = error instanceof RequestFailure ? error : new RequestFailure('LIVE_RELAY_UNAVAILABLE', 503);
      console.warn(JSON.stringify({ event: 'live_relay_ticket_denied', code: failure.code }));
      fail(res, failure.status, failure.code, origin);
    });
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 32_768 });
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const requestUrl = new URL(req.url || '/', `https://${req.headers.host || 'invalid'}`);
      const origin = req.headers.origin || '';
      if (requestUrl.pathname !== '/ws' || !allowedOrigins().has(origin)) throw new RequestFailure('APP_ORIGIN_NOT_ALLOWED', 403);
      const ticket = await consumeTicket(requestUrl.searchParams.get('ticket') || '', origin);
      sockets.handleUpgrade(req, socket, head, ws => {
        const setupTimeout = setTimeout(() => { sendWsError(ws, 'LIVE_SETUP_TIMEOUT'); }, 10_000);
        ws.once('message', raw => {
          clearTimeout(setupTimeout);
          let frame: unknown;
          try { frame = JSON.parse(raw.toString('utf8')); } catch { sendWsError(ws, 'INVALID_REQUEST'); return; }
          if (!frame || typeof frame !== 'object' || Array.isArray(frame) || (frame as Record<string, unknown>).type !== 'setup') { sendWsError(ws, 'INVALID_REQUEST'); return; }
          const payload = (frame as Record<string, unknown>).payload;
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { sendWsError(ws, 'INVALID_REQUEST'); return; }
          void openProviderRelay(ws, ticket, payload as Record<string, unknown>).catch(async error => {
            const code = error instanceof RequestFailure ? error.code : 'LIVE_PROVIDER_UNAVAILABLE';
            console.warn(JSON.stringify({ event: 'live_relay_provider_start_failed', code, session: ticket.sessionId }));
            await setSessionStatus(ticket, 'error', { endedAt: Timestamp.now(), expiresAtMs: now() }).catch(() => {});
            sendWsError(ws, code, code === 'MANAGED_AI_BUDGET_TEMPORARILY_UNAVAILABLE' || code === 'USER_MANAGED_BUDGET_EXHAUSTED' ? 4429 : 4412);
          });
        });
        sockets.emit('connection', ws, req);
      });
    })().catch(error => {
      const failure = error instanceof RequestFailure ? error : new RequestFailure('LIVE_TICKET_INVALID', 401);
      const body = JSON.stringify({ error: { code: failure.code } });
      socket.write(`HTTP/1.1 ${failure.status} ${failure.status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      socket.destroy();
    });
  });
  server.listen(port, '0.0.0.0');
  console.log(JSON.stringify({ event: 'live_relay_started', port, minimumInstances: 0 }));
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    const timeout = setTimeout(() => process.exit(1), 8_000);
    timeout.unref();
    for (const relay of activeRelays) sendWsError(relay.socket, 'LIVE_SERVICE_SHUTTING_DOWN', 1012);
    void Promise.all([...activeRelays].map(relay => finishRelay(relay, 'error'))).finally(() => {
      clearTimeout(timeout);
      process.exit(0);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (process.env.LIVE_RELAY_SERVER === '1') startLiveRelayServer();

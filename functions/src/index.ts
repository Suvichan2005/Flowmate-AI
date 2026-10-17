import { createHash } from 'node:crypto';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { GoogleGenAI, type Content } from '@google/genai';
import { defineBoolean, defineInt, defineString, defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Request, Response } from 'express';
import { MAX_INPUT_TOKENS, MODEL, RequestFailure, isCompletedUserTurn, managedGenerationConfig, sanitizeManagedCandidates, validateGenerationBody } from './policy.js';
import { failTurn, finishTurn, reserveGenerationCall, reserveTurn, turnLedgerRefs } from './ledger.js';
import { handleManagedAiAdmin } from './admin.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const APP_CHECK_REQUIRED = defineBoolean('APP_CHECK_REQUIRED', { default: false });
const PRIVILEGED_MONTHLY_LIMIT = defineInt('FLOWMATE_PRIVILEGED_MONTHLY_LIMIT', { default: 50 });
const ALLOWED_ORIGINS = defineString('FLOWMATE_ALLOWED_ORIGINS', {
  default: 'https://flowmate-ai.web.app,https://flowmate-ai.firebaseapp.com,http://localhost:5173,http://127.0.0.1:5173',
});
const nowMs = () => Date.now();

function sendError(res: Response, error: unknown) {
  const failure = error instanceof RequestFailure ? error : new RequestFailure('MANAGED_AI_UNAVAILABLE', 503);
  res.status(failure.status).json({ error: { code: failure.code } });
}

function allowOrigin(req: Request, res: Response): boolean {
  const origin = req.get('origin') || '';
  if (!origin) return true;
  const allowed = new Set(ALLOWED_ORIGINS.value().split(',').map(value => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return false;
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Cache-Control', 'no-store');
  return true;
}

/**
 * No client-facing workspace reads occur in this endpoint. Usage and abuse-control
 * documents live in server-only collections denied by firestore.rules. Every user
 * path is derived from a revoked-token-checked Firebase ID token UID; caller-supplied
 * owner/entity IDs are rejected. The kill switch is absent/off by default.
 */
export const managedGemini = onRequest({
  region: 'asia-south1', maxInstances: 2, minInstances: 0, timeoutSeconds: 60,
  secrets: [GEMINI_API_KEY], cors: false,
}, async (req, res) => {
  if (!allowOrigin(req, res)) { res.status(403).end(); return; }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
    res.status(204).end(); return;
  }
  if (req.path === '/admin/access') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } }); return;
    }
  } else if (req.method !== 'POST') {
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } }); return;
  }

  let uid: string;
  let email: string | undefined;
  let emailVerified = false;
  let allowance: 'guest' | 'account';
  try {
    const authorization = req.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) throw new RequestFailure('AUTH_REQUIRED', 401);
    const decoded = await getAuth().verifyIdToken(authorization.slice(7), true);
    uid = decoded.uid;
    email = decoded.email;
    emailVerified = decoded.email_verified === true;
    allowance = decoded.firebase?.sign_in_provider === 'anonymous' ? 'guest' : 'account';
    if (allowance === 'account' && !emailVerified) {
      throw new RequestFailure('EMAIL_VERIFICATION_REQUIRED', 403);
    }
  } catch (error) {
    sendError(res, error instanceof RequestFailure ? error : new RequestFailure('AUTH_REQUIRED', 401));
    return;
  }

  if (APP_CHECK_REQUIRED.value()) {
    const appCheckToken = req.get('X-Firebase-AppCheck');
    if (!appCheckToken) { sendError(res, new RequestFailure('APP_CHECK_REQUIRED', 401)); return; }
    try { await getAppCheck().verifyToken(appCheckToken); }
    catch { sendError(res, new RequestFailure('APP_CHECK_REQUIRED', 401)); return; }
  }

  if (req.path === '/admin/access') {
    await handleManagedAiAdmin(db, req, res, {
      uid, email, emailVerified, anonymous: allowance === 'guest',
    }, PRIVILEGED_MONTHLY_LIMIT.value());
    return;
  }

  let input: ReturnType<typeof validateGenerationBody>;
  try { input = validateGenerationBody(req.body); }
  catch (error) { sendError(res, error); return; }

  const currentTime = nowMs();
  const refs = turnLedgerRefs(db, uid, input.turnId, input.callId, new Date(currentTime), email, allowance, PRIVILEGED_MONTHLY_LIMIT.value());
  let turnReserved = false;
  let callReserved = false;

  try {
    await reserveTurn(db, refs, currentTime);
    turnReserved = true;

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const policyContext: Content = { role: 'user', parts: [{ text: `${String(input.config.systemInstruction || '')}\n${JSON.stringify(input.config.tools || [])}` }] };
    const count = await ai.models.countTokens({ model: MODEL, contents: [policyContext, ...(input.contents as Content[])] });
    if (Number(count.totalTokens || 0) > MAX_INPUT_TOKENS) throw new RequestFailure('INPUT_TOKEN_LIMIT', 413);

    await reserveGenerationCall(db, refs);
    callReserved = true;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: input.contents as Content[],
      config: managedGenerationConfig(input.config),
    });
    const payload = {
      text: response.text || '',
      candidates: sanitizeManagedCandidates(response.candidates || []),
      functionCalls: response.functionCalls || [],
      usageMetadata: response.usageMetadata || null,
    };
    const complete = isCompletedUserTurn(payload);
    logger.info('Managed AI generation completed', {
      model: MODEL,
      responseTextLength: payload.text.length,
      candidateCount: payload.candidates.length,
      functionCallCount: payload.functionCalls.length,
      completedUserTurn: complete,
    });
    await finishTurn(db, refs, complete);
    res.status(200).json(payload);
  } catch (error) {
    if (turnReserved) {
      try { await failTurn(db, refs, callReserved); }
      catch { /* fail closed: monthly generation reservations are never refunded */ }
    }
    if (!(error instanceof RequestFailure)) logger.error('Managed AI generation failed', { code: 'GENERATION_FAILED' });
    sendError(res, error instanceof RequestFailure ? error : new RequestFailure('GENERATION_FAILED', 502));
  }
});

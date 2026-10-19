import { createHash } from 'node:crypto';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { Behavior, GoogleGenAI, Modality, ThinkingLevel, type Content, type FunctionDeclaration, type LiveConnectConfig, type Tool } from '@google/genai';
import { defineBoolean, defineString, defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Request, Response } from 'express';
import { ACCOUNT_CHAT_TURN_LIMIT, ACCOUNT_DAILY_BRIEFING_LIMIT, ARGON_MODEL, DEFAULT_MODEL, GUEST_CHAT_TURN_LIMIT, GUEST_DAILY_BRIEFING_LIMIT, MANAGED_FUNCTION_TIMEOUT_SECONDS, SUPPORTED_MANAGED_MODELS, RequestFailure, authorizeManagedModel, buildCountTokensRequest, dayKey, isCompletedUserTurn, managedGenerationConfig, monthKey, sanitizeManagedCandidates, validateGenerationBody } from './policy.js';
import { briefingLedgerRefs, failTurn, finishBriefing, finishTurn, isManagedAiEnabledForIdentity, markCostExposureUncertain, recordGenerationUsage, reserveBriefing, reserveBriefingGenerationCall, reserveCostExposure, reserveGenerationCall, reserveTurn, sanitizeUsageMetadata, settleCostExposure, turnLedgerRefs } from './ledger.js';
import { handleManagedAiAdmin } from './admin.js';
import { generateArgonStateless } from './argon.js';
import { actualTextGenerationCost, estimateTextGenerationCost, outputEnvelope } from './cost.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const APP_CHECK_REQUIRED = defineBoolean('APP_CHECK_REQUIRED', { default: true });
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
  region: 'asia-south1', maxInstances: 2, minInstances: 0, timeoutSeconds: MANAGED_FUNCTION_TIMEOUT_SECONDS,
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
  } else if (req.path === '/models') {
    if (req.method !== 'GET') { res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } }); return; }
  } else if (req.path === '/usage') {
    if (req.method !== 'GET') { res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } }); return; }
  } else if (req.path === '/live-session') {
    if (req.method !== 'POST') { res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } }); return; }
  } else if (req.path === '/live-session/end') {
    if (req.method !== 'POST') { res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } }); return; }
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
    await handleManagedAiAdmin(db, req, res, { uid, email, emailVerified, anonymous: allowance === 'guest' });
    return;
  }

  if (req.path === '/usage') {
    try {
      const emailLower = email?.trim().toLowerCase();
      const access = await db.doc(`managedAiAllowlist/${uid}`).get();
      const privileged = allowance === 'account' && Boolean(emailLower) && access.get('status') === 'active'
        && access.get('uid') === uid && access.get('emailLower') === emailLower;
      const now = new Date();
      const month = monthKey(now);
      const day = dayKey(now);
      const uidHash = createHash('sha256').update(uid).digest('hex');
      const personalMonth = db.doc(`${privileged ? 'managedAiPrivilegedUserMonthly' : 'managedAiUserMonthly'}/${month}_${uidHash}`);
      const personalDay = db.doc(`${privileged ? 'managedAiPrivilegedUserDaily' : 'managedAiUserDaily'}/${day}_${uidHash}`);
      const personalCost = db.doc(`managedAiCostUserMonthly/${month}_${uidHash}`);
      const budgetPolicy = db.doc('system/managedAiBudgetPolicy');
      const [monthlyUsage, dailyUsage, personalCostUsage, costPolicy] = await Promise.all([
        personalMonth.get(), personalDay.get(), personalCost.get(), budgetPolicy.get(),
      ]);
      const [year, monthNumber] = month.split('-').map(Number);
      // monthKey is Asia/Kolkata; represent the next month boundary as an exact UTC instant.
      const resetAt = new Date(Date.UTC(year, monthNumber, 1) - 330 * 60_000).toISOString();
      const [dayYear, dayMonth, dayNumber] = day.split('-').map(Number);
      const dailyResetAt = new Date(Date.UTC(dayYear, dayMonth - 1, dayNumber + 1) - 330 * 60_000).toISOString();
      res.set('Cache-Control', 'no-store');
      res.status(200).json({
        tier: privileged ? 'privileged' : allowance,
        chat: { successfulTurns: Number(monthlyUsage.get('successfulTurns') || 0), monthlyLimit: privileged ? null : allowance === 'guest' ? GUEST_CHAT_TURN_LIMIT : ACCOUNT_CHAT_TURN_LIMIT, month, resetAt },
        briefings: { successfulToday: Number(dailyUsage.get('successfulBriefings') || 0), dailyLimit: privileged ? null : allowance === 'guest' ? GUEST_DAILY_BRIEFING_LIMIT : ACCOUNT_DAILY_BRIEFING_LIMIT, day, resetAt: dailyResetAt },
        cost: {
          currency: 'USD', month,
          estimatedSettledMicroUsd: Number(personalCostUsage.get('settledMicroUsd') || 0),
          reservedMicroUsd: Number(personalCostUsage.get('reservedMicroUsd') || 0),
          monthlyLimitMicroUsd: costPolicy.get('enabled') === true && Number.isSafeInteger(costPolicy.get('userMonthlyLimitMicroUsd'))
            ? Number(costPolicy.get('userMonthlyLimitMicroUsd')) : null,
          maxTurnExposureMicroUsd: costPolicy.get('enabled') === true && Number.isSafeInteger(costPolicy.get('maxTurnExposureMicroUsd'))
            ? Number(costPolicy.get('maxTurnExposureMicroUsd')) : null,
        },
        tokens: {
          inputThisMonth: Number(monthlyUsage.get('inputTokens') || 0),
          outputThisMonth: Number(monthlyUsage.get('outputTokens') || 0),
          thinkingThisMonth: Number(monthlyUsage.get('thinkingTokens') || 0),
          totalThisMonth: Number(monthlyUsage.get('totalTokens') || 0),
          usageCallsThisMonth: Number(monthlyUsage.get('usageCallsReported') || 0),
          month,
        },
      });
    } catch {
      logger.warn('Managed AI usage read failed', { code: 'USAGE_READ_UNAVAILABLE' });
      res.status(503).json({ error: { code: 'USAGE_READ_UNAVAILABLE' } });
    }
    return;
  }

  if (req.path === '/live-session') {
    const sessionId = randomUUID();
    const sessionRef = db.doc(`managedAiLiveSessions/${uid}`);
    let leaseAcquired = false;
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body as Record<string, unknown> : {};
      if (Object.keys(body).some(key => !['model', 'reasoningLevel', 'systemInstruction', 'tools'].includes(key))) throw new RequestFailure('INVALID_REQUEST', 400);
      const model = body.model === undefined ? 'gemini-3.8-live' : body.model;
      const reasoningLevel = typeof body.reasoningLevel === 'string' ? body.reasoningLevel.toLowerCase() : 'medium';
      const systemInstruction = typeof body.systemInstruction === 'string' ? body.systemInstruction.trim() : '';
      if (!systemInstruction) throw new RequestFailure('INVALID_REQUEST', 400);
      const allowedLiveTools = new Set(['schedule_event', 'create_entity', 'log_activity', 'read_calendar', 'search_entities', 'search_memory', 'propose_memory_update', 'record_commitment_evidence']);
      const rawTools = body.tools === undefined ? [] : body.tools;
      if (!Array.isArray(rawTools) || rawTools.length > 8) throw new RequestFailure('INVALID_REQUEST', 400);
      const functionDeclarations = rawTools.map(raw => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RequestFailure('INVALID_REQUEST', 400);
        const item = raw as Record<string, unknown>;
        if (Object.keys(item).some(key => !['name', 'description', 'parameters'].includes(key))
          || typeof item.name !== 'string' || !allowedLiveTools.has(item.name)
          || typeof item.description !== 'string' || item.description.length > 1200
          || !item.parameters || typeof item.parameters !== 'object' || Array.isArray(item.parameters)
          || JSON.stringify(item.parameters).length > 12_000) throw new RequestFailure('INVALID_REQUEST', 400);
        return {
          name: item.name,
          description: item.description,
          parameters: item.parameters as FunctionDeclaration['parameters'],
          ...(model === 'gemini-3.8-live-extended-thinking' ? { behavior: Behavior.NON_BLOCKING } : {}),
        };
      });
      if (model !== 'gemini-3.8-live' && model !== 'gemini-3.8-live-extended-thinking') {
        throw new RequestFailure('MODEL_UNAVAILABLE', 422);
      }
      if (model === 'gemini-3.8-live-extended-thinking' && !['low', 'medium', 'high'].includes(reasoningLevel)) {
        throw new RequestFailure('UNSUPPORTED_REASONING_LEVEL', 422);
      }
      const emailLower = email?.trim().toLowerCase();
      const allowlist = await db.doc(`managedAiAllowlist/${uid}`).get();
      const privileged = allowance === 'account' && Boolean(emailLower)
        && allowlist.get('status') === 'active' && allowlist.get('uid') === uid
        && allowlist.get('emailLower') === emailLower;
      if (model === 'gemini-3.8-live-extended-thinking' && !privileged) {
        throw new RequestFailure('MODEL_NOT_ALLOWED_FOR_ACCOUNT', 403);
      }
      const [aiControl, liveControl] = await Promise.all([
        db.doc('system/managedAi').get(),
        db.doc('system/managedLive').get(),
      ]);
      if (liveControl.get('enabled') !== true || !isManagedAiEnabledForIdentity(aiControl.data(), uid, privileged)) {
        throw new RequestFailure('MANAGED_AI_DISABLED', 503);
      }
      // Token grants are short-term abuse protection, not a voice-session quota.
      // Actual audio usage remains provider-metered and is not represented as a server-enforced budget.
      const rateRef = db.doc(`managedAiLiveTokenRates/${uid}`);
      await db.runTransaction(async transaction => {
        const rate = await transaction.get(rateRef);
        const data = rate.data() || {};
        const start = Number(data.windowStartMs || 0);
        const count = start > nowMs() - 60_000 ? Number(data.count || 0) : 0;
        if (count >= 20) throw new RequestFailure('RATE_LIMITED', 429);
        transaction.set(rateRef, { windowStartMs: start > nowMs() - 60_000 ? start : nowMs(), count: count + 1, updatedAt: Timestamp.now() }, { merge: true });
      });
      const now = Date.now();
      await db.runTransaction(async transaction => {
        const current = await transaction.get(sessionRef);
        const currentExpiry = Number(current.get('expiresAtMs') || 0);
        if (current.exists && current.get('status') !== 'ended' && currentExpiry > now) {
          throw new RequestFailure('LIVE_SESSION_ALREADY_ACTIVE', 409);
        }
        transaction.set(sessionRef, {
          sessionId,
          status: 'issuing',
          model,
          createdAt: Timestamp.now(),
          expiresAtMs: now + 15 * 60_000,
        });
      });
      leaseAcquired = true;
      const liveConfig: LiveConnectConfig = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: {},
        ...(functionDeclarations.length ? { tools: [{ functionDeclarations: functionDeclarations as FunctionDeclaration[] }] } : {}),
        ...(model === 'gemini-3.8-live-extended-thinking'
          ? { thinkingConfig: { thinkingLevel: reasoningLevel.toUpperCase() as ThinkingLevel } }
          : {}),
      };
      const token = await new GoogleGenAI({
        apiKey: GEMINI_API_KEY.value(),
        httpOptions: { apiVersion: 'v1beta' },
      }).authTokens.create({
        config: {
          uses: 1,
          newSessionExpireTime: new Date(now + 60_000).toISOString(),
          // Gemini rejects further messages after this token expiry and may
          // close earlier. This time bound is not a monetary usage cap.
          expireTime: new Date(now + 15 * 60_000).toISOString(),
          liveConnectConstraints: { model: `models/${model}`, config: liveConfig },
          // The Live API locks all session configuration fields by default for
          // ephemeral tokens. Keep the provider's documented default; the
          // SDK's additional-field paths are easy to mis-specify and unsafe to
          // rely on without a real token-grant integration test.
        },
      });
      if (!token.name) throw new RequestFailure('LIVE_TOKEN_UNAVAILABLE', 503);
      await sessionRef.set({ status: 'active', tokenGrantedAt: Timestamp.now() }, { merge: true });
      logger.info('Managed Live token granted', {
        requestId: sessionId,
        identityRef: createHash('sha256').update(uid).digest('hex').slice(0, 20),
        tier: privileged ? 'privileged' : allowance,
        model,
        tokenUses: 1,
        sessionMessageExpiryMinutes: 15,
        outcome: 'success',
      });
      res.set('Cache-Control', 'no-store');
      res.status(200).json({
        token: token.name,
        sessionId,
        model,
        reasoningLevel: model === 'gemini-3.8-live-extended-thinking' ? reasoningLevel : null,
        expiresAt: new Date(now + 15 * 60_000).toISOString(),
      });
    } catch (error) {
      if (leaseAcquired) {
        try {
          await db.runTransaction(async transaction => {
            const current = await transaction.get(sessionRef);
            if (current.get('sessionId') === sessionId) transaction.delete(sessionRef);
          });
        } catch { /* fail closed; the 15-minute provider-session lease expires */ }
      }
      logger.warn('Managed Live token request denied', {
        requestId: sessionId,
        identityRef: createHash('sha256').update(uid).digest('hex').slice(0, 20),
        tier: allowance,
        denialCategory: error instanceof RequestFailure ? error.code : 'LIVE_TOKEN_UNAVAILABLE',
      });
      sendError(res, error instanceof RequestFailure ? error : new RequestFailure('LIVE_TOKEN_UNAVAILABLE', 503));
    }
    return;
  }

  if (req.path === '/live-session/end') {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body as Record<string, unknown> : {};
      if (Object.keys(body).length !== 1 || typeof body.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.sessionId)) {
        throw new RequestFailure('INVALID_REQUEST', 400);
      }
      const ended = await db.runTransaction(async transaction => {
        const current = await transaction.get(db.doc(`managedAiLiveSessions/${uid}`));
        if (current.get('sessionId') === body.sessionId && current.get('status') !== 'ended') {
          transaction.set(db.doc(`managedAiLiveSessions/${uid}`), { status: 'ended', endedAt: Timestamp.now(), expiresAtMs: Date.now() }, { merge: true });
          return true;
        }
        return false;
      });
      if (ended) logger.info('Managed Live session end received', {
        requestId: body.sessionId,
        identityRef: createHash('sha256').update(uid).digest('hex').slice(0, 20),
        outcome: 'user_end_received',
      });
      res.set('Cache-Control', 'no-store');
      res.status(200).json({ ended: true });
    } catch (error) { sendError(res, error); }
    return;
  }

  if (req.path === '/models') {
    try {
      const entry = await db.doc(`managedAiAllowlist/${uid}`).get();
      const privileged = allowance === 'account' && Boolean(email) && entry.get('status') === 'active'
        && entry.get('uid') === uid && entry.get('emailLower') === email?.trim().toLowerCase();
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
      const providerModels = new Map<string, { inputTokenLimit?: number; outputTokenLimit?: number; supportedActions?: string[] }>();
      for await (const model of await ai.models.list({ config: { pageSize: 100 } })) {
        const id = String(model.name || '').replace(/^models\//, '').split('/').pop() || '';
        if (id) providerModels.set(id, model);
      }
      const models = SUPPORTED_MANAGED_MODELS
        .filter(model => (privileged || model.id === DEFAULT_MODEL) && (model.functionCalling || model.interactionsApi))
        .flatMap(model => {
          const providerModel = providerModels.get(model.id);
          if (!providerModel || (!model.interactionsApi && !providerModel.supportedActions?.includes('generateContent')) || !providerModel.inputTokenLimit || !providerModel.outputTokenLimit) return [];
          return [{
            id: model.id,
            name: model.name,
            description: model.description,
            reasoningLevels: privileged ? model.reasoningLevels : model.reasoningLevels.filter(level => level === 'low' || level === 'medium'),
            inputTokenLimit: providerModel.inputTokenLimit,
            outputTokenLimit: providerModel.outputTokenLimit,
            supportsFunctionCalling: model.functionCalling,
            interactionsApi: model.interactionsApi === true,
            sharedContextWindow: model.sharedContextWindow === true,
          }];
        });
      const liveIds = privileged
        ? ['gemini-3.8-live', 'gemini-3.8-live-extended-thinking']
        : ['gemini-3.8-live'];
      const liveModels = liveIds.filter(id => providerModels.get(id)?.supportedActions?.includes('bidiGenerateContent')).map(id => ({
        id,
        name: id === 'gemini-3.8-live' ? 'Gemini 3.8 Live' : 'Gemini 3.8 Live Extended Thinking',
        reasoningLevels: id === 'gemini-3.8-live-extended-thinking' ? ['low', 'medium', 'high'] : [],
      }));
      res.set('Cache-Control', 'private, max-age=60');
      res.status(200).json({ models, liveModels, privileged, anonymous: allowance === 'guest' });
    } catch {
      logger.warn('Managed model catalogue unavailable', { code: 'MODEL_CATALOG_UNAVAILABLE' });
      res.status(503).json({ error: { code: 'MODEL_CATALOG_UNAVAILABLE' } });
    }
    return;
  }

  let input: ReturnType<typeof validateGenerationBody>;
  try { input = validateGenerationBody(req.body); }
  catch (error) { sendError(res, error); return; }

  const currentTime = nowMs();
  const refs = input.purpose === 'chat'
    ? turnLedgerRefs(db, uid, input.turnId, input.callId, new Date(currentTime), email, allowance)
    : briefingLedgerRefs(db, uid, input.callId, new Date(currentTime), email, allowance);
  let turnReserved = false;
  let briefingReserved = false;
  let callReserved = false;
  let costReserved = false;

  try {
    if (input.purpose === 'chat') {
      await reserveTurn(db, refs as ReturnType<typeof turnLedgerRefs>, currentTime);
      turnReserved = true;
    } else {
      await reserveBriefing(db, refs as ReturnType<typeof briefingLedgerRefs>, currentTime);
      briefingReserved = true;
    }

    const modelId = input.purpose === 'briefing' ? DEFAULT_MODEL : input.model;
    const reasoningLevel = input.purpose === 'briefing' ? 'low' : input.reasoningLevel || (allowance === 'guest' ? 'low' : 'medium');
    authorizeManagedModel(modelId, reasoningLevel, refs.isPrivileged);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const policyModel = SUPPORTED_MANAGED_MODELS.find(model => model.id === modelId);
    if (!policyModel) throw new RequestFailure('MODEL_UNAVAILABLE', 422);
    // Use provider metadata for the selected model at request time. The static
    // catalogue is an authorization list, not a substitute for current limits.
    const modelInfo = await ai.models.get({ model: modelId });
    if ((!policyModel.interactionsApi && !modelInfo.supportedActions?.includes('generateContent')) ||
        !modelInfo.inputTokenLimit || !modelInfo.outputTokenLimit) {
      throw new RequestFailure('MODEL_UNAVAILABLE', 422);
    }
    const requestsTools = Array.isArray(input.config.tools) && input.config.tools.length > 0;
    if (requestsTools && !policyModel.functionCalling) {
      throw new RequestFailure('MODEL_TOOL_CALLING_UNAVAILABLE', 422);
    }
    const maxOutputTokens = Math.min(outputEnvelope(input.purpose, allowance, refs.isPrivileged), modelInfo.outputTokenLimit);
    const requestedOutputTokens = input.config.maxOutputTokens;
    if (requestedOutputTokens !== undefined && Number(requestedOutputTokens) > maxOutputTokens) {
      throw new RequestFailure('OUTPUT_TOKEN_LIMIT', 413);
    }
    let count: { totalTokens?: unknown };
    try {
      const countResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:countTokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY.value() },
        body: JSON.stringify(buildCountTokensRequest(modelId, input.contents, input.config)),
        signal: AbortSignal.timeout(15_000),
      });
      const countPayload = await countResponse.json() as {
        totalTokens?: unknown;
        error?: { code?: unknown; status?: unknown };
      };
      if (!countResponse.ok) {
        const providerCode = typeof countPayload.error?.status === 'string'
          && /^[A-Z][A-Z0-9_]{0,63}$/.test(countPayload.error.status)
          ? countPayload.error.status : undefined;
        logger.warn('Managed input token count unavailable', {
          code: 'MODEL_CATALOG_UNAVAILABLE', providerStatus: countResponse.status, providerCode,
        });
        throw new RequestFailure('MODEL_CATALOG_UNAVAILABLE', 503);
      }
      count = countPayload;
    } catch (error) {
      if (error instanceof RequestFailure) throw error;
      // Do not send a request whose model-specific context size could not be
      // verified. Log only an error class, never prompts, tool arguments or keys.
      const providerErrorName = error && typeof error === 'object' && 'name' in error
        && typeof error.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
        ? error.name : undefined;
      logger.warn('Managed input token count unavailable', { code: 'MODEL_CATALOG_UNAVAILABLE', providerErrorName });
      throw new RequestFailure('MODEL_CATALOG_UNAVAILABLE', 503);
    }
    const inputTokens = Number(count.totalTokens);
    if (!Number.isSafeInteger(inputTokens) || inputTokens < 0) throw new RequestFailure('MODEL_CATALOG_UNAVAILABLE', 503);
    const requestedOutput = input.config.maxOutputTokens === undefined
      ? maxOutputTokens
      : Number(input.config.maxOutputTokens);
    if (policyModel.sharedContextWindow
      ? inputTokens + requestedOutput > modelInfo.inputTokenLimit
      : inputTokens > modelInfo.inputTokenLimit) throw new RequestFailure('MODEL_CONTEXT_LIMIT', 413);

    const generationConfig = { ...input.config, maxOutputTokens: requestedOutput };
    const estimate = estimateTextGenerationCost(modelId as Parameters<typeof estimateTextGenerationCost>[0], inputTokens, requestedOutput, new Date(currentTime));
    if (input.purpose === 'chat') await reserveGenerationCall(db, refs as ReturnType<typeof turnLedgerRefs>);
    else await reserveBriefingGenerationCall(db, refs as ReturnType<typeof briefingLedgerRefs>);
    callReserved = true;
    await reserveCostExposure(db, refs, estimate, new Date(currentTime));
    costReserved = true;

    const response = policyModel.interactionsApi
      ? await generateArgonStateless({
        apiKey: GEMINI_API_KEY.value(), contents: input.contents,
        config: generationConfig, reasoningLevel,
      })
      : await ai.models.generateContent({
        model: modelId,
        contents: input.contents as Content[],
        config: managedGenerationConfig(generationConfig, reasoningLevel),
      });
    const payload = {
      text: response.text || '',
      candidates: policyModel.interactionsApi ? (response.candidates || []) : sanitizeManagedCandidates(response.candidates || []),
      functionCalls: response.functionCalls || [],
      usageMetadata: response.usageMetadata || null,
      model: modelId,
      reasoningLevel,
    };
    if (input.purpose === 'briefing' && !payload.text.trim()) throw new RequestFailure('GENERATION_FAILED', 502);
    const complete = input.purpose === 'briefing' || isCompletedUserTurn(payload);
    logger.info('Managed AI generation completed', {
      requestId: input.callId,
      identityRef: createHash('sha256').update(uid).digest('hex').slice(0, 20),
      tier: refs.isPrivileged ? 'privileged' : allowance,
      purpose: input.purpose,
      outcome: 'success',
      durationMs: Date.now() - currentTime,
      model: modelId,
      reasoningLevel,
      pricingVersion: estimate.pricingVersion,
      estimatedCostMicroUsd: estimate.estimatedMicroUsd,
      usage: sanitizeUsageMetadata(payload.usageMetadata as Record<string, unknown> | null),
      candidateCount: payload.candidates.length,
      functionCallCount: payload.functionCalls.length,
      completedUserTurn: complete,
    });
    try { await recordGenerationUsage(refs, modelId, reasoningLevel, payload.usageMetadata as Record<string, unknown> | null); }
    catch { logger.warn('Managed AI usage metadata could not be persisted', { model: modelId, reasoningLevel }); }
    const actual = actualTextGenerationCost(modelId as Parameters<typeof actualTextGenerationCost>[0], payload.usageMetadata as Record<string, unknown> | null, new Date(currentTime));
    if (actual) {
      try { await settleCostExposure(refs, actual.actualMicroUsd, actual.pricingVersion); costReserved = false; }
      catch { logger.error('Managed AI cost settlement failed; reservation retained', { requestId: input.callId, code: 'COST_SETTLEMENT_UNAVAILABLE' }); }
    } else if (costReserved) {
      await markCostExposureUncertain(refs);
    }
    if (input.purpose === 'chat') await finishTurn(db, refs as ReturnType<typeof turnLedgerRefs>, complete);
    else await finishBriefing(db, refs as ReturnType<typeof briefingLedgerRefs>, complete);
    res.status(200).json(payload);
  } catch (error) {
    if (costReserved) {
      try { await markCostExposureUncertain(refs); }
      catch { logger.error('Managed AI uncertain-cost reservation could not be marked', { requestId: input.callId, code: 'COST_SETTLEMENT_UNAVAILABLE' }); }
    }
    if (briefingReserved) {
      try { await finishBriefing(db, refs as ReturnType<typeof briefingLedgerRefs>, false); }
      catch { /* reservation expiry and server-only ledger fail closed */ }
    } else if (turnReserved) {
      try { await failTurn(db, refs as ReturnType<typeof turnLedgerRefs>, callReserved); }
      catch { /* fail closed: monthly generation reservations are never refunded */ }
    }
    if (error instanceof RequestFailure) logger.warn('Managed AI request denied', {
      requestId: input.callId,
      identityRef: createHash('sha256').update(uid).digest('hex').slice(0, 20),
      tier: refs.isPrivileged ? 'privileged' : allowance,
      purpose: input.purpose,
      model: input.purpose === 'briefing' ? DEFAULT_MODEL : input.model,
      denialCategory: error.code,
      durationMs: Date.now() - currentTime,
      costReservationStatus: costReserved ? 'uncertain' : 'none',
    });
    if (!(error instanceof RequestFailure)) logger.error('Managed AI generation failed', {
      requestId: input.callId,
      identityRef: createHash('sha256').update(uid).digest('hex').slice(0, 20),
      tier: refs.isPrivileged ? 'privileged' : allowance,
      purpose: input.purpose,
      model: input.purpose === 'briefing' ? DEFAULT_MODEL : input.model,
      outcome: 'uncertain',
      durationMs: Date.now() - currentTime,
      costReservationStatus: costReserved ? 'retained' : 'none',
      code: 'GENERATION_FAILED',
    });
    sendError(res, error instanceof RequestFailure ? error : new RequestFailure('GENERATION_FAILED', 502));
  }
});

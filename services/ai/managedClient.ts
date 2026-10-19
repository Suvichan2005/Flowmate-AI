import { getFirebaseAppCheckToken, getManagedAiUser, isFirebaseConfigured } from '../firebase';

export type ManagedAiFailureCode =
  | 'GUEST_TURN_ALLOWANCE_EXHAUSTED' | 'TURN_ALLOWANCE_EXHAUSTED' | 'BRIEFING_ALLOWANCE_EXHAUSTED' | 'MANAGED_AI_DISABLED'
  | 'AUTH_REQUIRED' | 'APP_CHECK_REQUIRED' | 'RATE_LIMITED' | 'MODEL_CONTEXT_LIMIT' | 'OUTPUT_TOKEN_LIMIT'
  | 'MODEL_NOT_ALLOWED_FOR_ACCOUNT' | 'MODEL_UNAVAILABLE' | 'MODEL_TOOL_CALLING_UNAVAILABLE' | 'UNSUPPORTED_REASONING_LEVEL' | 'MODEL_CATALOG_UNAVAILABLE'
  | 'USAGE_READ_UNAVAILABLE'
  | 'EMAIL_VERIFICATION_REQUIRED'
  | 'GENERATION_FAILED' | 'MANAGED_AI_NOT_CONFIGURED' | 'USER_CALL_IN_PROGRESS' | 'REQUEST_ALREADY_PROCESSED'
  | 'TURN_ALREADY_COMPLETE' | 'INVALID_REQUEST' | 'LIVE_TOKEN_UNAVAILABLE' | 'MODEL_INPUT_UNSUPPORTED' | 'PROVIDER_RATE_LIMITED';

export class ManagedAiError extends Error {
  constructor(readonly code: ManagedAiFailureCode | string, readonly status: number) {
    super(code);
    this.name = 'ManagedAiError';
  }
}

export interface ManagedGenerationResponse {
  text: string;
  candidates: Array<{ content?: { role?: string; parts?: unknown[] } }>;
  functionCalls: Array<{ name: string; args?: Record<string, unknown> }>;
  usageMetadata?: Record<string, number> | null;
  model?: string;
  reasoningLevel?: string;
}

export type AiPurpose = 'chat' | 'briefing';
export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface ManagedModelOption {
  id: string;
  name: string;
  description: string;
  reasoningLevels: ReasoningLevel[];
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportsFunctionCalling: boolean;
  interactionsApi?: boolean;
  sharedContextWindow?: boolean;
}

export interface ManagedLiveModelOption {
  id: 'gemini-3.8-live' | 'gemini-3.8-live-extended-thinking';
  name: string;
  reasoningLevels: ReasoningLevel[];
}

export interface ManagedAiUsage {
  tier: 'guest' | 'account' | 'privileged';
  chat: { successfulTurns: number; monthlyLimit: number | null; month: string; resetAt: string };
  briefings: { successfulThisMonth: number; monthlyLimit: number | null; month: string; resetAt: string };
  tokens: { inputThisMonth: number; outputThisMonth: number; thinkingThisMonth: number; totalThisMonth: number; usageCallsThisMonth: number; month: string };
}

const MANAGED_AI_REGION = 'asia-south1';

export const getManagedAiEndpoint = (): string => {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  // An explicitly empty build value is the release-time kill switch. Keep the
  // production-derived default only for builds that omit the setting entirely.
  const configuredEndpoint = import.meta.env.VITE_MANAGED_AI_ENDPOINT;
  if (configuredEndpoint !== undefined) return configuredEndpoint.trim();
  return import.meta.env.PROD && projectId
    ? `https://${MANAGED_AI_REGION}-${projectId}.cloudfunctions.net/managedGemini`
    : '';
};

export const hasManagedAiIdentity = (): boolean => Boolean(isFirebaseConfigured() && getManagedAiEndpoint());

export async function generateManagedContent(
  contents: unknown[],
  config: Record<string, unknown>,
  turnId: string,
  callId: string,
  signal?: AbortSignal,
  options: { model?: string; reasoningLevel?: ReasoningLevel; purpose?: AiPurpose } = {},
): Promise<ManagedGenerationResponse> {
  const user = await getManagedAiUser();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!user || !projectId) throw new ManagedAiError('AUTH_REQUIRED', 401);

  const endpoint = getManagedAiEndpoint();
  if (!endpoint) throw new ManagedAiError('MANAGED_AI_NOT_CONFIGURED', 503);
  const token = await user.getIdToken(user.emailVerified);
  const appCheckToken = await getFirebaseAppCheckToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      turnId,
      callId,
      contents,
      config,
      model: options.model,
      reasoningLevel: options.reasoningLevel,
      purpose: options.purpose || 'chat',
    }),
    signal,
  });
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new ManagedAiError('GENERATION_FAILED', response.status || 502); }

  if (!response.ok) {
    const code = (payload as { error?: { code?: unknown } })?.error?.code;
    throw new ManagedAiError(typeof code === 'string' ? code : 'GENERATION_FAILED', response.status);
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as ManagedGenerationResponse).candidates)) {
    throw new ManagedAiError('GENERATION_FAILED', 502);
  }
  return payload as ManagedGenerationResponse;
}

export async function getManagedModelOptions(): Promise<{ models: ManagedModelOption[]; liveModels: ManagedLiveModelOption[]; privileged: boolean; anonymous: boolean }> {
  const user = await getManagedAiUser();
  if (!user) throw new ManagedAiError('AUTH_REQUIRED', 401);
  const endpoint = getManagedAiEndpoint();
  if (!endpoint) throw new ManagedAiError('MANAGED_AI_NOT_CONFIGURED', 503);
  const token = await user.getIdToken(user.emailVerified);
  const appCheckToken = await getFirebaseAppCheckToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
  const response = await fetch(`${endpoint}/models`, { headers, cache: 'no-store' });
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new ManagedAiError('MODEL_CATALOG_UNAVAILABLE', response.status || 503); }
  if (!response.ok || !payload || typeof payload !== 'object' || !Array.isArray((payload as { models?: unknown }).models)) {
    const code = (payload as { error?: { code?: unknown } })?.error?.code;
    throw new ManagedAiError(typeof code === 'string' ? code : 'MODEL_CATALOG_UNAVAILABLE', response.status || 503);
  }
  return {
    models: (payload as { models: ManagedModelOption[] }).models,
    liveModels: Array.isArray((payload as { liveModels?: unknown }).liveModels)
      ? (payload as { liveModels: ManagedLiveModelOption[] }).liveModels : [],
    privileged: (payload as { privileged?: unknown }).privileged === true,
    anonymous: (payload as { anonymous?: unknown }).anonymous === true,
  };
}

export async function createManagedLiveSession(
  model: ManagedLiveModelOption['id'],
  reasoningLevel: ReasoningLevel,
  systemInstruction: string,
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
): Promise<{ token: string; sessionId: string; model: ManagedLiveModelOption['id']; reasoningLevel: ReasoningLevel | null; expiresAt: string }> {
  const user = await getManagedAiUser();
  if (!user) throw new ManagedAiError('AUTH_REQUIRED', 401);
  const endpoint = getManagedAiEndpoint();
  if (!endpoint) throw new ManagedAiError('MANAGED_AI_NOT_CONFIGURED', 503);
  const [token, appCheckToken] = await Promise.all([user.getIdToken(user.emailVerified), getFirebaseAppCheckToken()]);
  if (!appCheckToken) throw new ManagedAiError('APP_CHECK_REQUIRED', 401);
  const response = await fetch(`${endpoint}/live-session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Firebase-AppCheck': appCheckToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, reasoningLevel, systemInstruction, tools }),
    cache: 'no-store',
  });
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new ManagedAiError('LIVE_TOKEN_UNAVAILABLE', response.status || 503); }
  if (!response.ok || !payload || typeof payload !== 'object'
    || typeof (payload as { token?: unknown }).token !== 'string'
    || typeof (payload as { sessionId?: unknown }).sessionId !== 'string') {
    const code = (payload as { error?: { code?: unknown } })?.error?.code;
    throw new ManagedAiError(typeof code === 'string' ? code : 'LIVE_TOKEN_UNAVAILABLE', response.status || 503);
  }
  return payload as { token: string; sessionId: string; model: ManagedLiveModelOption['id']; reasoningLevel: ReasoningLevel | null; expiresAt: string };
}

export async function endManagedLiveSession(sessionId: string): Promise<void> {
  const user = await getManagedAiUser();
  const endpoint = getManagedAiEndpoint();
  if (!user || !endpoint) return;
  const [token, appCheckToken] = await Promise.all([user.getIdToken(user.emailVerified), getFirebaseAppCheckToken()]);
  if (!appCheckToken) return;
  await fetch(`${endpoint}/live-session/end`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Firebase-AppCheck': appCheckToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionId }),
    cache: 'no-store',
    keepalive: true,
  });
}

export async function getManagedAiUsage(): Promise<ManagedAiUsage> {
  const user = await getManagedAiUser();
  if (!user) throw new ManagedAiError('AUTH_REQUIRED', 401);
  const endpoint = getManagedAiEndpoint();
  if (!endpoint) throw new ManagedAiError('MANAGED_AI_NOT_CONFIGURED', 503);
  const token = await user.getIdToken(user.emailVerified);
  const appCheckToken = await getFirebaseAppCheckToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
  const response = await fetch(`${endpoint}/usage`, { headers, cache: 'no-store' });
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new ManagedAiError('USAGE_READ_UNAVAILABLE', response.status || 503); }
  if (!response.ok || !payload || typeof payload !== 'object' || !('chat' in payload) || !('briefings' in payload) || !('tokens' in payload)) {
    const code = (payload as { error?: { code?: unknown } })?.error?.code;
    throw new ManagedAiError(typeof code === 'string' ? code : 'USAGE_READ_UNAVAILABLE', response.status || 503);
  }
  return payload as ManagedAiUsage;
}

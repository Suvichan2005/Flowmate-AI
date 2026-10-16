import { auth, getFirebaseAppCheckToken } from '../firebase';

export type ManagedAiFailureCode =
  | 'TURN_ALLOWANCE_EXHAUSTED' | 'GLOBAL_LIMIT_REACHED' | 'MANAGED_AI_DISABLED'
  | 'AUTH_REQUIRED' | 'APP_CHECK_REQUIRED' | 'RATE_LIMITED' | 'INPUT_TOKEN_LIMIT'
  | 'GENERATION_FAILED' | 'MANAGED_AI_NOT_CONFIGURED' | 'USER_CALL_IN_PROGRESS' | 'REQUEST_ALREADY_PROCESSED'
  | 'TURN_ALREADY_COMPLETE' | 'TURN_CALL_LIMIT' | 'INVALID_REQUEST';

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
}

const MANAGED_AI_REGION = 'asia-south1';

const configuredManagedEndpoint = (): string => {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  return import.meta.env.VITE_MANAGED_AI_ENDPOINT || (import.meta.env.PROD && projectId
    ? `https://${MANAGED_AI_REGION}-${projectId}.cloudfunctions.net/managedGemini`
    : '');
};

export const hasManagedAiIdentity = (): boolean => Boolean(auth?.currentUser && configuredManagedEndpoint());

export async function generateManagedContent(
  contents: unknown[],
  config: Record<string, unknown>,
  turnId: string,
  callId: string,
  signal?: AbortSignal,
): Promise<ManagedGenerationResponse> {
  const user = auth?.currentUser;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!user || !projectId) throw new ManagedAiError('AUTH_REQUIRED', 401);

  const endpoint = configuredManagedEndpoint();
  if (!endpoint) throw new ManagedAiError('MANAGED_AI_NOT_CONFIGURED', 503);
  const token = await user.getIdToken();
  const appCheckToken = await getFirebaseAppCheckToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ turnId, callId, contents, config }),
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

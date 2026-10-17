import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth, getFirebaseAppCheckToken } from '../services/firebase';
import { generateManagedContent, hasManagedAiIdentity, ManagedAiError } from '../services/ai/managedClient';

vi.mock('../services/firebase', () => ({
  auth: { currentUser: null },
  getFirebaseAppCheckToken: vi.fn().mockResolvedValue(null),
}));

const mockedAuth = auth as unknown as { currentUser: { getIdToken: () => Promise<string> } | null };
const mockedAppCheck = vi.mocked(getFirebaseAppCheckToken);

describe('managed AI browser client', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); mockedAuth.currentUser = null; mockedAppCheck.mockResolvedValue(null); });

  it('requires Firebase identity before sending a request', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateManagedContent([], {}, 'turn_0000000000000001', 'call_00000000000001'))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not route local development to the production managed endpoint by default', () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_MANAGED_AI_ENDPOINT', '');
    vi.stubEnv('PROD', false);
    mockedAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('unit-test-id-token') };
    expect(hasManagedAiIdentity()).toBe(false);
  });

  it('derives the managed endpoint from project and region in production', () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('PROD', true);
    mockedAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('unit-test-id-token') };
    expect(hasManagedAiIdentity()).toBe(true);
  });

  it('sends verified identity, optional App Check, fixed endpoint, and no caller UID or key', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_MANAGED_AI_ENDPOINT', 'https://asia-south1-flowmate-ai.cloudfunctions.net/managedGemini');
    mockedAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('unit-test-id-token') };
    mockedAppCheck.mockResolvedValue('unit-test-app-check');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ text: 'Plan ready', candidates: [], functionCalls: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await generateManagedContent([{ role: 'user', parts: [{ text: 'Plan my week' }] }],
      { systemInstruction: 'Use evidence' }, 'turn_0000000000000001', 'call_00000000000001');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(String(init.body));
    expect(url).toBe('https://asia-south1-flowmate-ai.cloudfunctions.net/managedGemini');
    expect(headers.Authorization).toBe('Bearer unit-test-id-token');
    expect(headers['X-Firebase-AppCheck']).toBe('unit-test-app-check');
    expect(body.turnId).toBe('turn_0000000000000001');
    expect(body.callId).toBe('call_00000000000001');
    expect(body).not.toHaveProperty('uid');
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('model');
  });

  it('preserves typed quota errors for the exhaustion experience', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_MANAGED_AI_ENDPOINT', 'https://asia-south1-flowmate-ai.cloudfunctions.net/managedGemini');
    mockedAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('unit-test-id-token') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 402, json: async () => ({ error: { code: 'TURN_ALLOWANCE_EXHAUSTED' } }),
    }));
    try {
      await generateManagedContent([], { systemInstruction: 'x' }, 'turn_0000000000000001', 'call_00000000000001');
      throw new Error('expected quota rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ManagedAiError);
      expect(error).toMatchObject({ code: 'TURN_ALLOWANCE_EXHAUSTED', status: 402 });
    }
  });
});

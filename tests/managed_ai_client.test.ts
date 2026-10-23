import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFirebaseAppCheckToken, getManagedAiUser, isFirebaseConfigured } from '../services/firebase';
import { generateManagedContent, getManagedAiEndpoint, getManagedLiveRelayEndpoint, hasManagedAiIdentity, ManagedAiError } from '../services/ai/managedClient';

const mocked = vi.hoisted(() => ({ user: null as { emailVerified: boolean; getIdToken: (forceRefresh?: boolean) => Promise<string> } | null }));

vi.mock('../services/firebase', () => ({
  auth: { get currentUser() { return mocked.user; } },
  getManagedAiUser: vi.fn(async () => mocked.user),
  isFirebaseConfigured: vi.fn(() => true),
  getFirebaseAppCheckToken: vi.fn().mockResolvedValue(null),
}));

const mockedManagedUser = vi.mocked(getManagedAiUser);
const mockedFirebaseConfigured = vi.mocked(isFirebaseConfigured);
const mockedAppCheck = vi.mocked(getFirebaseAppCheckToken);

describe('managed AI browser client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mocked.user = null;
    mockedManagedUser.mockReset();
    mockedManagedUser.mockImplementation(async () => mocked.user as never);
    mockedFirebaseConfigured.mockReturnValue(true);
    mockedAppCheck.mockResolvedValue(null);
  });

  it('requires Firebase identity before sending a request', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_MANAGED_AI_ENDPOINT', 'https://asia-south1-flowmate-ai.cloudfunctions.net/managedGemini');
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
    mocked.user = { emailVerified: true, getIdToken: vi.fn().mockResolvedValue('unit-test-id-token') };
    expect(hasManagedAiIdentity()).toBe(false);
  });

  it('blocks text and Live provider endpoints in demo-emulator mode even when env files contain production URLs', () => {
    vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'true');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-flowmate-sync');
    vi.stubEnv('VITE_MANAGED_AI_ENDPOINT', 'https://asia-south1-flowmate-ai.cloudfunctions.net/managedGemini');
    vi.stubEnv('VITE_MANAGED_LIVE_RELAY_ENDPOINT', 'https://managed-live-relay-preview.example.run.app');
    vi.stubEnv('PROD', false);
    mocked.user = { emailVerified: true, getIdToken: vi.fn().mockResolvedValue('demo-test-id-token') };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(getManagedAiEndpoint()).toBe('');
    expect(getManagedLiveRelayEndpoint()).toBe('');
    expect(hasManagedAiIdentity()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('derives the managed endpoint from project and region in production', () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('PROD', true);
    mocked.user = { emailVerified: true, getIdToken: vi.fn().mockResolvedValue('unit-test-id-token') };
    expect(hasManagedAiIdentity()).toBe(true);
  });

  it('treats an explicitly empty production endpoint as a managed-AI kill switch', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_MANAGED_AI_ENDPOINT', '');
    vi.stubEnv('PROD', true);
    mocked.user = { emailVerified: true, getIdToken: vi.fn().mockResolvedValue('unit-test-id-token') };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(getManagedAiEndpoint()).toBe('');
    expect(hasManagedAiIdentity()).toBe(false);
    await expect(generateManagedContent([], {}, 'turn_0000000000000001', 'call_00000000000001'))
      .rejects.toMatchObject({ code: 'MANAGED_AI_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies an absent emulator endpoint before touching Auth or marking a request uncertain', async () => {
    mockedManagedUser.mockClear();
    vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'true');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-flowmate-sync');
    vi.stubEnv('VITE_MANAGED_AI_ENDPOINT', 'https://asia-south1-flowmate-ai.cloudfunctions.net/managedGemini');
    mockedManagedUser.mockRejectedValueOnce(new Error('synthetic Auth initialization failure'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateManagedContent([], {}, 'turn_0000000000000001', 'call_00000000000001'))
      .rejects.toMatchObject({ code: 'MANAGED_AI_NOT_CONFIGURED', status: 503 });
    expect(mockedManagedUser).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends verified identity, optional App Check, fixed endpoint, and no caller UID or key', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_MANAGED_AI_ENDPOINT', 'https://asia-south1-flowmate-ai.cloudfunctions.net/managedGemini');
    mocked.user = { emailVerified: true, getIdToken: vi.fn().mockResolvedValue('unit-test-id-token') };
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
    mocked.user = { emailVerified: true, getIdToken: vi.fn().mockResolvedValue('unit-test-id-token') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 402, json: async () => ({ error: { code: 'TURN_ALLOWANCE_EXHAUSTED' } }),
    }));
    await expect(generateManagedContent([], { systemInstruction: 'x' }, 'turn_0000000000000001', 'call_00000000000001'))
      .rejects.toMatchObject({ code: 'TURN_ALLOWANCE_EXHAUSTED', status: 402 });
  });

  it('preserves the guest-specific exhaustion code for the sign-in offer', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_MANAGED_AI_ENDPOINT', 'https://asia-south1-flowmate-ai.cloudfunctions.net/managedGemini');
    mocked.user = { emailVerified: false, getIdToken: vi.fn().mockResolvedValue('unit-test-guest-token') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 402, json: async () => ({ error: { code: 'GUEST_TURN_ALLOWANCE_EXHAUSTED' } }),
    }));
    await expect(generateManagedContent([], { systemInstruction: 'x' }, 'turn_0000000000000002', 'call_00000000000002'))
      .rejects.toMatchObject({ code: 'GUEST_TURN_ALLOWANCE_EXHAUSTED', status: 402 });
  });
});

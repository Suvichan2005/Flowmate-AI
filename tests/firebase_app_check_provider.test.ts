import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/app', () => ({
  getApps: () => [],
  initializeApp: vi.fn(() => ({ name: 'flowmate-app-check-test' })),
}));

vi.mock('firebase/app-check', () => ({
  getToken: vi.fn(),
  initializeAppCheck: vi.fn((_app, options) => options),
  ReCaptchaEnterpriseProvider: class ReCaptchaEnterpriseProvider {
    constructor(readonly siteKey: string) {}
  },
  ReCaptchaV3Provider: class ReCaptchaV3Provider {
    constructor(readonly siteKey: string) {}
  },
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  initializeAuth: vi.fn(() => ({})),
  browserLocalPersistence: 'browser-local-persistence',
  setPersistence: vi.fn().mockResolvedValue(undefined),
  signInWithEmailAndPassword: vi.fn().mockResolvedValue({ user: { uid: 'test-user' } }),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class { addScope() {} },
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  initializeFirestore: vi.fn(() => ({})),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({})),
}));

describe('Firebase App Check provider wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the registered Enterprise provider and automatically refreshes tokens', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');
    vi.stubEnv('VITE_FIREBASE_APPCHECK_SITE_KEY', 'public-test-site-key');

    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
    const { initializeAuth, browserLocalPersistence } = await import('firebase/auth');
    await import('../services/firebase');

    expect(initializeAppCheck).toHaveBeenCalledOnce();
    const options = vi.mocked(initializeAppCheck).mock.calls[0][1];
    expect(options.provider).toBeInstanceOf(ReCaptchaEnterpriseProvider);
    expect((options.provider as unknown as { siteKey: string }).siteKey).toBe('public-test-site-key');
    expect(options.isTokenAutoRefreshEnabled).toBe(true);
    expect(initializeAuth).toHaveBeenCalledOnce();
    expect(vi.mocked(initializeAuth).mock.calls[0][1]).toEqual({ persistence: browserLocalPersistence });
  });

  it('sets browser-local persistence before completing an email sign-in', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');

    const { setPersistence, signInWithEmailAndPassword, browserLocalPersistence } = await import('firebase/auth');
    const { signInWithEmail } = await import('../services/firebase');
    const result = await signInWithEmail('test@example.test', 'test-password');

    expect(result.error).toBeNull();
    expect(setPersistence).toHaveBeenCalledWith(expect.any(Object), browserLocalPersistence);
    expect(vi.mocked(setPersistence).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(signInWithEmailAndPassword).mock.invocationCallOrder[0],
    );
  });
});

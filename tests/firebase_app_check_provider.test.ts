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
  signInWithEmailAndPassword: vi.fn(),
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
    await import('../services/firebase');

    expect(initializeAppCheck).toHaveBeenCalledOnce();
    const options = vi.mocked(initializeAppCheck).mock.calls[0][1];
    expect(options.provider).toBeInstanceOf(ReCaptchaEnterpriseProvider);
    expect((options.provider as InstanceType<typeof ReCaptchaEnterpriseProvider>).siteKey).toBe('public-test-site-key');
    expect(options.isTokenAutoRefreshEnabled).toBe(true);
  });
});

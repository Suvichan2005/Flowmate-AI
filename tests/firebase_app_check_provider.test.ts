import { afterEach, describe, expect, it, vi } from 'vitest';

const originalMatchMedia = window.matchMedia;

const authMocks = vi.hoisted(() => ({
  primaryAuth: { currentUser: null as unknown, authStateReady: vi.fn().mockResolvedValue(undefined) },
  guestAuth: { currentUser: null as unknown, authStateReady: vi.fn().mockResolvedValue(undefined) },
  signInAnonymously: vi.fn().mockResolvedValue({ user: { uid: 'guest-user' } }),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn().mockResolvedValue(undefined),
  reauthenticateWithPopup: vi.fn(),
  reauthenticateWithRedirect: vi.fn().mockResolvedValue(undefined),
  linkWithPopup: vi.fn(),
  linkWithRedirect: vi.fn().mockResolvedValue(undefined),
  getRedirectResult: vi.fn().mockResolvedValue(null),
  credentialFromResult: vi.fn().mockReturnValue({ accessToken: null }),
  googleProviders: [] as Array<{ scopes: string[]; addScope: (scope: string) => void }>,
}));

vi.mock('firebase/app', () => ({
  getApps: () => [],
  initializeApp: vi.fn((_config, name) => ({ name: name || 'flowmate-app-check-test' })),
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
  getAuth: vi.fn(app => app.name === 'flowmate-managed-ai-guest' ? authMocks.guestAuth : authMocks.primaryAuth),
  initializeAuth: vi.fn(app => app.name === 'flowmate-managed-ai-guest' ? authMocks.guestAuth : authMocks.primaryAuth),
  browserLocalPersistence: 'browser-local-persistence',
  browserPopupRedirectResolver: 'browser-popup-redirect-resolver',
  setPersistence: vi.fn().mockResolvedValue(undefined),
  signInAnonymously: authMocks.signInAnonymously,
  signInWithEmailAndPassword: vi.fn().mockResolvedValue({ user: { uid: 'test-user' } }),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithPopup: authMocks.signInWithPopup,
  signInWithRedirect: authMocks.signInWithRedirect,
  reauthenticateWithPopup: authMocks.reauthenticateWithPopup,
  reauthenticateWithRedirect: authMocks.reauthenticateWithRedirect,
  linkWithPopup: authMocks.linkWithPopup,
  linkWithRedirect: authMocks.linkWithRedirect,
  getRedirectResult: authMocks.getRedirectResult,
  GoogleAuthProvider: class {
    scopes: string[] = [];
    constructor() { authMocks.googleProviders.push(this); }
    static credentialFromResult = authMocks.credentialFromResult;
    addScope(scope: string) { this.scopes.push(scope); }
  },
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
    authMocks.primaryAuth.currentUser = null;
    authMocks.guestAuth.currentUser = null;
    authMocks.primaryAuth.authStateReady.mockReset().mockResolvedValue(undefined);
    authMocks.guestAuth.authStateReady.mockReset().mockResolvedValue(undefined);
    authMocks.signInAnonymously.mockReset().mockResolvedValue({ user: { uid: 'guest-user' } });
    authMocks.signInWithPopup.mockReset();
    authMocks.signInWithRedirect.mockReset().mockResolvedValue(undefined);
    authMocks.reauthenticateWithPopup.mockReset();
    authMocks.reauthenticateWithRedirect.mockReset().mockResolvedValue(undefined);
    authMocks.linkWithPopup.mockReset();
    authMocks.linkWithRedirect.mockReset().mockResolvedValue(undefined);
    authMocks.getRedirectResult.mockReset().mockResolvedValue(null);
    authMocks.credentialFromResult.mockReset().mockReturnValue({ accessToken: null });
    authMocks.googleProviders.length = 0;
    localStorage.clear();
    if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
    else Reflect.deleteProperty(window, 'matchMedia');
    vi.restoreAllMocks();
  });

  it('uses the registered Enterprise provider and automatically refreshes tokens', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');
    vi.stubEnv('VITE_FIREBASE_APPCHECK_SITE_KEY', 'public-test-site-key');

    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
    const { initializeAuth, browserLocalPersistence, browserPopupRedirectResolver } = await import('firebase/auth');
    await import('../services/firebase');

    expect(initializeAppCheck).toHaveBeenCalledOnce();
    const options = vi.mocked(initializeAppCheck).mock.calls[0][1];
    expect(options.provider).toBeInstanceOf(ReCaptchaEnterpriseProvider);
    expect((options.provider as unknown as { siteKey: string }).siteKey).toBe('public-test-site-key');
    expect(options.isTokenAutoRefreshEnabled).toBe(true);
    expect(initializeAuth).toHaveBeenCalledOnce();
    expect(vi.mocked(initializeAuth).mock.calls[0][1]).toEqual({
      persistence: browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
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

  it('uses redirect-based Google sign-in on mobile instead of a popup', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: true }) });

    const { signInWithGoogle } = await import('../services/firebase');
    const result = await signInWithGoogle();

    expect(result).toMatchObject({ user: null, error: null, redirecting: true });
    expect(authMocks.signInWithRedirect).toHaveBeenCalledOnce();
    expect(authMocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it('keeps Google login limited to basic identity scopes', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');
    authMocks.signInWithPopup.mockResolvedValue({ user: { uid: 'google-user' } });

    const { signInWithGoogle } = await import('../services/firebase');
    await signInWithGoogle();

    expect(authMocks.googleProviders).toHaveLength(2);
    expect(authMocks.googleProviders[0].scopes).toEqual([]);
    expect(authMocks.googleProviders[1].scopes).toEqual([
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ]);
  });

  it('falls back to redirect when a desktop popup is blocked', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: false }) });
    authMocks.signInWithPopup.mockRejectedValue({ code: 'auth/popup-blocked', message: 'Popup blocked' });

    const { signInWithGoogle } = await import('../services/firebase');
    const result = await signInWithGoogle();

    expect(result).toMatchObject({ user: null, error: null, redirecting: true });
    expect(authMocks.signInWithPopup).toHaveBeenCalledOnce();
    expect(authMocks.signInWithRedirect).toHaveBeenCalledOnce();
  });

  it('restores a Calendar token only after an explicit Calendar-scope redirect', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');
    const user = { uid: 'google-user' };
    authMocks.primaryAuth.currentUser = user;
    authMocks.getRedirectResult.mockResolvedValue({ user });
    authMocks.credentialFromResult.mockReturnValue({ accessToken: 'calendar-access-token' });
    sessionStorage.setItem('flowmate.google-calendar-auth-redirect.v1', '1');

    const { completeGoogleRedirectSignIn, getGoogleAccessToken } = await import('../services/firebase');
    const result = await completeGoogleRedirectSignIn();

    expect(authMocks.getRedirectResult).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ user, error: null, accessToken: 'calendar-access-token' });
    expect(getGoogleAccessToken()).toBe('calendar-access-token');
  });

  it('does not treat a basic Google login token as Calendar authorization', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');
    const user = { uid: 'google-user' };
    authMocks.primaryAuth.currentUser = user;
    authMocks.getRedirectResult.mockResolvedValue({ user });
    authMocks.credentialFromResult.mockReturnValue({ accessToken: 'identity-only-token' });

    const { completeGoogleRedirectSignIn, getGoogleAccessToken } = await import('../services/firebase');
    const result = await completeGoogleRedirectSignIn();

    expect(result).toMatchObject({ user, error: null, accessToken: null });
    expect(getGoogleAccessToken()).toBeNull();
  });

  it('keeps Calendar access tokens in memory and rejects them after the active account changes', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');
    localStorage.setItem('flowmate_google_calendar_token', 'legacy-token');
    localStorage.setItem('flowmate_google_calendar_token_expiry', String(Date.now() + 3600000));

    const { getGoogleAccessToken, setGoogleAccessToken } = await import('../services/firebase');
    const { getLatestReviewDraft, saveReviewDraft } = await import('../services/action-review');

    authMocks.primaryAuth.currentUser = { uid: 'account-a' };
    setGoogleAccessToken('account-a-token');
    expect(getGoogleAccessToken()).toBe('account-a-token');
    expect(localStorage.getItem('flowmate_google_calendar_token')).toBeNull();

    authMocks.primaryAuth.currentUser = { uid: 'account-b' };
    expect(getGoogleAccessToken()).toBeNull();

    const draftA = await saveReviewDraft('manual_edit', 'private A draft', [], {}, undefined, 'account-a');
    expect(await getLatestReviewDraft('account-b')).toBeNull();
    expect((await getLatestReviewDraft('account-a'))?.id).toBe(draftA.id);
  });

  it('waits for restored primary Auth before selecting a guest identity', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');

    let restorePrimary!: () => void;
    authMocks.primaryAuth.authStateReady.mockImplementation(() => new Promise<void>(resolve => { restorePrimary = resolve; }));
    const { getManagedAiUser } = await import('../services/firebase');
    const restoredUser = { uid: 'verified-user', emailVerified: true };
    const pendingUser = getManagedAiUser();

    expect(authMocks.primaryAuth.authStateReady).toHaveBeenCalledOnce();
    expect(authMocks.signInAnonymously).not.toHaveBeenCalled();
    authMocks.primaryAuth.currentUser = restoredUser;
    restorePrimary();

    await expect(pendingUser).resolves.toBe(restoredUser);
    expect(authMocks.signInAnonymously).not.toHaveBeenCalled();
    expect(authMocks.guestAuth.authStateReady).not.toHaveBeenCalled();
  });

  it('waits for the persisted guest Auth identity before creating another one', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');

    let restoreGuest!: () => void;
    authMocks.guestAuth.authStateReady.mockImplementation(() => new Promise<void>(resolve => { restoreGuest = resolve; }));
    const { getManagedAiUser } = await import('../services/firebase');
    authMocks.primaryAuth.currentUser = null;
    const persistedGuest = { uid: 'persisted-guest', emailVerified: false };
    const pendingUser = getManagedAiUser();

    expect(authMocks.primaryAuth.authStateReady).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(authMocks.guestAuth.authStateReady).toHaveBeenCalledOnce();
    expect(authMocks.signInAnonymously).not.toHaveBeenCalled();
    authMocks.guestAuth.currentUser = persistedGuest;
    restoreGuest();

    await expect(pendingUser).resolves.toBe(persistedGuest);
    expect(authMocks.signInAnonymously).not.toHaveBeenCalled();
  });

  it('shares one anonymous sign-in when first-load requests race', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-client-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'flowmate-ai.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'flowmate-ai');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:297013476805:web:test');

    let completeSignIn!: (result: { user: { uid: string } }) => void;
    authMocks.signInAnonymously.mockImplementation(() => new Promise(resolve => { completeSignIn = resolve; }));
    const { getManagedAiUser } = await import('../services/firebase');
    const requests = Array.from({ length: 4 }, () => getManagedAiUser());

    await Promise.resolve();
    await Promise.resolve();
    expect(authMocks.signInAnonymously).toHaveBeenCalledOnce();
    const guest = { uid: 'single-guest-user' };
    completeSignIn({ user: guest });

    await expect(Promise.all(requests)).resolves.toEqual([guest, guest, guest, guest]);
  });
});

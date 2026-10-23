/// <reference types="vite/client" />

// Firebase Configuration and Initialization
// 
// SECURITY: All credentials MUST come from environment variables.
// Create a .env.local file with the following variables:
// VITE_FIREBASE_API_KEY=your_api_key
// VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
// VITE_FIREBASE_PROJECT_ID=your_project_id
// VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
// VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
// VITE_FIREBASE_APP_ID=your_app_id
// VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getToken as getAppCheckToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import {
    getAuth,
    initializeAuth,
    browserLocalPersistence,
    browserPopupRedirectResolver,
    setPersistence,
    signInAnonymously,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect,
    reauthenticateWithPopup,
    reauthenticateWithRedirect,
    linkWithPopup,
    linkWithRedirect,
    getRedirectResult,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    connectAuthEmulator,
    sendEmailVerification,
    reload,
    User
} from 'firebase/auth';
import {
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    connectFirestoreEmulator,
    Firestore
} from 'firebase/firestore';
import type { Auth } from 'firebase/auth';
import { resolveFirebaseAuthDomain } from './firebaseAuthDomain';
import { resolveFirebaseEmulatorMode } from './firebaseEmulatorConfig';

// Validate required environment variables
const validateEnvVar = (name: string, value: string | undefined): string => {
    if (!value || value.trim() === '') {
        console.warn(`[Firebase] Missing environment variable: ${name}. Firebase features will be disabled.`);
        return '';
    }
    return value;
};

// Firebase configuration from environment variables
const firebaseConfig = {
    apiKey: validateEnvVar('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
    authDomain: resolveFirebaseAuthDomain(
        typeof window !== 'undefined' ? window.location.hostname : '',
        validateEnvVar('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
    ),
    projectId: validateEnvVar('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: validateEnvVar('VITE_FIREBASE_STORAGE_BUCKET', import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: validateEnvVar('VITE_FIREBASE_MESSAGING_SENDER_ID', import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: validateEnvVar('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID),
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '' // Optional
};
// Check if Firebase is properly configured before initializing
const hasValidConfig = !!(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

const emulatorModeRequested = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
const useFirebaseEmulators = resolveFirebaseEmulatorMode({
    requested: emulatorModeRequested,
    syncDemoRequested: import.meta.env.VITE_SYNC_DEMO_MODE === 'true',
    isDevelopmentBuild: import.meta.env.DEV,
    protocol: typeof window !== 'undefined' ? window.location.protocol : '',
    hostname: typeof window !== 'undefined' ? window.location.hostname : '',
    projectId: firebaseConfig.projectId,
});

if (useFirebaseEmulators && !hasValidConfig) {
    throw new Error('Firebase emulator mode requires complete Firebase client configuration.');
}

// Initialize Firebase only if config is valid
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let managedAiGuestAuth: Auth | null = null;
let managedAiGuestSignIn: Promise<User | null> | null = null;
let db: Firestore | null = null;
let googleProvider: GoogleAuthProvider | null = null;
let googleCalendarProvider: GoogleAuthProvider | null = null;
let appCheck: AppCheck | null = null;

if (hasValidConfig) {
    if (getApps().length === 0) {
        app = initializeApp(firebaseConfig);
    } else {
        app = getApps()[0];
    }

    // The emulator path is opt-in, development-only, and hard-pinned to the
    // loopback endpoints declared in firebase.json. It must never silently
    // redirect a deployed or non-local build away from production services.
    // Initialize App Check before accessing production Firebase services.
    // Local emulators do not require production App Check and must not cause
    // reCAPTCHA exchanges during isolated synchronization acceptance.
    const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
    if (!useFirebaseEmulators && appCheckSiteKey && typeof window !== 'undefined') {
        try {
            appCheck = initializeAppCheck(app, {
                provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
                isTokenAutoRefreshEnabled: true,
            });
        } catch {
            appCheck = null;
        }
    }

    // Export services
    try {
        auth = initializeAuth(app, {
            persistence: browserLocalPersistence,
            popupRedirectResolver: browserPopupRedirectResolver,
        });
    } catch {
        // Preserve the existing instance during HMR; on a fresh load this makes
        // the intended cross-reload Auth persistence explicit.
        auth = getAuth(app);
    }
    if (useFirebaseEmulators && auth) {
        // Fail closed on emulator setup problems. Never let an explicit test
        // run silently fall through to the configured production project.
        connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    }
    try {
        db = initializeFirestore(app, {
            localCache: persistentLocalCache({
                tabManager: persistentMultipleTabManager(),
            }),
        });
        console.log('[Firebase] Initialized Firestore with multi-tab persistent IndexedDB cache');
    } catch (e) {
        db = getFirestore(app);
        console.log('[Firebase] Using existing Firestore instance:', e);
    }
    if (useFirebaseEmulators && db) {
        connectFirestoreEmulator(db, '127.0.0.1', 18080);
    }

    // Basic sign-in asks only for Firebase identity. Calendar access is a
    // separate, user-initiated permission requested from the Calendar flow.
    googleProvider = new GoogleAuthProvider();
    googleCalendarProvider = new GoogleAuthProvider();
    googleCalendarProvider.addScope('https://www.googleapis.com/auth/calendar');
    googleCalendarProvider.addScope('https://www.googleapis.com/auth/calendar.events');

} else {
    console.warn('[Firebase] Configuration incomplete - Firebase features disabled');
}

export { auth, db };

/**
 * Guest AI identity is deliberately isolated from the app's signed-in Auth
 * instance. App.tsx uses that primary instance to start workspace cloud sync;
 * an anonymous AI identity must never trigger that sync implicitly.
 */
const getManagedAiGuestAuth = (): Auth | null => {
    if (!app) return null;
    if (managedAiGuestAuth) return managedAiGuestAuth;
    try {
        const guestApp = getApps().find(candidate => candidate.name === 'flowmate-managed-ai-guest')
            || initializeApp(firebaseConfig, 'flowmate-managed-ai-guest');
        try {
            managedAiGuestAuth = initializeAuth(guestApp, { persistence: browserLocalPersistence });
        } catch {
            // HMR may preserve the named app/Auth instance between module evaluations.
            managedAiGuestAuth = getAuth(guestApp);
        }
        return managedAiGuestAuth;
    } catch {
        return null;
    }
};

/** Returns the verified account identity or silently creates a persistent guest identity for AI only. */
export const getManagedAiUser = async (): Promise<User | null> => {
    // Firebase restores browser-persistent Auth asynchronously after page load.
    // Wait for that first state before deciding this visitor needs an isolated
    // anonymous AI identity; otherwise a verified session can race guest creation.
    if (!auth) return null;
    try {
        await auth.authStateReady();
    } catch {
        return null;
    }
    const signedInUser = auth.currentUser;
    if (signedInUser?.emailVerified) return signedInUser;
    const guestAuth = getManagedAiGuestAuth();
    if (!guestAuth) return null;
    try {
        // Apply the same hydration barrier to the separate guest app so an ordinary
        // reload reuses its persisted UID instead of racing a second anonymous login.
        await guestAuth.authStateReady();
    } catch {
        return null;
    }
    if (guestAuth.currentUser) return guestAuth.currentUser;
    // Model catalogue, usage and generation requests can all initialize the
    // guest identity at once. Share one sign-in operation so a fresh visitor
    // cannot receive multiple anonymous UIDs and multiply the per-UID allowance.
    if (!managedAiGuestSignIn) {
        managedAiGuestSignIn = signInAnonymously(guestAuth)
            .then(({ user }) => user)
            .catch(() => null)
            .finally(() => { managedAiGuestSignIn = null; });
    }
    return managedAiGuestSignIn;
};

/** Returns a short-lived App Check token when this app has been configured. */
export const getFirebaseAppCheckToken = async (): Promise<string | null> => {
    if (!appCheck) return null;
    try { return (await getAppCheckToken(appCheck, false)).token; }
    catch { return null; }
};

// Calendar OAuth access tokens are short lived and must never persist across
// account changes or remain readable to scripts through origin-wide storage.
let googleAccessToken: string | null = null;
let googleTokenOwnerUid: string | null = null;
let googleTokenExpiresAt = 0;
const GOOGLE_CALENDAR_REDIRECT_KEY = 'flowmate.google-calendar-auth-redirect.v1';
if (typeof localStorage !== 'undefined') {
    try {
        localStorage.removeItem('flowmate_google_calendar_token');
        localStorage.removeItem('flowmate_google_calendar_token_expiry');
    } catch { /* The in-memory token path remains available when storage is blocked. */ }
}

/** Returns the stored token only if NOT expired (with 5-min buffer). */
export const getGoogleAccessToken = (): string | null => {
    if (googleAccessToken && googleTokenOwnerUid && auth?.currentUser?.uid === googleTokenOwnerUid
        && Date.now() < googleTokenExpiresAt - 5 * 60 * 1000) {
        return googleAccessToken;
    }
    if (googleTokenOwnerUid !== auth?.currentUser?.uid || Date.now() >= googleTokenExpiresAt - 5 * 60 * 1000) {
        setGoogleAccessToken(null);
    }
    return null;
};

export const setGoogleAccessToken = (token: string | null) => {
    googleAccessToken = token;
    googleTokenOwnerUid = token ? auth?.currentUser?.uid || null : null;
    if (token && googleTokenOwnerUid) {
        googleTokenExpiresAt = Date.now() + 3600 * 1000;
    } else {
        googleAccessToken = null;
        googleTokenExpiresAt = 0;
    }
};

// Re-authenticate to get fresh Google Calendar token
export const refreshGoogleCalendarToken = async (): Promise<string | null> => {
    if (!auth || !googleCalendarProvider) return null;
    try {
        const user = auth.currentUser;
        const hasGoogleProvider = !!user?.providerData.some(provider => provider.providerId === 'google.com');
        if (isMobileGoogleAuthContext()) {
            sessionStorage.setItem(GOOGLE_CALENDAR_REDIRECT_KEY, '1');
            if (user && hasGoogleProvider) await reauthenticateWithRedirect(user, googleCalendarProvider);
            else if (user) await linkWithRedirect(user, googleCalendarProvider);
            else await signInWithRedirect(auth, googleCalendarProvider);
            return null;
        }
        const result = user
            ? hasGoogleProvider
                ? await reauthenticateWithPopup(user, googleCalendarProvider)
                : await linkWithPopup(user, googleCalendarProvider)
            : await signInWithPopup(auth, googleCalendarProvider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
            setGoogleAccessToken(credential.accessToken);
            console.log('[Firebase] Google Calendar token refreshed');
            return credential.accessToken;
        }
        return null;
    } catch (error: any) {
        console.error('[Firebase] Failed to refresh Google token:', error);
        return null;
    }
};

// --- Auth Functions ---

export const signInWithEmail = async (email: string, password: string) => {
    if (!auth) return { user: null, error: 'Firebase not configured' };
    try {
        await setPersistence(auth, browserLocalPersistence);
        const result = await signInWithEmailAndPassword(auth, email, password);
        return { user: result.user, error: null };
    } catch (error: any) {
        return { user: null, error: error.message };
    }
};

export const signUpWithEmail = async (email: string, password: string) => {
    if (!auth) return { user: null, error: 'Firebase not configured' };
    try {
        await setPersistence(auth, browserLocalPersistence);
        const result = await createUserWithEmailAndPassword(auth, email, password);
        try {
            await sendEmailVerification(result.user);
            return { user: result.user, error: null };
        } catch (error: any) {
            // Account creation succeeded; preserve the user so the UI can offer a resend.
            return { user: result.user, error: error.message || 'Account created, but the verification email could not be sent.' };
        }
    } catch (error: any) {
        return { user: null, error: error.message };
    }
};

export const resendVerificationEmail = async () => {
    if (!auth?.currentUser) return { error: 'Sign in to resend the verification email.' };
    try {
        await sendEmailVerification(auth.currentUser);
        return { error: null };
    } catch (error: any) {
        return { error: error.message || 'The verification email could not be sent.' };
    }
};

export const refreshEmailVerification = async () => {
    const user = auth?.currentUser;
    if (!user) return { verified: false, error: 'Sign in to continue.' };
    try {
        await reload(user);
        return { verified: user.emailVerified, error: null };
    } catch (error: any) {
        return { verified: false, error: error.message || 'Could not refresh verification status.' };
    }
};

export const signInWithGoogle = async () => {
    if (!auth || !googleProvider) return { user: null, error: 'Firebase not configured', accessToken: null, redirecting: false };
    try {
        await setPersistence(auth, browserLocalPersistence);
        // Mobile browsers and installed PWAs often block or mis-handle OAuth
        // popups. Redirect keeps the same Firebase Auth persistence and returns
        // to the current URL, where completeGoogleRedirectSignIn consumes it.
        if (isMobileGoogleAuthContext()) {
            await signInWithRedirect(auth, googleProvider);
            return { user: null, error: null, accessToken: null, redirecting: true };
        }
        const result = await signInWithPopup(auth, googleProvider);

        return { user: result.user, error: null, accessToken: null, redirecting: false };
    } catch (error: any) {
        // A blocked desktop popup can still use the redirect flow. Avoid
        // silently retrying on cancellation or provider/configuration errors.
        if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/operation-not-supported-in-this-environment') {
            try {
                await signInWithRedirect(auth, googleProvider);
                return { user: null, error: null, accessToken: null, redirecting: true };
            } catch (redirectError: any) {
                return { user: null, error: redirectError?.message || error.message, accessToken: null, redirecting: false };
            }
        }
        return { user: null, error: error.message, accessToken: null, redirecting: false };
    }
};

const isMobileGoogleAuthContext = (): boolean => {
    if (typeof window === 'undefined') return false;
    const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const mobileUserAgent = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return coarsePointer || mobileUserAgent;
};

/** Completes a Google OAuth redirect after the browser returns to Flowmate. */
export const completeGoogleRedirectSignIn = async () => {
    if (!auth || !googleProvider) return { user: null, error: null, accessToken: null };
    try {
        const result = await getRedirectResult(auth);
        if (!result) return { user: null, error: null, accessToken: null };

        let accessToken: string | null = null;
        try {
            if (sessionStorage.getItem(GOOGLE_CALENDAR_REDIRECT_KEY) === '1') {
                sessionStorage.removeItem(GOOGLE_CALENDAR_REDIRECT_KEY);
                const credential = GoogleAuthProvider.credentialFromResult(result);
                if (credential?.accessToken) {
                    setGoogleAccessToken(credential.accessToken);
                    accessToken = credential.accessToken;
                }
            }
        } catch { /* Session storage can be unavailable in privacy-restricted browsers. */ }
        return { user: result.user, error: null, accessToken };
    } catch (error: any) {
        return { user: null, error: error?.message || 'Google sign-in could not be completed.', accessToken: null };
    }
};

export const signOut = async () => {
    if (!auth) return { error: 'Firebase not configured' };
    try {
        await firebaseSignOut(auth);
        return { error: null };
    } catch (error: any) {
        return { error: error.message };
    }
};

// Auth state observer helper
export const onAuthChange = (callback: (user: User | null) => void) => {
    if (!auth) {
        // Call with null immediately if Firebase not configured
        callback(null);
        return () => { }; // Return empty unsubscribe
    }
    return onAuthStateChanged(auth, user => {
        if (googleTokenOwnerUid && googleTokenOwnerUid !== (user?.uid || null)) setGoogleAccessToken(null);
        callback(user);
    });
};

// Check if Firebase is properly configured
export const isFirebaseConfigured = (): boolean => {
    // Check if essential config values are present
    return !!(
        firebaseConfig.apiKey &&
        firebaseConfig.authDomain &&
        firebaseConfig.projectId &&
        firebaseConfig.appId
    );
};

export type { User };

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
    setPersistence,
    signInAnonymously,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    sendEmailVerification,
    reload,
    User
} from 'firebase/auth';
import {
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    Firestore
} from 'firebase/firestore';
import type { Auth } from 'firebase/auth';

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
    authDomain: validateEnvVar('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
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

// Initialize Firebase only if config is valid
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let managedAiGuestAuth: Auth | null = null;
let db: Firestore | null = null;
let googleProvider: GoogleAuthProvider | null = null;
let appCheck: AppCheck | null = null;

if (hasValidConfig) {
    if (getApps().length === 0) {
        app = initializeApp(firebaseConfig);
    } else {
        app = getApps()[0];
    }

    // Initialize App Check before accessing Firebase services when configured.
    const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
    if (appCheckSiteKey && typeof window !== 'undefined') {
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
        auth = initializeAuth(app, { persistence: browserLocalPersistence });
    } catch {
        // Preserve the existing instance during HMR; on a fresh load this makes
        // the intended cross-reload Auth persistence explicit.
        auth = getAuth(app);
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

    // Auth providers
    googleProvider = new GoogleAuthProvider();
    // Request Google Calendar access scope
    googleProvider.addScope('https://www.googleapis.com/auth/calendar');
    googleProvider.addScope('https://www.googleapis.com/auth/calendar.events');

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
    try {
        return (await signInAnonymously(guestAuth)).user;
    } catch {
        return null;
    }
};

/** Returns a short-lived App Check token when this app has been configured. */
export const getFirebaseAppCheckToken = async (): Promise<string | null> => {
    if (!appCheck) return null;
    try { return (await getAppCheckToken(appCheck, false)).token; }
    catch { return null; }
};

// Store the access token for Calendar API (with localStorage persistence + expiry)
const GOOGLE_TOKEN_KEY = 'flowmate_google_calendar_token';
const GOOGLE_TOKEN_EXPIRY_KEY = 'flowmate_google_calendar_token_expiry';
let googleAccessToken: string | null = localStorage.getItem(GOOGLE_TOKEN_KEY);
let googleTokenExpiresAt: number = Number(localStorage.getItem(GOOGLE_TOKEN_EXPIRY_KEY)) || 0;

/** Returns the stored token only if NOT expired (with 5-min buffer). */
export const getGoogleAccessToken = (): string | null => {
    if (googleAccessToken && Date.now() < googleTokenExpiresAt - 5 * 60 * 1000) {
        return googleAccessToken;
    }
    // Token expired or missing — caller should refreshGoogleCalendarToken()
    return null;
};

export const setGoogleAccessToken = (token: string | null) => {
    googleAccessToken = token;
    if (token) {
        // Google OAuth tokens expire after ~1 hour
        googleTokenExpiresAt = Date.now() + 3600 * 1000;
        localStorage.setItem(GOOGLE_TOKEN_KEY, token);
        localStorage.setItem(GOOGLE_TOKEN_EXPIRY_KEY, String(googleTokenExpiresAt));
    } else {
        googleTokenExpiresAt = 0;
        localStorage.removeItem(GOOGLE_TOKEN_KEY);
        localStorage.removeItem(GOOGLE_TOKEN_EXPIRY_KEY);
    }
};

// Re-authenticate to get fresh Google Calendar token
export const refreshGoogleCalendarToken = async (): Promise<string | null> => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
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
    if (!auth || !googleProvider) return { user: null, error: 'Firebase not configured', accessToken: null };
    try {
        await setPersistence(auth, browserLocalPersistence);
        const result = await signInWithPopup(auth, googleProvider);

        // Extract OAuth access token for Google Calendar API
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
            setGoogleAccessToken(credential.accessToken);
            console.log('[Firebase] Google Calendar access token obtained');
        }

        return { user: result.user, error: null, accessToken: googleAccessToken };
    } catch (error: any) {
        return { user: null, error: error.message, accessToken: null };
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
    return onAuthStateChanged(auth, callback);
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

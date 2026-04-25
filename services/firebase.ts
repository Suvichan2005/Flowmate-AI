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
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    User
} from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
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
let db: Firestore | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (hasValidConfig) {
    if (getApps().length === 0) {
        app = initializeApp(firebaseConfig);
    } else {
        app = getApps()[0];
    }

    // Export services
    auth = getAuth(app);
    db = getFirestore(app);

    // Auth providers
    googleProvider = new GoogleAuthProvider();
    // Request Google Calendar access scope
    googleProvider.addScope('https://www.googleapis.com/auth/calendar');
    googleProvider.addScope('https://www.googleapis.com/auth/calendar.events');
} else {
    console.warn('[Firebase] Configuration incomplete - Firebase features disabled');
}

export { auth, db };

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
        const result = await signInWithEmailAndPassword(auth, email, password);
        return { user: result.user, error: null };
    } catch (error: any) {
        return { user: null, error: error.message };
    }
};

export const signUpWithEmail = async (email: string, password: string) => {
    if (!auth) return { user: null, error: 'Firebase not configured' };
    try {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        return { user: result.user, error: null };
    } catch (error: any) {
        return { user: null, error: error.message };
    }
};

export const signInWithGoogle = async () => {
    if (!auth || !googleProvider) return { user: null, error: 'Firebase not configured', accessToken: null };
    try {
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

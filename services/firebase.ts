/// <reference types="vite/client" />

// Firebase Configuration and Initialization
// Flowmate Project - REDACTED_PROJECT_ID

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

// Firebase configuration - Flowmate Project
const firebaseConfig = {
    apiKey: "REDACTED_FIREBASE_API_KEY",
    authDomain: "REDACTED_PROJECT_ID.firebaseapp.com",
    projectId: "REDACTED_PROJECT_ID",
    storageBucket: "REDACTED_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "1018297319449",
    appId: "1:1018297319449:web:d813a1b440ef94cc6faa88",
    measurementId: "G-851207Z1JN"
};

// Initialize Firebase (prevent multiple initializations)
let app: FirebaseApp;
if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApps()[0];
}

// Export services
export const auth = getAuth(app);
export const db: Firestore = getFirestore(app);

// Auth providers
const googleProvider = new GoogleAuthProvider();
// Request Google Calendar access scope
googleProvider.addScope('https://www.googleapis.com/auth/calendar');
googleProvider.addScope('https://www.googleapis.com/auth/calendar.events');

// Store the access token for Calendar API (with localStorage persistence)
const GOOGLE_TOKEN_KEY = 'flowmate_google_calendar_token';
let googleAccessToken: string | null = localStorage.getItem(GOOGLE_TOKEN_KEY);

export const getGoogleAccessToken = () => googleAccessToken;

export const setGoogleAccessToken = (token: string | null) => {
    googleAccessToken = token;
    if (token) {
        localStorage.setItem(GOOGLE_TOKEN_KEY, token);
    } else {
        localStorage.removeItem(GOOGLE_TOKEN_KEY);
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
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        return { user: result.user, error: null };
    } catch (error: any) {
        return { user: null, error: error.message };
    }
};

export const signUpWithEmail = async (email: string, password: string) => {
    try {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        return { user: result.user, error: null };
    } catch (error: any) {
        return { user: null, error: error.message };
    }
};

export const signInWithGoogle = async () => {
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
    try {
        await firebaseSignOut(auth);
        return { error: null };
    } catch (error: any) {
        return { error: error.message };
    }
};

// Auth state observer helper
export const onAuthChange = (callback: (user: User | null) => void) => {
    return onAuthStateChanged(auth, callback);
};

// Check if Firebase is properly configured
export const isFirebaseConfigured = (): boolean => {
    return true; // Config is now hardcoded
};

export type { User };

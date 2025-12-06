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

// Store the access token for Calendar API
let googleAccessToken: string | null = null;

export const getGoogleAccessToken = () => googleAccessToken;

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
            googleAccessToken = credential.accessToken;
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

/// <reference types="vite/client" />

// Firebase Configuration and Initialization
// Flowmate Project - flowmate-1ffb0

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
    apiKey: "AIzaSyD92N2yjIxU_Mjm3RNmuW23OJtGbPQl89o",
    authDomain: "flowmate-1ffb0.firebaseapp.com",
    projectId: "flowmate-1ffb0",
    storageBucket: "flowmate-1ffb0.firebasestorage.app",
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
        return { user: result.user, error: null };
    } catch (error: any) {
        return { user: null, error: error.message };
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

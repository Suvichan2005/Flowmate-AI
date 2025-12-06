// Firestore Sync Service
// Handles syncing entities and relationships to/from Firestore

import {
    doc,
    collection,
    setDoc,
    getDoc,
    getDocs,
    writeBatch,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';
import { Entity, Relationship, ToonOperation, TagDefinition } from '../types';

// Collection paths
const USERS_COLLECTION = 'users';

interface UserData {
    entities: Entity[];
    relationships: Relationship[];
    universalTags: TagDefinition[];
    lastSyncedAt: Timestamp | null;
}

// --- Read Operations ---

export const loadUserData = async (userId: string): Promise<UserData | null> => {
    if (!isFirebaseConfigured()) {
        console.warn('[FirestoreSync] Firebase not configured, skipping load');
        return null;
    }

    try {
        const userDocRef = doc(db, USERS_COLLECTION, userId);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            return {
                entities: data.entities || [],
                relationships: data.relationships || [],
                universalTags: data.universalTags || [],
                lastSyncedAt: data.lastSyncedAt || null
            };
        }

        return null;
    } catch (error) {
        console.error('[FirestoreSync] Load failed:', error);
        return null;
    }
};

// --- Write Operations ---

export const saveUserData = async (
    userId: string,
    data: {
        entities: Entity[];
        relationships: Relationship[];
        universalTags?: TagDefinition[];
    }
): Promise<boolean> => {
    if (!isFirebaseConfigured()) {
        console.warn('[FirestoreSync] Firebase not configured, skipping save');
        return false;
    }

    try {
        const userDocRef = doc(db, USERS_COLLECTION, userId);

        await setDoc(userDocRef, {
            entities: data.entities,
            relationships: data.relationships,
            universalTags: data.universalTags || [],
            lastSyncedAt: serverTimestamp()
        }, { merge: true });

        console.log('[FirestoreSync] Data saved successfully');
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Save failed:', error);
        return false;
    }
};

// --- Incremental Sync ---

export const syncOperation = async (
    userId: string,
    operation: ToonOperation,
    currentData: { entities: Entity[]; relationships: Relationship[] }
): Promise<boolean> => {
    if (!isFirebaseConfigured()) {
        return false;
    }

    // For simplicity, we do a full sync after each operation
    // A more advanced implementation would use subcollections and batch writes
    return saveUserData(userId, currentData);
};

// --- Merge Strategy ---

// When loading from Firestore, merge with local data
// Conflict resolution: Server wins for same entity ID, local wins for new entities
export const mergeData = (
    local: { entities: Entity[]; relationships: Relationship[] },
    remote: { entities: Entity[]; relationships: Relationship[] }
): { entities: Entity[]; relationships: Relationship[] } => {
    const mergedEntities = new Map<string, Entity>();
    const mergedRelationships = new Map<string, Relationship>();

    // Add remote first (server priority)
    remote.entities.forEach(e => mergedEntities.set(e.id, e));
    remote.relationships.forEach(r => mergedRelationships.set(r.id, r));

    // Add local only if not in remote (new local items)
    local.entities.forEach(e => {
        if (!mergedEntities.has(e.id)) {
            mergedEntities.set(e.id, e);
        }
    });
    local.relationships.forEach(r => {
        if (!mergedRelationships.has(r.id)) {
            mergedRelationships.set(r.id, r);
        }
    });

    return {
        entities: Array.from(mergedEntities.values()),
        relationships: Array.from(mergedRelationships.values())
    };
};

// --- Delete User Data ---

export const deleteUserData = async (userId: string): Promise<boolean> => {
    if (!isFirebaseConfigured()) {
        return false;
    }

    try {
        const userDocRef = doc(db, USERS_COLLECTION, userId);
        await setDoc(userDocRef, {
            entities: [],
            relationships: [],
            universalTags: [],
            deletedAt: serverTimestamp()
        });

        return true;
    } catch (error) {
        console.error('[FirestoreSync] Delete failed:', error);
        return false;
    }
};

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
    Timestamp,
    onSnapshot,
    Unsubscribe
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

// --- Real-time Listener ---

let unsubscribe: Unsubscribe | null = null;

export const subscribeToUserData = (
    userId: string,
    onDataChange: (data: UserData) => void
): Unsubscribe => {
    if (!isFirebaseConfigured()) {
        console.warn('[FirestoreSync] Firebase not configured, skipping subscription');
        return () => { };
    }

    // Unsubscribe from previous listener if exists
    if (unsubscribe) {
        unsubscribe();
    }

    const userDocRef = doc(db, USERS_COLLECTION, userId);

    unsubscribe = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            console.log('[FirestoreSync] Real-time update received');
            onDataChange({
                entities: data.entities || [],
                relationships: data.relationships || [],
                universalTags: data.universalTags || [],
                lastSyncedAt: data.lastSyncedAt || null
            });
        }
    }, (error) => {
        console.error('[FirestoreSync] Real-time listener error:', error);
    });

    return unsubscribe;
};

export const unsubscribeFromUserData = () => {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
};

// --- Read Operations ---

export const loadUserData = async (userId: string): Promise<UserData | null> => {
    console.log('[FirestoreSync] loadUserData called with userId:', userId);

    if (!isFirebaseConfigured()) {
        console.warn('[FirestoreSync] Firebase not configured, skipping load');
        return null;
    }

    try {
        const userDocRef = doc(db, USERS_COLLECTION, userId);
        console.log('[FirestoreSync] Reading document path:', `${USERS_COLLECTION}/${userId}`);

        const userDoc = await getDoc(userDocRef);
        console.log('[FirestoreSync] Document exists?', userDoc.exists());

        if (userDoc.exists()) {
            const data = userDoc.data();
            console.log('[FirestoreSync] Document data keys:', Object.keys(data));
            console.log('[FirestoreSync] Entities count:', data.entities?.length || 0);

            return {
                entities: data.entities || [],
                relationships: data.relationships || [],
                universalTags: data.universalTags || [],
                lastSyncedAt: data.lastSyncedAt || null
            };
        }

        console.log('[FirestoreSync] Document does not exist at path:', `${USERS_COLLECTION}/${userId}`);
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

// FIXED: Local-first with timestamp-based conflict resolution
// When loading from Firestore, merge with local data using updated_at timestamps
// Whichever version is newer wins for duplicate IDs
export const mergeData = (
    local: { entities: Entity[]; relationships: Relationship[] },
    remote: { entities: Entity[]; relationships: Relationship[] }
): { entities: Entity[]; relationships: Relationship[] } => {
    const mergedEntities = new Map<string, Entity>();
    const mergedRelationships = new Map<string, Relationship>();

    // Add all remote entities first
    remote.entities.forEach(e => mergedEntities.set(e.id, e));

    // For local entities: keep if not in remote OR if local is newer
    local.entities.forEach(localEntity => {
        const remoteEntity = mergedEntities.get(localEntity.id);

        if (!remoteEntity) {
            // New local entity, keep it
            mergedEntities.set(localEntity.id, localEntity);
        } else {
            // Conflict: compare updated_at timestamps (local wins if equal or local is newer)
            const localTime = new Date(localEntity.updated_at || localEntity.created_at).getTime();
            const remoteTime = new Date(remoteEntity.updated_at || remoteEntity.created_at).getTime();

            if (localTime >= remoteTime) {
                // Local is same age or newer - LOCAL WINS
                mergedEntities.set(localEntity.id, localEntity);
                console.log(`[Merge] Local wins for "${localEntity.title}" (local: ${localTime}, remote: ${remoteTime})`);
            } else {
                // Remote is newer - keep remote (already in map)
                console.log(`[Merge] Remote wins for "${localEntity.title}" (local: ${localTime}, remote: ${remoteTime})`);
            }
        }
    });

    // Same logic for relationships
    remote.relationships.forEach(r => mergedRelationships.set(r.id, r));
    local.relationships.forEach(localRel => {
        const remoteRel = mergedRelationships.get(localRel.id);
        if (!remoteRel) {
            mergedRelationships.set(localRel.id, localRel);
        } else {
            const localTime = new Date(localRel.created_at).getTime();
            const remoteTime = new Date(remoteRel.created_at).getTime();
            if (localTime >= remoteTime) {
                mergedRelationships.set(localRel.id, localRel);
            }
        }
    });

    console.log(`[Merge] Result: ${mergedEntities.size} entities, ${mergedRelationships.size} relationships`);

    // Filter out soft-deleted entities (prevents zombie restoration)
    const activeEntities = Array.from(mergedEntities.values()).filter(e => !e.metadata?.deleted);
    const activeRelationships = Array.from(mergedRelationships.values()).filter(r => {
        // Remove relationships involving deleted entities
        const fromExists = activeEntities.some(e => e.id === r.from);
        const toExists = activeEntities.some(e => e.id === r.to);
        return fromExists && toExists;
    });

    console.log(`[Merge] After filtering deleted: ${activeEntities.length} entities, ${activeRelationships.length} relationships`);

    return {
        entities: activeEntities,
        relationships: activeRelationships
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

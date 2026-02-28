// Firestore Sync Service — Granular subcollection-based sync
// Schema: users/{uid}/entities/{id}, users/{uid}/relationships/{id}, users/{uid}/config

import {
    doc,
    collection,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    writeBatch,
    serverTimestamp,
    Timestamp,
    onSnapshot,
    Unsubscribe,
    query,
    DocumentChange,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';
import { Entity, Relationship, TagDefinition } from '../types';

// --- Collection Paths ---

const usersCol = 'users';
const entitiesSubCol = 'entities';
const relationshipsSubCol = 'relationships';

function userDoc(uid: string) {
    return doc(db!, usersCol, uid);
}

function entitiesCol(uid: string) {
    return collection(db!, usersCol, uid, entitiesSubCol);
}

function entityDoc(uid: string, entityId: string) {
    return doc(db!, usersCol, uid, entitiesSubCol, entityId);
}

function relationshipsCol(uid: string) {
    return collection(db!, usersCol, uid, relationshipsSubCol);
}

function relationshipDoc(uid: string, relId: string) {
    return doc(db!, usersCol, uid, relationshipsSubCol, relId);
}

// --- Types ---

export interface UserConfig {
    universalTags: TagDefinition[];
    lastSyncedAt: Timestamp | null;
    schemaVersion: number;
}

export interface UserData {
    entities: Entity[];
    relationships: Relationship[];
    universalTags: TagDefinition[];
    lastSyncedAt: Timestamp | null;
}

// --- Real-time Listeners ---

interface ActiveListeners {
    entities: Unsubscribe | null;
    relationships: Unsubscribe | null;
    config: Unsubscribe | null;
}

const listeners: ActiveListeners = {
    entities: null,
    relationships: null,
    config: null,
};

/**
 * Subscribe to real-time entity changes.
 * Calls onUpdate with the full entity list whenever any entity changes.
 */
export function subscribeToEntities(
    userId: string,
    onUpdate: (entities: Entity[]) => void,
): Unsubscribe {
    if (!isFirebaseConfigured() || !db) return () => {};

    listeners.entities?.();

    const q = query(entitiesCol(userId));

    const unsub = onSnapshot(q, (snapshot) => {
        const entities: Entity[] = [];
        snapshot.forEach((doc) => {
            entities.push({ id: doc.id, ...doc.data() } as Entity);
        });
        console.log(`[FirestoreSync] Entities snapshot: ${entities.length} docs`);
        onUpdate(entities);
    }, (error) => {
        console.error('[FirestoreSync] Entities listener error:', error);
    });

    listeners.entities = unsub;
    return unsub;
}

/**
 * Subscribe to real-time relationship changes.
 */
export function subscribeToRelationships(
    userId: string,
    onUpdate: (relationships: Relationship[]) => void,
): Unsubscribe {
    if (!isFirebaseConfigured() || !db) return () => {};

    listeners.relationships?.();

    const q = query(relationshipsCol(userId));

    const unsub = onSnapshot(q, (snapshot) => {
        const relationships: Relationship[] = [];
        snapshot.forEach((doc) => {
            relationships.push({ id: doc.id, ...doc.data() } as Relationship);
        });
        console.log(`[FirestoreSync] Relationships snapshot: ${relationships.length} docs`);
        onUpdate(relationships);
    }, (error) => {
        console.error('[FirestoreSync] Relationships listener error:', error);
    });

    listeners.relationships = unsub;
    return unsub;
}

/**
 * Subscribe to user config (tags, settings).
 */
export function subscribeToConfig(
    userId: string,
    onUpdate: (config: UserConfig) => void,
): Unsubscribe {
    if (!isFirebaseConfigured() || !db) return () => {};

    listeners.config?.();

    const unsub = onSnapshot(userDoc(userId), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            onUpdate({
                universalTags: data.universalTags || [],
                lastSyncedAt: data.lastSyncedAt || null,
                schemaVersion: data.schemaVersion || 1,
            });
        }
    }, (error) => {
        console.error('[FirestoreSync] Config listener error:', error);
    });

    listeners.config = unsub;
    return unsub;
}

/**
 * Combined subscription for backward compatibility.
 */
export const subscribeToUserData = (
    userId: string,
    onDataChange: (data: UserData) => void,
): Unsubscribe => {
    if (!isFirebaseConfigured() || !db) return () => {};

    let currentEntities: Entity[] = [];
    let currentRelationships: Relationship[] = [];
    let currentTags: TagDefinition[] = [];

    const notify = () => {
        onDataChange({
            entities: currentEntities,
            relationships: currentRelationships,
            universalTags: currentTags,
            lastSyncedAt: null,
        });
    };

    const unsub1 = subscribeToEntities(userId, (entities) => {
        currentEntities = entities;
        notify();
    });

    const unsub2 = subscribeToRelationships(userId, (relationships) => {
        currentRelationships = relationships;
        notify();
    });

    const unsub3 = subscribeToConfig(userId, (config) => {
        currentTags = config.universalTags;
        notify();
    });

    return () => {
        unsub1();
        unsub2();
        unsub3();
    };
};

export const unsubscribeFromUserData = () => {
    listeners.entities?.();
    listeners.relationships?.();
    listeners.config?.();
    listeners.entities = null;
    listeners.relationships = null;
    listeners.config = null;
};

// --- Read Operations ---

export const loadUserData = async (userId: string): Promise<UserData | null> => {
    if (!isFirebaseConfigured() || !db) return null;

    try {
        // Load entities
        const entitiesSnap = await getDocs(entitiesCol(userId));
        const entities: Entity[] = [];
        entitiesSnap.forEach((doc) => {
            entities.push({ id: doc.id, ...doc.data() } as Entity);
        });

        // Load relationships
        const relsSnap = await getDocs(relationshipsCol(userId));
        const relationships: Relationship[] = [];
        relsSnap.forEach((doc) => {
            relationships.push({ id: doc.id, ...doc.data() } as Relationship);
        });

        // Load config
        const configSnap = await getDoc(userDoc(userId));
        const configData = configSnap.exists() ? configSnap.data() : {};

        console.log(`[FirestoreSync] Loaded: ${entities.length} entities, ${relationships.length} relationships`);

        return {
            entities,
            relationships,
            universalTags: configData?.universalTags || [],
            lastSyncedAt: configData?.lastSyncedAt || null,
        };
    } catch (error) {
        console.error('[FirestoreSync] Load failed:', error);
        return null;
    }
};

// --- Write Operations ---

/**
 * Sync specific changed entities to Firestore (granular write).
 * Uses a batch write for efficiency.
 */
export async function syncEntities(userId: string, entities: Entity[]): Promise<boolean> {
    if (!isFirebaseConfigured() || !db || entities.length === 0) return false;

    try {
        const batch = writeBatch(db);
        for (const entity of entities) {
            const { id, ...data } = entity;
            batch.set(entityDoc(userId, id), data);
        }
        await batch.commit();
        console.log(`[FirestoreSync] Synced ${entities.length} entities`);
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Entity sync failed:', error);
        return false;
    }
}

/**
 * Sync specific changed relationships to Firestore.
 */
export async function syncRelationships(userId: string, relationships: Relationship[]): Promise<boolean> {
    if (!isFirebaseConfigured() || !db || relationships.length === 0) return false;

    try {
        const batch = writeBatch(db);
        for (const rel of relationships) {
            const { id, ...data } = rel;
            batch.set(relationshipDoc(userId, id), data);
        }
        await batch.commit();
        console.log(`[FirestoreSync] Synced ${relationships.length} relationships`);
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Relationship sync failed:', error);
        return false;
    }
}

/**
 * Delete specific entities from Firestore.
 */
export async function deleteEntitiesFromCloud(userId: string, entityIds: string[]): Promise<boolean> {
    if (!isFirebaseConfigured() || !db || entityIds.length === 0) return false;

    try {
        const batch = writeBatch(db);
        for (const id of entityIds) {
            batch.delete(entityDoc(userId, id));
        }
        await batch.commit();
        console.log(`[FirestoreSync] Deleted ${entityIds.length} entities from cloud`);
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Entity delete failed:', error);
        return false;
    }
}

/**
 * Delete specific relationships from Firestore.
 */
export async function deleteRelationshipsFromCloud(userId: string, relIds: string[]): Promise<boolean> {
    if (!isFirebaseConfigured() || !db || relIds.length === 0) return false;

    try {
        const batch = writeBatch(db);
        for (const id of relIds) {
            batch.delete(relationshipDoc(userId, id));
        }
        await batch.commit();
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Relationship delete failed:', error);
        return false;
    }
}

/**
 * Save user config (tags, metadata) to the user document.
 */
export async function saveUserConfig(
    userId: string,
    config: Partial<UserConfig>,
): Promise<boolean> {
    if (!isFirebaseConfigured() || !db) return false;

    try {
        await setDoc(userDoc(userId), {
            ...config,
            lastSyncedAt: serverTimestamp(),
            schemaVersion: 2,
        }, { merge: true });
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Config save failed:', error);
        return false;
    }
}

/**
 * Full save — writes all entities and relationships to subcollections.
 * Used for initial migration or full sync.
 */
export const saveUserData = async (
    userId: string,
    data: {
        entities: Entity[];
        relationships: Relationship[];
        universalTags?: TagDefinition[];
    },
): Promise<boolean> => {
    if (!isFirebaseConfigured() || !db) return false;

    try {
        // Batch writes (Firestore limit: 500 per batch)
        const BATCH_SIZE = 450;

        // Write entities in batches
        for (let i = 0; i < data.entities.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = data.entities.slice(i, i + BATCH_SIZE);
            for (const entity of chunk) {
                const { id, ...entityData } = entity;
                batch.set(entityDoc(userId, id), entityData);
            }
            await batch.commit();
        }

        // Write relationships in batches
        for (let i = 0; i < data.relationships.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = data.relationships.slice(i, i + BATCH_SIZE);
            for (const rel of chunk) {
                const { id, ...relData } = rel;
                batch.set(relationshipDoc(userId, id), relData);
            }
            await batch.commit();
        }

        // Write config
        await saveUserConfig(userId, {
            universalTags: data.universalTags || [],
        });

        console.log(`[FirestoreSync] Full save: ${data.entities.length} entities, ${data.relationships.length} relationships`);
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Full save failed:', error);
        return false;
    }
};

// --- Incremental Sync ---

/**
 * Incremental sync — writes only the changed entities/relationships.
 * Falls back to granular batch writes, NOT a full save.
 */
export const syncOperation = async (
    userId: string,
    operation: any,
    currentData: { entities: Entity[]; relationships: Relationship[] },
): Promise<boolean> => {
    if (!isFirebaseConfigured() || !db) return false;

    try {
        // Determine which entities/relationships were affected by the operation
        const changedEntityIds: string[] = [];
        const changedRelIds: string[] = [];
        const deletedEntityIds: string[] = [];
        const deletedRelIds: string[] = [];

        if (operation?.payload) {
            const p = operation.payload;
            const id = p.id || p.entity_id;
            if (id) {
                if (operation.type === 'delete_entity') {
                    // Soft-deleted entities still need to be synced (with deleted flag)
                    changedEntityIds.push(id);
                } else {
                    changedEntityIds.push(id);
                }
            }
            if (p.from) changedRelIds.push(p.from);
            if (p.to) changedRelIds.push(p.to);
        }

        // Sync only changed entities
        if (changedEntityIds.length > 0) {
            const changedEntities = currentData.entities.filter(e => changedEntityIds.includes(e.id));
            if (changedEntities.length > 0) {
                await syncEntities(userId, changedEntities);
            }
        }

        // Sync only changed relationships
        if (changedRelIds.length > 0) {
            const changedRels = currentData.relationships.filter(r =>
                changedRelIds.includes(r.from) || changedRelIds.includes(r.to)
            );
            if (changedRels.length > 0) {
                await syncRelationships(userId, changedRels);
            }
        }

        return true;
    } catch (error) {
        console.error('[FirestoreSync] Incremental sync failed, falling back to full save:', error);
        return saveUserData(userId, currentData);
    }
};

// --- Merge Strategy ---

export const mergeData = (
    local: { entities: Entity[]; relationships: Relationship[] },
    remote: { entities: Entity[]; relationships: Relationship[] },
): { entities: Entity[]; relationships: Relationship[] } => {
    const mergedEntities = new Map<string, Entity>();
    const mergedRelationships = new Map<string, Relationship>();

    // Remote first
    remote.entities.forEach(e => mergedEntities.set(e.id, e));

    // Local wins if newer or not in remote
    local.entities.forEach(localEntity => {
        const remoteEntity = mergedEntities.get(localEntity.id);

        if (!remoteEntity) {
            mergedEntities.set(localEntity.id, localEntity);
        } else {
            const localTime = new Date(localEntity.updated_at || localEntity.created_at).getTime();
            const remoteTime = new Date(remoteEntity.updated_at || remoteEntity.created_at).getTime();

            if (localTime >= remoteTime) {
                mergedEntities.set(localEntity.id, localEntity);
            }
        }
    });

    // Same for relationships
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

    // Filter deleted entities and orphan relationships
    const activeEntities = Array.from(mergedEntities.values()).filter(e => !e.metadata?.deleted);
    const entityIds = new Set(activeEntities.map(e => e.id));
    const activeRelationships = Array.from(mergedRelationships.values()).filter(r =>
        entityIds.has(r.from) && entityIds.has(r.to),
    );

    return { entities: activeEntities, relationships: activeRelationships };
};

// --- Delete User Data ---

export const deleteUserData = async (userId: string): Promise<boolean> => {
    if (!isFirebaseConfigured() || !db) return false;

    try {
        // Delete all entities
        const entitiesSnap = await getDocs(entitiesCol(userId));
        const batch1 = writeBatch(db);
        entitiesSnap.forEach((doc) => batch1.delete(doc.ref));
        await batch1.commit();

        // Delete all relationships
        const relsSnap = await getDocs(relationshipsCol(userId));
        const batch2 = writeBatch(db);
        relsSnap.forEach((doc) => batch2.delete(doc.ref));
        await batch2.commit();

        // Reset config
        await setDoc(userDoc(userId), {
            universalTags: [],
            deletedAt: serverTimestamp(),
        });

        return true;
    } catch (error) {
        console.error('[FirestoreSync] Delete failed:', error);
        return false;
    }
};

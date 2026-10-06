// Firestore Sync Service — Granular subcollection-based sync
// Schema:
//   users/{uid}                    ? config (tags, settings, schemaVersion)
//   users/{uid}/entities/{id}      ? Entity docs
//   users/{uid}/relationships/{id} ? Relationship docs
//   users/{uid}/messages/{id}      ? Message docs (chat history, real-time sync)
//   users/{uid}/meta/food          ? { foodLogs: FoodLogEntry[] }
//   users/{uid}/meta/attendance    ? { subjects, classSchedule, holidays, attendanceLogs }

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
    Unsubscribe,
    query,
    orderBy,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';
import {
    Entity,
    Relationship,
    TagDefinition,
    Message,
    FoodLogEntry,
    UserSettings,
    Subject,
    ClassSchedule,
    Holiday,
    AttendanceLog,
} from '../types';

// --- Collection Paths ---

const usersCol = 'users';
const entitiesSubCol = 'entities';
const relationshipsSubCol = 'relationships';
const messagesSubCol = 'messages';
const metaSubCol = 'meta';

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

function messagesCol(uid: string) {
    return collection(db!, usersCol, uid, messagesSubCol);
}

function messageDoc(uid: string, msgId: string) {
    return doc(db!, usersCol, uid, messagesSubCol, msgId);
}

function metaDoc(uid: string, docName: string) {
    return doc(db!, usersCol, uid, metaSubCol, docName);
}

// Recursively remove undefined values from an object before saving to Firestore
function sanitizeForFirestore<T>(obj: T): T {
    if (obj === undefined || obj === null) {
        return null as any;
    }
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeForFirestore(item)) as any;
    }
    if (typeof obj === 'object') {
        const cleaned: Record<string, any> = {};
        for (const [key, val] of Object.entries(obj)) {
            if (val !== undefined) {
                cleaned[key] = sanitizeForFirestore(val);
            }
        }
        return cleaned as any;
    }
    return obj;
}


// --- Types ---

export interface UserConfig {
    universalTags: TagDefinition[];
    settings?: Partial<UserSettings>;
    lastSyncedAt: Timestamp | null;
    schemaVersion: number;
}

export interface UserData {
    entities: Entity[];
    relationships: Relationship[];
    universalTags: TagDefinition[];
    messages: Message[];
    settings?: Partial<UserSettings>;
    foodLogs: FoodLogEntry[];
    subjects: Subject[];
    classSchedule: ClassSchedule[];
    holidays: Holiday[];
    attendanceLogs: AttendanceLog[];
    lastSyncedAt: Timestamp | null;
}

// --- Real-time Listeners ---

interface ActiveListeners {
    entities: Unsubscribe | null;
    relationships: Unsubscribe | null;
    config: Unsubscribe | null;
    messages: Unsubscribe | null;
}

const listeners: ActiveListeners = {
    entities: null,
    relationships: null,
    config: null,
    messages: null,
};

/**
 * Subscribe to real-time entity changes.
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
        snapshot.forEach((d) => {
            entities.push({ id: d.id, ...d.data() } as Entity);
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
        snapshot.forEach((d) => {
            relationships.push({ id: d.id, ...d.data() } as Relationship);
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
                settings: data.settings || undefined,
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
 * Subscribe to real-time message changes.
 * Orders by created_at ascending for chat display.
 */
export function subscribeToMessages(
    userId: string,
    onUpdate: (messages: Message[]) => void,
): Unsubscribe {
    if (!isFirebaseConfigured() || !db) return () => {};

    listeners.messages?.();

    const q = query(messagesCol(userId), orderBy('created_at', 'asc'));

    const unsub = onSnapshot(q, (snapshot) => {
        const messages: Message[] = [];
        snapshot.forEach((d) => {
            messages.push({ id: d.id, ...d.data() } as Message);
        });
        console.log(`[FirestoreSync] Messages snapshot: ${messages.length} docs`);
        onUpdate(messages);
    }, (error) => {
        console.error('[FirestoreSync] Messages listener error:', error);
    });

    listeners.messages = unsub;
    return unsub;
}

/**
 * Combined subscription for all user data.
 * Fires onDataChange whenever any subcollection changes.
 */
export const subscribeToUserData = (
    userId: string,
    onDataChange: (data: Partial<UserData>) => void,
): Unsubscribe => {
    if (!isFirebaseConfigured() || !db) return () => {};

    let currentEntities: Entity[] = [];
    let currentRelationships: Relationship[] = [];
    let currentTags: TagDefinition[] = [];
    let currentMessages: Message[] = [];
    let currentSettings: Partial<UserSettings> | undefined;

    const notify = () => {
        onDataChange({
            entities: currentEntities,
            relationships: currentRelationships,
            universalTags: currentTags,
            messages: currentMessages,
            settings: currentSettings,
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
        currentSettings = config.settings;
        notify();
    });

    const unsub4 = subscribeToMessages(userId, (messages) => {
        currentMessages = messages;
        notify();
    });

    return () => {
        unsub1();
        unsub2();
        unsub3();
        unsub4();
    };
};

export const unsubscribeFromUserData = () => {
    listeners.entities?.();
    listeners.relationships?.();
    listeners.config?.();
    listeners.messages?.();
    listeners.entities = null;
    listeners.relationships = null;
    listeners.config = null;
    listeners.messages = null;
};

// --- Read Operations ---

export const loadUserData = async (userId: string): Promise<UserData | null> => {
    if (!isFirebaseConfigured() || !db) return null;

    try {
        // Load entities
        const entitiesSnap = await getDocs(entitiesCol(userId));
        const entities: Entity[] = [];
        entitiesSnap.forEach((d) => {
            entities.push({ id: d.id, ...d.data() } as Entity);
        });

        // Load relationships
        const relsSnap = await getDocs(relationshipsCol(userId));
        const relationships: Relationship[] = [];
        relsSnap.forEach((d) => {
            relationships.push({ id: d.id, ...d.data() } as Relationship);
        });

        // Load messages
        const msgsQuery = query(messagesCol(userId), orderBy('created_at', 'asc'));
        const msgsSnap = await getDocs(msgsQuery);
        const messages: Message[] = [];
        msgsSnap.forEach((d) => {
            messages.push({ id: d.id, ...d.data() } as Message);
        });

        // Load config
        const configSnap = await getDoc(userDoc(userId));
        const configData = configSnap.exists() ? configSnap.data() : {};

        // Load food logs
        let foodLogs: FoodLogEntry[] = [];
        try {
            const foodSnap = await getDoc(metaDoc(userId, 'food'));
            if (foodSnap.exists()) {
                foodLogs = foodSnap.data().foodLogs || [];
            }
        } catch (e) {
            console.warn('[FirestoreSync] Food logs load failed:', e);
        }

        // Load attendance data
        let subjects: Subject[] = [];
        let classSchedule: ClassSchedule[] = [];
        let holidays: Holiday[] = [];
        let attendanceLogs: AttendanceLog[] = [];
        try {
            const attSnap = await getDoc(metaDoc(userId, 'attendance'));
            if (attSnap.exists()) {
                const data = attSnap.data();
                subjects = data.subjects || [];
                classSchedule = data.classSchedule || [];
                holidays = data.holidays || [];
                attendanceLogs = data.attendanceLogs || [];
            }
        } catch (e) {
            console.warn('[FirestoreSync] Attendance data load failed:', e);
        }

        console.log(`[FirestoreSync] Loaded: ${entities.length} entities, ${relationships.length} rels, ${messages.length} msgs`);

        return {
            entities,
            relationships,
            universalTags: configData?.universalTags || [],
            settings: configData?.settings || undefined,
            messages,
            foodLogs,
            subjects,
            classSchedule,
            holidays,
            attendanceLogs,
            lastSyncedAt: configData?.lastSyncedAt || null,
        };
    } catch (error) {
        console.error('[FirestoreSync] Load failed:', error);
        return null;
    }
};

// --- Write Operations ---

/**
 * Save a single message to Firestore.
 */
export async function saveMessage(userId: string, message: Message): Promise<boolean> {
    if (!isFirebaseConfigured() || !db) return false;

    try {
        const { id, ...data } = message;
        await setDoc(messageDoc(userId, id), sanitizeForFirestore(data));
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Message save failed:', error);
        return false;
    }
}

/**
 * Save multiple messages to Firestore in a batch.
 */
export async function saveMessages(userId: string, messages: Message[]): Promise<boolean> {
    if (!isFirebaseConfigured() || !db || messages.length === 0) return false;

    try {
        const BATCH_SIZE = 450;
        for (let i = 0; i < messages.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = messages.slice(i, i + BATCH_SIZE);
            for (const msg of chunk) {
                const { id, ...data } = msg;
                batch.set(messageDoc(userId, id), sanitizeForFirestore(data));
            }
            await batch.commit();
        }
        console.log(`[FirestoreSync] Saved ${messages.length} messages`);
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Messages batch save failed:', error);
        return false;
    }
}

/**
 * Sync specific changed entities to Firestore (granular write).
 */
export async function syncEntities(userId: string, entities: Entity[]): Promise<boolean> {
    if (!isFirebaseConfigured() || !db || entities.length === 0) return false;

    try {
        const BATCH_SIZE = 450;
        for (let i = 0; i < entities.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = entities.slice(i, i + BATCH_SIZE);
            for (const entity of chunk) {
                const { id, ...data } = entity;
                batch.set(entityDoc(userId, id), sanitizeForFirestore(data));
            }
            await batch.commit();
        }
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
        const BATCH_SIZE = 450;
        for (let i = 0; i < relationships.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = relationships.slice(i, i + BATCH_SIZE);
            for (const rel of chunk) {
                const { id, ...data } = rel;
                batch.set(relationshipDoc(userId, id), data);
            }
            await batch.commit();
        }
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
 * Save user config (tags, settings, metadata) to the user document.
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
 * Save food logs to meta/food document.
 */
export async function saveFoodLogs(userId: string, foodLogs: FoodLogEntry[]): Promise<boolean> {
    if (!isFirebaseConfigured() || !db) return false;

    try {
        await setDoc(metaDoc(userId, 'food'), { foodLogs, updatedAt: serverTimestamp() });
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Food logs save failed:', error);
        return false;
    }
}

/**
 * Save attendance data to meta/attendance document.
 */
export async function saveAttendanceData(
    userId: string,
    data: { subjects: Subject[]; classSchedule: ClassSchedule[]; holidays: Holiday[]; attendanceLogs: AttendanceLog[] }
): Promise<boolean> {
    if (!isFirebaseConfigured() || !db) return false;

    try {
        await setDoc(metaDoc(userId, 'attendance'), { ...data, updatedAt: serverTimestamp() });
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Attendance save failed:', error);
        return false;
    }
}

/**
 * Full save — writes all entities, relationships, and messages to subcollections.
 * Used for initial migration or full sync.
 */
export const saveUserData = async (
    userId: string,
    data: {
        entities: Entity[];
        relationships: Relationship[];
        universalTags?: TagDefinition[];
        messages?: Message[];
        settings?: Partial<UserSettings>;
        foodLogs?: FoodLogEntry[];
        subjects?: Subject[];
        classSchedule?: ClassSchedule[];
        holidays?: Holiday[];
        attendanceLogs?: AttendanceLog[];
    },
): Promise<boolean> => {
    if (!isFirebaseConfigured() || !db) return false;

    try {
        const BATCH_SIZE = 450;

        // Write entities in batches
        for (let i = 0; i < data.entities.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = data.entities.slice(i, i + BATCH_SIZE);
            for (const entity of chunk) {
                const { id, ...entityData } = entity;
                batch.set(entityDoc(userId, id), sanitizeForFirestore(entityData));
            }
            await batch.commit();
        }

        // Write relationships in batches
        for (let i = 0; i < data.relationships.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = data.relationships.slice(i, i + BATCH_SIZE);
            for (const rel of chunk) {
                const { id, ...relData } = rel;
                batch.set(relationshipDoc(userId, id), sanitizeForFirestore(relData));
            }
            await batch.commit();
        }

        // Write messages in batches
        if (data.messages && data.messages.length > 0) {
            for (let i = 0; i < data.messages.length; i += BATCH_SIZE) {
                const batch = writeBatch(db);
                const chunk = data.messages.slice(i, i + BATCH_SIZE);
                for (const msg of chunk) {
                    const { id, ...msgData } = msg;
                    batch.set(messageDoc(userId, id), sanitizeForFirestore(msgData));
                }
                await batch.commit();
            }
        }

        // Write config
        await saveUserConfig(userId, {
            universalTags: data.universalTags || [],
            settings: data.settings,
        });

        // Write food logs
        if (data.foodLogs && data.foodLogs.length > 0) {
            await saveFoodLogs(userId, data.foodLogs);
        }

        // Write attendance data
        if (data.subjects || data.classSchedule || data.holidays || data.attendanceLogs) {
            await saveAttendanceData(userId, {
                subjects: data.subjects || [],
                classSchedule: data.classSchedule || [],
                holidays: data.holidays || [],
                attendanceLogs: data.attendanceLogs || [],
            });
        }

        console.log(`[FirestoreSync] Full save: ${data.entities.length} entities, ${data.relationships.length} rels, ${data.messages?.length || 0} msgs`);
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
        const changedEntityIds: string[] = [];
        const changedRelIds: string[] = [];

        if (operation?.payload) {
            const p = operation.payload;
            const id = p.id || p.entity_id;
            if (id) {
                changedEntityIds.push(id);
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

/**
 * Merge messages — union by ID, sorted by created_at.
 * Never drops messages — additive merge.
 */
export const mergeMessages = (
    local: Message[],
    remote: Message[],
): Message[] => {
    const merged = new Map<string, Message>();

    // Remote first
    remote.forEach(m => merged.set(m.id, m));

    // Local fills in any not in remote
    local.forEach(m => {
        if (!merged.has(m.id)) {
            merged.set(m.id, m);
        }
    });

    // Sort chronologically
    return Array.from(merged.values()).sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
};

// --- Delete User Data ---

export const deleteUserData = async (userId: string): Promise<boolean> => {
    if (!isFirebaseConfigured() || !db) return false;

    try {
        // Delete all entities
        const entitiesSnap = await getDocs(entitiesCol(userId));
        const batch1 = writeBatch(db);
        entitiesSnap.forEach((d) => batch1.delete(d.ref));
        await batch1.commit();

        // Delete all relationships
        const relsSnap = await getDocs(relationshipsCol(userId));
        const batch2 = writeBatch(db);
        relsSnap.forEach((d) => batch2.delete(d.ref));
        await batch2.commit();

        // Delete all messages
        const msgsSnap = await getDocs(messagesCol(userId));
        const batch3 = writeBatch(db);
        msgsSnap.forEach((d) => batch3.delete(d.ref));
        await batch3.commit();

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

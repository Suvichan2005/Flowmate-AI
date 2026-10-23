// Firestore Sync Service  -  Granular subcollection-based sync
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
    getDocFromServer,
    getDocs,
    getDocsFromServer,
    getCountFromServer,
    writeBatch,
    serverTimestamp,
    Timestamp,
    deleteField,
    onSnapshot,
    runTransaction,
    SnapshotMetadata,
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
    ChatSession,
    ConversationBranch,
} from '../types';
import { isDemoSyncBlocked } from './syncManager';
import { isLegacySyntheticEntity } from './legacySyntheticEntity';
import { MODEL_PREFERENCE_FIELDS, stripRemovedLocationSettings } from './modelPreferenceSync';
import { createSnapshotDeduper } from './sync/snapshotDeduper';
import { createSyncSnapshotMetadataAggregator } from './sync/snapshotMetadata';
import { mergeConversationBranches, sameConversationBranches } from './chatBranchSync';
export { mergeCloudSettings, stripRemovedLocationSettings } from './modelPreferenceSync';

export interface AccountWorkspaceSummary {
    entityCount: number;
    messageCount: number;
    conversationCount: number;
}

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

/**
 * Read a minimal server-side inventory before the user enables workspace sync.
 * Aggregate queries return only counts; the only document read is the chat
 * session index, which contains titles and timestamps but no message bodies.
 * This never writes consent or downloads entity/message records.
 */
export async function getAccountWorkspaceSummary(uid: string): Promise<AccountWorkspaceSummary> {
    // This is a read-only, server-forced aggregate inventory. It remains safe
    // in the isolated sync-demo project and must work before workspace consent
    // is granted; only the data-sync writes remain demo-blocked.
    if (!isFirebaseConfigured() || !db) {
        throw new Error('Cloud workspace inventory is unavailable in this session.');
    }
    const [entities, messages, sessions] = await Promise.all([
        getCountFromServer(collection(db, usersCol, uid, entitiesSubCol)),
        getCountFromServer(collection(db, usersCol, uid, messagesSubCol)),
        getDocFromServer(metaDoc(uid, 'chat_sessions')),
    ]);
    const sessionList = sessions.exists() && Array.isArray(sessions.data().sessions)
        ? sessions.data().sessions as ChatSession[]
        : [];
    return {
        entityCount: entities.data().count,
        messageCount: messages.data().count,
        conversationCount: sessionList.filter(session => !session.deleted).length,
    };
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
    chatSessions?: ChatSession[];
    conversationBranches?: ConversationBranch[];
    settings?: Partial<UserSettings>;
    foodLogs: FoodLogEntry[];
    subjects: Subject[];
    classSchedule: ClassSchedule[];
    holidays: Holiday[];
    attendanceLogs: AttendanceLog[];
    lastSyncedAt: Timestamp | null;
    syncMetadata?: { fromCache: boolean; hasPendingWrites: boolean };
}

type SyncMetadataUpdate = (metadata: { fromCache: boolean; hasPendingWrites: boolean }) => void;

// --- Real-time Listeners ---

interface ActiveListeners {
    entities: Unsubscribe | null;
    relationships: Unsubscribe | null;
    config: Unsubscribe | null;
    messages: Unsubscribe | null;
    chatSessions: Unsubscribe | null;
    chatBranches: Unsubscribe | null;
}

const listeners: ActiveListeners = {
    entities: null,
    relationships: null,
    config: null,
    messages: null,
    chatSessions: null,
    chatBranches: null,
};

/**
 * Subscribe to real-time entity changes.
 */
export function subscribeToEntities(
    userId: string,
    onUpdate: (entities: Entity[]) => void,
    onMetadata?: (metadata: SnapshotMetadata) => void,
): Unsubscribe {
    if (!isFirebaseConfigured() || !db) return () => {};

    listeners.entities?.();

    const q = query(entitiesCol(userId));

    const unsub = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
        onMetadata?.(snapshot.metadata);
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
    onMetadata?: (metadata: SnapshotMetadata) => void,
): Unsubscribe {
    if (!isFirebaseConfigured() || !db) return () => {};

    listeners.relationships?.();

    const q = query(relationshipsCol(userId));

    const unsub = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
        onMetadata?.(snapshot.metadata);
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
    onMetadata?: (metadata: SnapshotMetadata) => void,
): Unsubscribe {
    if (!isFirebaseConfigured() || !db) return () => {};

    listeners.config?.();

    const unsub = onSnapshot(userDoc(userId), { includeMetadataChanges: true }, (snap) => {
        onMetadata?.(snap.metadata);
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
    onMetadata?: (metadata: SnapshotMetadata) => void,
): Unsubscribe {
    if (!isFirebaseConfigured() || !db) return () => {};

    listeners.messages?.();

    const q = query(messagesCol(userId), orderBy('created_at', 'asc'));

    const unsub = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
        onMetadata?.(snapshot.metadata);
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
 * Subscribe to real-time chat sessions changes.
 */
export function subscribeToChatSessions(
    userId: string,
    onUpdate: (sessions: ChatSession[]) => void,
    onMetadata?: (metadata: SnapshotMetadata) => void,
): Unsubscribe {
    if (!isFirebaseConfigured() || !db) return () => {};

    listeners.chatSessions?.();

    let lastSessionsHash = '';

    const unsub = onSnapshot(metaDoc(userId, 'chat_sessions'), { includeMetadataChanges: true }, (snap) => {
        onMetadata?.(snap.metadata);
        if (snap.exists()) {
            const data = snap.data();
            const sessions: ChatSession[] = data.sessions || [];
            const hash = JSON.stringify(sessions.map(s => ({
                id: s.id,
                title: s.title,
                deleted: !!s.deleted,
                deleted_at: s.deleted_at,
                messages_cleared_at: s.messages_cleared_at,
                active_branch_id: s.active_branch_id,
                updated_at: s.updated_at,
            })));
            if (hash !== lastSessionsHash) {
                lastSessionsHash = hash;
                console.log(`[FirestoreSync] Chat sessions snapshot: ${sessions.length} sessions`);
                onUpdate(sessions);
            }
        }
    }, (error) => {
        console.error('[FirestoreSync] Chat sessions listener error:', error);
    });

    listeners.chatSessions = unsub;
    return unsub;
}

/** Subscribe to cross-device conversation branch metadata. */
export function subscribeToChatBranches(
    userId: string,
    onUpdate: (branches: ConversationBranch[]) => void,
    onMetadata?: (metadata: SnapshotMetadata) => void,
): Unsubscribe {
    if (!isFirebaseConfigured() || !db) return () => {};

    listeners.chatBranches?.();
    const unsub = onSnapshot(metaDoc(userId, 'chat_branches'), { includeMetadataChanges: true }, snap => {
        onMetadata?.(snap.metadata);
        const branches = snap.exists() ? snap.data().branches : [];
        if (Array.isArray(branches)) onUpdate(branches as ConversationBranch[]);
    }, error => console.error('[FirestoreSync] Chat branches listener error:', error));

    listeners.chatBranches = unsub;
    return unsub;
}

/**
 * Combined subscription for all user data.
 * Fires onDataChange whenever any subcollection changes.
 */
export const subscribeToUserData = (
    userId: string,
    onDataChange: (data: Partial<UserData>) => void,
    onSyncMetadataChange?: SyncMetadataUpdate,
): Unsubscribe => {
    if (!isFirebaseConfigured() || !db) return () => {};

    let currentEntities: Entity[] = [];
    let currentRelationships: Relationship[] = [];
    let currentTags: TagDefinition[] = [];
    let currentMessages: Message[] = [];
    let currentChatSessions: ChatSession[] = [];
    let currentChatBranches: ConversationBranch[] = [];
    let currentSettings: Partial<UserSettings> | undefined;
    const shouldNotify = createSnapshotDeduper<{
        entities: Entity[];
        relationships: Relationship[];
        universalTags: TagDefinition[];
        messages: Message[];
        chatSessions: ChatSession[];
        conversationBranches: ConversationBranch[];
        settings: Partial<UserSettings> | undefined;
    }>();
    const updateMetadata = createSyncSnapshotMetadataAggregator(metadata => onSyncMetadataChange?.(metadata));

    const notify = () => {
        const snapshot = {
            entities: currentEntities,
            relationships: currentRelationships,
            universalTags: currentTags,
            messages: currentMessages,
            chatSessions: currentChatSessions,
            conversationBranches: currentChatBranches,
            settings: currentSettings,
        };
        if (!shouldNotify(snapshot)) return;
        onDataChange({ ...snapshot, lastSyncedAt: null });
    };

    const unsub1 = subscribeToEntities(userId, (entities) => {
        currentEntities = entities;
        notify();
    }, metadata => updateMetadata('entities', metadata));

    const unsub2 = subscribeToRelationships(userId, (relationships) => {
        currentRelationships = relationships;
        notify();
    }, metadata => updateMetadata('relationships', metadata));

    const unsub3 = subscribeToConfig(userId, (config) => {
        currentTags = config.universalTags;
        currentSettings = config.settings;
        notify();
    }, metadata => updateMetadata('config', metadata));

    const unsub4 = subscribeToMessages(userId, (messages) => {
        currentMessages = messages;
        notify();
    }, metadata => updateMetadata('messages', metadata));

    const unsub5 = subscribeToChatSessions(userId, (sessions) => {
        currentChatSessions = sessions;
        notify();
    }, metadata => updateMetadata('chatSessions', metadata));

    const unsub6 = subscribeToChatBranches(userId, branches => {
        currentChatBranches = branches;
        notify();
    }, metadata => updateMetadata('chatBranches', metadata));

    return () => {
        unsub1();
        unsub2();
        unsub3();
        unsub4();
        unsub5();
        unsub6();
    };
};

export const unsubscribeFromUserData = () => {
    listeners.entities?.();
    listeners.relationships?.();
    listeners.config?.();
    listeners.messages?.();
    listeners.chatSessions?.();
    listeners.chatBranches?.();
    listeners.entities = null;
    listeners.relationships = null;
    listeners.config = null;
    listeners.messages = null;
    listeners.chatSessions = null;
    listeners.chatBranches = null;
};

// --- Read Operations ---

export const loadUserData = async (userId: string, source: 'default' | 'server' = 'default'): Promise<UserData | null> => {
    if (!isFirebaseConfigured() || !db) return null;

    try {
        const readDocs = source === 'server' ? getDocsFromServer : getDocs;
        const readDoc = source === 'server' ? getDocFromServer : getDoc;
        const readMetadata: SnapshotMetadata[] = [];
        // Load entities
        const entitiesSnap = await readDocs(entitiesCol(userId));
        readMetadata.push(entitiesSnap.metadata);
        const entities: Entity[] = [];
        entitiesSnap.forEach((d) => {
            entities.push({ id: d.id, ...d.data() } as Entity);
        });

        // Load relationships
        const relsSnap = await readDocs(relationshipsCol(userId));
        readMetadata.push(relsSnap.metadata);
        const relationships: Relationship[] = [];
        relsSnap.forEach((d) => {
            relationships.push({ id: d.id, ...d.data() } as Relationship);
        });

        // Load messages
        const msgsQuery = query(messagesCol(userId), orderBy('created_at', 'asc'));
        const msgsSnap = await readDocs(msgsQuery);
        readMetadata.push(msgsSnap.metadata);
        const messages: Message[] = [];
        msgsSnap.forEach((d) => {
            messages.push({ id: d.id, ...d.data() } as Message);
        });

        // Load config
        const configSnap = await readDoc(userDoc(userId));
        readMetadata.push(configSnap.metadata);
        const configData = configSnap.exists() ? configSnap.data() : {};

        // Load food logs
        let foodLogs: FoodLogEntry[] = [];
        try {
            const foodSnap = await readDoc(metaDoc(userId, 'food'));
            readMetadata.push(foodSnap.metadata);
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
            const attSnap = await readDoc(metaDoc(userId, 'attendance'));
            readMetadata.push(attSnap.metadata);
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

        // Load chat sessions
        let chatSessions: ChatSession[] = [];
        try {
            const chatSnap = await readDoc(metaDoc(userId, 'chat_sessions'));
            readMetadata.push(chatSnap.metadata);
            if (chatSnap.exists()) {
                chatSessions = chatSnap.data().sessions || [];
            }
        } catch (e) {
            console.warn('[FirestoreSync] Chat sessions load failed:', e);
        }

        let conversationBranches: ConversationBranch[] = [];
        try {
            const branchesSnap = await readDoc(metaDoc(userId, 'chat_branches'));
            readMetadata.push(branchesSnap.metadata);
            if (branchesSnap.exists() && Array.isArray(branchesSnap.data().branches)) {
                conversationBranches = branchesSnap.data().branches as ConversationBranch[];
            }
        } catch (e) {
            console.warn('[FirestoreSync] Chat branches load failed:', e);
        }

        console.log(`[FirestoreSync] Loaded: ${entities.length} entities, ${relationships.length} rels, ${messages.length} msgs, ${chatSessions.length} sessions, ${conversationBranches.length} branches`);

        return {
            entities,
            relationships,
            universalTags: configData?.universalTags || [],
            settings: configData?.settings || undefined,
            messages,
            chatSessions,
            conversationBranches,
            foodLogs,
            subjects,
            classSchedule,
            holidays,
            attendanceLogs,
            lastSyncedAt: configData?.lastSyncedAt || null,
            syncMetadata: {
                fromCache: readMetadata.some(metadata => metadata.fromCache),
                hasPendingWrites: readMetadata.some(metadata => metadata.hasPendingWrites),
            },
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
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db) return false;

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
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db || messages.length === 0) return false;

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
    // Demo Mode Isolation: Block granular entity sync if demo mode is active
    if (isDemoSyncBlocked()) {
        console.warn('[FirestoreSync] syncEntities blocked: Demo mode is active.');
        return false;
    }

    if (!isFirebaseConfigured() || !db || entities.length === 0) return false;

    // Filter out synthetic demo entities to isolate personal cloud sync
    const nonDemoEntities = entities.filter(e => !isLegacySyntheticEntity(e));
    if (nonDemoEntities.length === 0) {
        console.warn('[FirestoreSync] syncEntities skipped: all entities are demo entities.');
        return false;
    }

    try {
        const BATCH_SIZE = 450;
        for (let i = 0; i < nonDemoEntities.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = nonDemoEntities.slice(i, i + BATCH_SIZE);
            for (const entity of chunk) {
                const { id, ...data } = entity;
                batch.set(entityDoc(userId, id), sanitizeForFirestore(data));
            }
            await batch.commit();
        }
        console.log(`[FirestoreSync] Synced ${nonDemoEntities.length} entities`);
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
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db || relationships.length === 0) return false;

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
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db || entityIds.length === 0) return false;

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
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db || relIds.length === 0) return false;

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
 * Delete specific messages from Firestore.
 */
export async function deleteMessagesFromCloud(userId: string, messageIds: string[]): Promise<boolean> {
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db || messageIds.length === 0) return false;

    try {
        const BATCH_SIZE = 450;
        for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = messageIds.slice(i, i + BATCH_SIZE);
            for (const id of chunk) {
                batch.delete(messageDoc(userId, id));
            }
            await batch.commit();
        }
        console.log(`[FirestoreSync] Deleted ${messageIds.length} messages from cloud`);
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Messages delete failed:', error);
        return false;
    }
}

/**
 * Delete all messages belonging to a specific channel/session from Firestore.
 */
export async function deleteChannelMessages(userId: string, channelId: string): Promise<boolean> {
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db || !channelId) return false;

    try {
        const snap = await getDocs(messagesCol(userId));
        const toDelete: string[] = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const msgChannel = data.channelId || 'general';
            if (msgChannel === channelId) {
                toDelete.push(docSnap.id);
            }
        });

        if (toDelete.length > 0) {
            return await deleteMessagesFromCloud(userId, toDelete);
        }
        return true;
    } catch (error) {
        console.error(`[FirestoreSync] Channel messages delete failed for ${channelId}:`, error);
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
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db) return false;

    try {
        const { settings, ...otherConfig } = config;
        const safePayload: Record<string, unknown> = sanitizeForFirestore(otherConfig) as Record<string, unknown>;
        if (settings) {
            const safeSettings = sanitizeForFirestore(stripRemovedLocationSettings(settings as Partial<UserSettings> & Record<string, unknown>)) as Record<string, unknown>;
            safeSettings.home_location = deleteField();
            safeSettings.travel_preferences = deleteField();
            const privacyPreferences = safeSettings.privacy_preferences && typeof safeSettings.privacy_preferences === 'object' && !Array.isArray(safeSettings.privacy_preferences)
                ? safeSettings.privacy_preferences as Record<string, unknown>
                : {};
            const capabilities = privacyPreferences.capabilities && typeof privacyPreferences.capabilities === 'object' && !Array.isArray(privacyPreferences.capabilities)
                ? privacyPreferences.capabilities as Record<string, unknown>
                : {};
            safeSettings.privacy_preferences = {
                ...privacyPreferences,
                capabilities: {
                    ...capabilities,
                    device_location: deleteField(),
                },
            };
            if (settings.sync_ai_preferences !== true) {
                // Revoking consent also clears preferences that were synced earlier.
                for (const key of MODEL_PREFERENCE_FIELDS) safeSettings[key] = deleteField();
            }
            safePayload.settings = safeSettings;
        }
        await setDoc(userDoc(userId), {
            ...safePayload,
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
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db) return false;

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
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db) return false;

    try {
        await setDoc(metaDoc(userId, 'attendance'), { ...data, updatedAt: serverTimestamp() });
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Attendance save failed:', error);
        return false;
    }
}

/**
 * Save chat sessions to meta/chat_sessions document.
 */
export async function saveChatSessions(userId: string, sessions: ChatSession[]): Promise<boolean> {
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db) return false;

    try {
        const ref = metaDoc(userId, 'chat_sessions');
        await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(ref);
            const remote = snapshot.exists() && Array.isArray(snapshot.data().sessions)
                ? snapshot.data().sessions as ChatSession[]
                : [];
            const merged = mergeChatSessions(sessions, remote);
            const byId = (items: ChatSession[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
            if (JSON.stringify(byId(merged)) === JSON.stringify(byId(remote))) return;
            transaction.set(ref, { sessions: sanitizeForFirestore(merged), updatedAt: serverTimestamp() }, { merge: true });
        });
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Chat sessions save failed:', error);
        return false;
    }
}

/** Save branch metadata with a transaction so stale devices cannot erase newer branches. */
export async function saveChatBranches(userId: string, branches: ConversationBranch[]): Promise<boolean> {
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db) return false;

    try {
        const ref = metaDoc(userId, 'chat_branches');
        await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(ref);
            const remote = snapshot.exists() && Array.isArray(snapshot.data().branches)
                ? snapshot.data().branches as ConversationBranch[]
                : [];
            const merged = mergeConversationBranches(branches, remote);
            if (!sameConversationBranches(merged, remote)) {
                transaction.set(ref, { branches: sanitizeForFirestore(merged), updatedAt: serverTimestamp() }, { merge: true });
            }
        });
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Chat branches save failed:', error);
        return false;
    }
}

/**
 * Full save  -  writes all entities, relationships, and messages to subcollections.
 * Used for initial migration or full sync.
 */
export const saveUserData = async (
    userId: string,
    data: {
        entities: Entity[];
        relationships: Relationship[];
        universalTags?: TagDefinition[];
        messages?: Message[];
        chatSessions?: ChatSession[];
        conversationBranches?: ConversationBranch[];
        settings?: Partial<UserSettings>;
        foodLogs?: FoodLogEntry[];
        subjects?: Subject[];
        classSchedule?: ClassSchedule[];
        holidays?: Holiday[];
        attendanceLogs?: AttendanceLog[];
    },
): Promise<boolean> => {
    if (isDemoSyncBlocked()) {
        console.warn('[FirestoreSync] saveUserData blocked: Demo mode is active.');
        return false;
    }
    if (!isFirebaseConfigured() || !db) return false;

    try {
        const BATCH_SIZE = 450;
        const nonDemoEntities = (data.entities || []).filter(e => !isLegacySyntheticEntity(e));

        // Write entities in batches
        for (let i = 0; i < nonDemoEntities.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = nonDemoEntities.slice(i, i + BATCH_SIZE);
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
        const configSaved = await saveUserConfig(userId, {
            universalTags: data.universalTags || [],
            settings: data.settings,
        });
        if (!configSaved) return false;

        // Write food logs
        if (data.foodLogs && data.foodLogs.length > 0 && !await saveFoodLogs(userId, data.foodLogs)) {
            return false;
        }

        // Write attendance data
        if (data.subjects || data.classSchedule || data.holidays || data.attendanceLogs) {
            const attendanceSaved = await saveAttendanceData(userId, {
                subjects: data.subjects || [],
                classSchedule: data.classSchedule || [],
                holidays: data.holidays || [],
                attendanceLogs: data.attendanceLogs || [],
            });
            if (!attendanceSaved) return false;
        }

        // Write chat sessions
        if (data.chatSessions && data.chatSessions.length > 0) {
            if (!await saveChatSessions(userId, data.chatSessions)) return false;
        }

        if (data.conversationBranches && data.conversationBranches.length > 0) {
            if (!await saveChatBranches(userId, data.conversationBranches)) return false;
        }

        console.log(`[FirestoreSync] Full save: ${data.entities.length} entities, ${data.relationships.length} rels, ${data.messages?.length || 0} msgs, ${data.chatSessions?.length || 0} sessions, ${data.conversationBranches?.length || 0} branches`);
        return true;
    } catch (error) {
        console.error('[FirestoreSync] Full save failed:', error);
        return false;
    }
};

// --- Incremental Sync ---

/**
 * Incremental sync  -  writes only the changed entities/relationships.
 * Falls back to granular batch writes, NOT a full save.
 */
export const syncOperation = async (
    userId: string,
    operation: any,
    currentData: { entities: Entity[]; relationships: Relationship[] },
): Promise<boolean> => {
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db) return false;

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
 * Merge messages  -  union by ID, sorted by created_at.
 * Never drops messages  -  additive merge.
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

/** Initial store greeting shown in a new chat; it is not a user-authored turn. */
export const isDefaultWelcomeMessage = (message: Message): boolean =>
    message.id === 'init-1' &&
    message.role === 'assistant' &&
    message.text === 'Welcome to Flowmate. What would you like to talk through or work on?' &&
    (message.channelId || 'general') === 'general' &&
    !message.parent_id &&
    !message.branch_id &&
    !message.status;

/** Apply durable session deletion and clear markers after additive message merge. */
export const filterMessagesBySessionState = (messages: Message[], sessions: ChatSession[]): Message[] => {
    const byId = new Map(sessions.map(session => [session.id, session]));
    return messages.filter(message => {
        const session = byId.get(message.channelId || 'general');
        if (!session) return true;
        if (session.deleted) return false;
        if (!session.messages_cleared_at) return true;
        const clearedThrough = Date.parse(session.messages_cleared_at);
        const createdAt = Date.parse(message.created_at);
        // Once a valid clear marker exists, an undated legacy/corrupt message
        // cannot be proven newer than the clear. Keep it suppressed rather
        // than letting it reappear on another device.
        return !Number.isFinite(clearedThrough) || (Number.isFinite(createdAt) && createdAt > clearedThrough);
    });
};

/**
 * Merge chat sessions - union by ID, newer updated_at wins.
 * Preserves soft-deleted tombstones so deletions propagate across devices and sync without resurrection.
 */
export const mergeChatSessions = (
    local: ChatSession[],
    remote: ChatSession[],
): ChatSession[] => {
    const merged = new Map<string, ChatSession>();

    // Remote first
    remote.forEach(s => merged.set(s.id, s));

    // Local fills in or overrides if newer. A deletion tombstone is terminal:
    // no stale, later-timestamped cached copy can resurrect a deleted session.
    local.forEach(localSession => {
        const remoteSession = merged.get(localSession.id);
        if (!remoteSession) {
            merged.set(localSession.id, localSession);
        } else if (localSession.deleted || remoteSession.deleted) {
            const winner = localSession.deleted ? localSession : remoteSession;
            merged.set(localSession.id, {
                ...winner,
                deleted: true,
                deleted_at: localSession.deleted_at || remoteSession.deleted_at || winner.updated_at,
            });
        } else {
            // The built-in General Chat session is recreated with a current
            // timestamp on a fresh device. When the cloud copy contains branch,
            // clear, or other session metadata, that placeholder must not win
            // solely because the new device was initialized later.
            const localIsFreshGeneralPlaceholder = localSession.id === 'general' &&
                localSession.title === 'General Chat' &&
                !localSession.active_branch_id &&
                !localSession.messages_cleared_at;
            const remoteHasGeneralState = remoteSession.id === 'general' &&
                (!!remoteSession.active_branch_id || !!remoteSession.messages_cleared_at ||
                    remoteSession.title !== 'General Chat');
            if (localIsFreshGeneralPlaceholder && remoteHasGeneralState) {
                merged.set(localSession.id, remoteSession);
                return;
            }
            const localTime = new Date(localSession.updated_at || localSession.created_at).getTime();
            const remoteTime = new Date(remoteSession.updated_at || remoteSession.created_at).getTime();
            const localClear = localSession.messages_cleared_at ? Date.parse(localSession.messages_cleared_at) : Number.NEGATIVE_INFINITY;
            const remoteClear = remoteSession.messages_cleared_at ? Date.parse(remoteSession.messages_cleared_at) : Number.NEGATIVE_INFINITY;
            const messages_cleared_at = localClear >= remoteClear
                ? localSession.messages_cleared_at
                : remoteSession.messages_cleared_at;
            if (localTime > remoteTime) {
                merged.set(localSession.id, { ...localSession, ...(messages_cleared_at ? { messages_cleared_at } : {}) });
            } else if (remoteTime > localTime) {
                merged.set(localSession.id, { ...remoteSession, ...(messages_cleared_at ? { messages_cleared_at } : {}) });
            } else {
                merged.set(localSession.id, { ...localSession, ...(messages_cleared_at ? { messages_cleared_at } : {}) });
            }
        }
    });

    // Sort by updated_at descending (most recent first)
    return Array.from(merged.values()).sort((a, b) =>
        new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
    );
};

// --- Delete User Data ---

export const deleteUserData = async (userId: string): Promise<boolean> => {
    if (isDemoSyncBlocked() || !isFirebaseConfigured() || !db) return false;

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

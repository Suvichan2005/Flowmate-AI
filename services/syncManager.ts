/**
 * Sync Manager Service
 * Handles automatic syncing between Zustand store and Firestore
 * 
 * Features:
 * - Auto-sync on state changes with debouncing (2s)
 * - Real-time listeners for entities, relationships, config, AND messages
 * - Individual message sync (write-through, no debounce)
 * - Food logs and attendance sync
 * - Optimistic updates with conflict resolution
 * - Connection status tracking
 */

import {
    saveUserData,
    loadUserData,
    subscribeToUserData,
    unsubscribeFromUserData,
    mergeData,
    mergeMessages,
    mergeChatSessions,
    saveMessage as saveMessageToFirestore,
    saveFoodLogs,
    saveAttendanceData,
    saveChatSessions,
    deleteChannelMessages,
    syncEntities,
    syncRelationships,
    saveUserConfig,
    UserData,
} from './firestoreSync';
import { isFirebaseConfigured } from './firebase';
import type {
    Entity,
    Relationship,
    TagDefinition,
    Message,
    FoodLogEntry,
    Subject,
    ClassSchedule,
    Holiday,
    AttendanceLog,
    UserSettings,
    ChatSession,
} from '../types';

// Sync state
let syncUserId: string | null = null;
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;
let realtimeUnsubscribe: (() => void) | null = null;
let lastSyncTimestamp: string | null = null;
let isDemoModeActive = false;

/**
 * Monotonically-incrementing session token.
 * Bumped on every new initializeSync() call and when demo mode is activated.
 * The realtime listener closure captures the token at subscription time;
 * any callback that fires after the token has changed is silently dropped,
 * preventing both demo-mode race deliveries and cross-account data routing.
 */
let syncSessionToken = 0;

/**
 * Configure demo mode sync blocker to strictly prevent synthetic entities
 * from propagating to authenticated user cloud accounts.
 */
export const setDemoModeSyncBlock = (active: boolean): void => {
    isDemoModeActive = active;
    if (active) {
        // Invalidate any in-flight listener callbacks by bumping the session token
        syncSessionToken++;
        if (syncDebounceTimer) {
            clearTimeout(syncDebounceTimer);
            syncDebounceTimer = null;
        }
        stopRealtimeSync();
    }
};

export const isDemoSyncBlocked = (): boolean => isDemoModeActive;

// Track message IDs we've just written to suppress echo from onSnapshot
const recentlyWrittenMessageIds = new Set<string>();
const MESSAGE_ECHO_TIMEOUT_MS = 5000;

// Listeners for store updates (will be connected from store.ts)
type OnSyncStatusChange = (status: 'idle' | 'syncing' | 'error', error?: string) => void;
type OnRemoteDataChange = (data: {
    entities: Entity[];
    relationships: Relationship[];
    universalTags: TagDefinition[];
    messages?: Message[];
    chatSessions?: ChatSession[];
    settings?: Partial<UserSettings>;
}) => void;

let onSyncStatusChange: OnSyncStatusChange | null = null;
let onRemoteDataChange: OnRemoteDataChange | null = null;

// Debounce delay for auto-sync (ms)
const SYNC_DEBOUNCE_MS = 2000;

/**
 * Initialize sync manager for a user
 * Call this after successful login
 */
export const initializeSync = (
    userId: string,
    statusCallback: OnSyncStatusChange,
    remoteDataCallback: OnRemoteDataChange
) => {
    if (!isFirebaseConfigured()) {
        console.warn('[SyncManager] Firebase not configured, sync disabled');
        return;
    }

    console.log('[SyncManager] Initializing sync for user:', userId);
    // Bump session token so any listener callbacks captured for the previous
    // user (or previous session) are invalidated immediately.
    syncSessionToken++;
    syncUserId = userId;
    onSyncStatusChange = statusCallback;
    onRemoteDataChange = remoteDataCallback;
};

/**
 * Start real-time sync listener
 * Call after initializeSync and initial data load
 */
export const startRealtimeSync = (): (() => void) | null => {
    if (!syncUserId || !isFirebaseConfigured() || isDemoSyncBlocked()) {
        return null;
    }

    console.log('[SyncManager] Starting real-time sync listener');

    // Capture the session token at subscription time.  If the token changes
    // before the async callback fires (because demo was activated or a new
    // account signed in), the callback is silently dropped.
    const capturedToken = syncSessionToken;

    realtimeUnsubscribe = subscribeToUserData(syncUserId, (data) => {
        // Guard: drop this callback if the session has been invalidated
        if (capturedToken !== syncSessionToken) {
            console.log('[SyncManager] Dropping stale realtime callback (session token mismatch)');
            return;
        }
        // Guard: drop if demo mode was activated between subscription and delivery
        if (isDemoModeActive) {
            console.log('[SyncManager] Dropping realtime callback — demo mode is active');
            return;
        }
        // Remote updates must never be dropped while syncing or debouncing
        if (onRemoteDataChange) {
            // Filter out messages we just wrote (echo suppression)
            const filteredMessages = (data.messages || []).filter(
                (m: Message) => !recentlyWrittenMessageIds.has(m.id)
            );

            console.log('[SyncManager] Received remote update:', {
                entities: data.entities?.length || 0,
                relationships: data.relationships?.length || 0,
                messages: filteredMessages.length,
                chatSessions: data.chatSessions?.length || 0,
            });

            onRemoteDataChange({
                entities: data.entities || [],
                relationships: data.relationships || [],
                universalTags: data.universalTags || [],
                messages: filteredMessages,
                chatSessions: data.chatSessions || [],
                settings: data.settings,
            });
        }
    });

    return realtimeUnsubscribe;
};

/**
 * Stop real-time sync listener
 */
export const stopRealtimeSync = () => {
    if (realtimeUnsubscribe) {
        realtimeUnsubscribe();
        realtimeUnsubscribe = null;
    }
    unsubscribeFromUserData();
    console.log('[SyncManager] Stopped real-time sync');
};

/**
 * Schedule a sync (debounced)
 * Call this whenever local state changes
 */
export const scheduleSync = (
    getData: () => { entities: Entity[]; relationships: Relationship[]; universalTags: TagDefinition[]; settings?: Partial<UserSettings> }
) => {
    if (!syncUserId || !isFirebaseConfigured() || isDemoModeActive) {
        return;
    }

    // Clear existing debounce timer
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
    }

    // Set up new debounced sync
    syncDebounceTimer = setTimeout(async () => {
        await performSync(getData);
    }, SYNC_DEBOUNCE_MS);
};

/**
 * Force immediate sync (bypasses debounce)
 * Use for critical operations like sign-out or page unload
 */
export const forceSync = async (
    getData: () => { entities: Entity[]; relationships: Relationship[]; universalTags: TagDefinition[]; settings?: Partial<UserSettings> }
): Promise<boolean> => {
    if (!syncUserId || !isFirebaseConfigured() || isDemoModeActive) {
        return false;
    }

    // Clear any pending debounced sync
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
    }

    return await performSync(getData);
};

/**
 * Perform the actual sync operation.
 * Incremental: only writes entities/relationships changed since lastSyncTimestamp.
 * Falls back to full save on first sync or error.
 */
const performSync = async (
    getData: () => { entities: Entity[]; relationships: Relationship[]; universalTags: TagDefinition[]; settings?: Partial<UserSettings> }
): Promise<boolean> => {
    if (!syncUserId || isSyncing || isDemoModeActive) {
        return false;
    }

    isSyncing = true;
    onSyncStatusChange?.('syncing');

    try {
        const rawData = getData();
        // Defensive isolation: strip any synthetic demo entities that might be present
        const data = {
            ...rawData,
            entities: rawData.entities.filter((e: Entity) =>
                !e.id.startsWith('recruiter-') &&
                !e.id.startsWith('demo-') &&
                !e.id.startsWith('goal-recruiter') &&
                !e.id.startsWith('task-recruiter')
            ),
        };
        const now = new Date().toISOString();

        if (lastSyncTimestamp) {
            // Incremental sync: only write entities modified since last sync
            const changedEntities = data.entities.filter((e: Entity) => {
                const updatedAt = e.updated_at || e.created_at;
                return updatedAt && updatedAt > lastSyncTimestamp!;
            });
            const changedRelationships = data.relationships.filter((r: Relationship) => {
                return r.created_at && r.created_at > lastSyncTimestamp!;
            });

            const promises: Promise<boolean>[] = [];
            if (changedEntities.length > 0) {
                promises.push(syncEntities(syncUserId!, changedEntities));
            }
            if (changedRelationships.length > 0) {
                promises.push(syncRelationships(syncUserId!, changedRelationships));
            }
            // Always update config (tags, settings) — it's a single doc
            promises.push(saveUserConfig(syncUserId!, {
                universalTags: data.universalTags,
                settings: data.settings,
            }));

            const results = await Promise.all(promises);
            const allSuccess = results.every(r => r);

            if (allSuccess) {
                lastSyncTimestamp = now;
                console.log(`[SyncManager] Incremental sync: ${changedEntities.length} entities, ${changedRelationships.length} rels`);
                onSyncStatusChange?.('idle');
                return true;
            } else {
                console.warn('[SyncManager] Partial sync failure, will retry');
                onSyncStatusChange?.('error', 'Partial sync failure');
                return false;
            }
        } else {
            // First sync: full save
            const success = await saveUserData(syncUserId, {
                entities: data.entities,
                relationships: data.relationships,
                universalTags: data.universalTags,
                settings: data.settings,
            });

            if (success) {
                lastSyncTimestamp = now;
                console.log('[SyncManager] Full initial sync successful');
                onSyncStatusChange?.('idle');
                return true;
            } else {
                console.error('[SyncManager] Initial sync failed');
                onSyncStatusChange?.('error', 'Sync failed');
                return false;
            }
        }
    } catch (error) {
        console.error('[SyncManager] Sync error:', error);
        onSyncStatusChange?.('error', String(error));
        return false;
    } finally {
        isSyncing = false;
    }
};

/**
 * Load initial data from cloud
 * Returns full data: entities, relationships, tags, messages, food, attendance
 */
export const loadInitialData = async (): Promise<UserData | null> => {
    if (!syncUserId || !isFirebaseConfigured()) {
        return null;
    }

    try {
        const data = await loadUserData(syncUserId);
        if (data) {
            console.log('[SyncManager] Loaded initial data:', data.entities.length, 'entities,', data.messages.length, 'messages');
            return data;
        }
        return null;
    } catch (error) {
        console.error('[SyncManager] Failed to load initial data:', error);
        return null;
    }
};

/**
 * Merge remote data with local data
 * Use when receiving real-time updates
 */
export const mergeWithLocal = (
    local: { entities: Entity[]; relationships: Relationship[] },
    remote: { entities: Entity[]; relationships: Relationship[] }
) => {
    return mergeData(local, remote);
};

/**
 * Merge remote messages with local messages
 */
export const mergeMessagesWithLocal = (
    local: Message[],
    remote: Message[]
): Message[] => {
    return mergeMessages(local, remote);
};

/**
 * Sync a single message to Firestore immediately (write-through).
 * Does NOT debounce — messages are written as they arrive.
 */
export const syncMessage = async (message: Message): Promise<boolean> => {
    if (!syncUserId || !isFirebaseConfigured() || isDemoSyncBlocked()) {
        return false;
    }

    // Add to echo suppression set
    recentlyWrittenMessageIds.add(message.id);
    setTimeout(() => {
        recentlyWrittenMessageIds.delete(message.id);
    }, MESSAGE_ECHO_TIMEOUT_MS);

    try {
        return await saveMessageToFirestore(syncUserId, message);
    } catch (error) {
        console.error('[SyncManager] Message sync failed:', error);
        recentlyWrittenMessageIds.delete(message.id);
        return false;
    }
};

/**
 * Sync food logs to Firestore
 */
export const syncFoodLogsToCloud = async (foodLogs: FoodLogEntry[]): Promise<boolean> => {
    if (!syncUserId || !isFirebaseConfigured() || isDemoSyncBlocked()) return false;
    return saveFoodLogs(syncUserId, foodLogs);
};

/**
 * Sync attendance data to Firestore
 */
export const syncAttendanceToCloud = async (data: {
    subjects: Subject[];
    classSchedule: ClassSchedule[];
    holidays: Holiday[];
    attendanceLogs: AttendanceLog[];
}): Promise<boolean> => {
    if (!syncUserId || !isFirebaseConfigured() || isDemoSyncBlocked()) return false;
    return saveAttendanceData(syncUserId, data);
};

/**
 * Sync chat sessions to Firestore
 */
export const syncChatSessionsToCloud = async (sessions: ChatSession[]): Promise<boolean> => {
    if (!syncUserId || !isFirebaseConfigured() || isDemoSyncBlocked()) return false;
    return saveChatSessions(syncUserId, sessions);
};

/**
 * Delete channel messages from Firestore cloud
 */
export const deleteChannelMessagesFromCloud = async (channelId: string): Promise<boolean> => {
    if (!syncUserId || !isFirebaseConfigured() || isDemoSyncBlocked()) return false;
    return deleteChannelMessages(syncUserId, channelId);
};

/**
 * Merge remote chat sessions with local chat sessions
 */
export const mergeChatSessionsWithLocal = (
    local: ChatSession[],
    remote: ChatSession[]
): ChatSession[] => {
    return mergeChatSessions(local, remote);
};

/**
 * Clean up sync manager
 * Call on logout
 */
export const cleanupSync = () => {
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
    }
    stopRealtimeSync();
    recentlyWrittenMessageIds.clear();
    lastSyncTimestamp = null;
    syncUserId = null;
    onSyncStatusChange = null;
    onRemoteDataChange = null;
    isSyncing = false;
    console.log('[SyncManager] Cleaned up');
};

/**
 * Check if sync is currently active
 */
export const isSyncActive = () => !!syncUserId;

/**
 * Get current sync user ID
 */
export const getSyncUserId = () => syncUserId;

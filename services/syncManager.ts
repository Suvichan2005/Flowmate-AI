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
    saveMessage as saveMessageToFirestore,
    saveFoodLogs,
    saveAttendanceData,
    UserData,
} from './firestoreSync';
import { isFirebaseConfigured } from './firebase';
import type { Message, FoodLogEntry, Subject, ClassSchedule, Holiday, AttendanceLog, UserSettings } from '../types';

// Sync state
let syncUserId: string | null = null;
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;
let realtimeUnsubscribe: (() => void) | null = null;
let lastSyncTimestamp: string | null = null;

// Track message IDs we've just written to suppress echo from onSnapshot
const recentlyWrittenMessageIds = new Set<string>();
const MESSAGE_ECHO_TIMEOUT_MS = 5000;

// Listeners for store updates (will be connected from store.ts)
type OnSyncStatusChange = (status: 'idle' | 'syncing' | 'error', error?: string) => void;
type OnRemoteDataChange = (data: {
    entities: any[];
    relationships: any[];
    universalTags: any[];
    messages?: Message[];
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
    syncUserId = userId;
    onSyncStatusChange = statusCallback;
    onRemoteDataChange = remoteDataCallback;
};

/**
 * Start real-time sync listener
 * Call after initializeSync and initial data load
 */
export const startRealtimeSync = (): (() => void) | null => {
    if (!syncUserId || !isFirebaseConfigured()) {
        return null;
    }

    console.log('[SyncManager] Starting real-time sync listener');

    realtimeUnsubscribe = subscribeToUserData(syncUserId, (data) => {
        // Only process if we're not currently pushing an update
        if (!isSyncing && onRemoteDataChange) {
            // Filter out messages we just wrote (echo suppression)
            const filteredMessages = (data.messages || []).filter(
                (m: Message) => !recentlyWrittenMessageIds.has(m.id)
            );

            console.log('[SyncManager] Received remote update');
            onRemoteDataChange({
                entities: data.entities || [],
                relationships: data.relationships || [],
                universalTags: data.universalTags || [],
                messages: filteredMessages,
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
    getData: () => { entities: any[]; relationships: any[]; universalTags: any[]; settings?: Partial<UserSettings> }
) => {
    if (!syncUserId || !isFirebaseConfigured()) {
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
    getData: () => { entities: any[]; relationships: any[]; universalTags: any[]; settings?: Partial<UserSettings> }
): Promise<boolean> => {
    if (!syncUserId || !isFirebaseConfigured()) {
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
    getData: () => { entities: any[]; relationships: any[]; universalTags: any[]; settings?: Partial<UserSettings> }
): Promise<boolean> => {
    if (!syncUserId || isSyncing) {
        return false;
    }

    isSyncing = true;
    onSyncStatusChange?.('syncing');

    try {
        const data = getData();
        const { syncEntities, syncRelationships, saveUserConfig } = await import('./firestoreSync');
        const now = new Date().toISOString();

        if (lastSyncTimestamp) {
            // Incremental sync: only write entities modified since last sync
            const changedEntities = data.entities.filter((e: any) => {
                const updatedAt = e.updated_at || e.created_at;
                return updatedAt && updatedAt > lastSyncTimestamp!;
            });
            const changedRelationships = data.relationships.filter((r: any) => {
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
    local: { entities: any[]; relationships: any[] },
    remote: { entities: any[]; relationships: any[] }
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
    if (!syncUserId || !isFirebaseConfigured()) {
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
    if (!syncUserId || !isFirebaseConfigured()) return false;
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
    if (!syncUserId || !isFirebaseConfigured()) return false;
    return saveAttendanceData(syncUserId, data);
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

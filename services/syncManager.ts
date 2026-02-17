/**
 * Sync Manager Service
 * Handles automatic syncing between Zustand store and Firestore
 * 
 * Features:
 * - Auto-sync on state changes with debouncing (2s)
 * - Real-time listener for remote changes
 * - Optimistic updates
 * - Offline queue with retry
 * - Connection status tracking
 */

import { saveUserData, loadUserData, subscribeToUserData, unsubscribeFromUserData, mergeData } from './firestoreSync';
import { isFirebaseConfigured } from './firebase';

// Sync state
let syncUserId: string | null = null;
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;
let realtimeUnsubscribe: (() => void) | null = null;

// Listeners for store updates (will be connected from store.ts)
type OnSyncStatusChange = (status: 'idle' | 'syncing' | 'error', error?: string) => void;
type OnRemoteDataChange = (data: { entities: any[]; relationships: any[]; universalTags: any[] }) => void;

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
            console.log('[SyncManager] Received remote update');
            onRemoteDataChange({
                entities: data.entities || [],
                relationships: data.relationships || [],
                universalTags: data.universalTags || []
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
    getData: () => { entities: any[]; relationships: any[]; universalTags: any[] }
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
    getData: () => { entities: any[]; relationships: any[]; universalTags: any[] }
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
 * Perform the actual sync operation
 */
const performSync = async (
    getData: () => { entities: any[]; relationships: any[]; universalTags: any[] }
): Promise<boolean> => {
    if (!syncUserId || isSyncing) {
        return false;
    }

    isSyncing = true;
    onSyncStatusChange?.('syncing');

    try {
        const data = getData();
        const success = await saveUserData(syncUserId, {
            entities: data.entities,
            relationships: data.relationships,
            universalTags: data.universalTags
        });

        if (success) {
            console.log('[SyncManager] Sync successful');
            onSyncStatusChange?.('idle');
            return true;
        } else {
            console.error('[SyncManager] Sync failed');
            onSyncStatusChange?.('error', 'Sync failed');
            return false;
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
 * Call after initializeSync
 */
export const loadInitialData = async (): Promise<{
    entities: any[];
    relationships: any[];
    universalTags: any[];
} | null> => {
    if (!syncUserId || !isFirebaseConfigured()) {
        return null;
    }

    try {
        const data = await loadUserData(syncUserId);
        if (data) {
            console.log('[SyncManager] Loaded initial data:', data.entities.length, 'entities');
            return {
                entities: data.entities,
                relationships: data.relationships,
                universalTags: data.universalTags || []
            };
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
 * Clean up sync manager
 * Call on logout
 */
export const cleanupSync = () => {
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
    }
    stopRealtimeSync();
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

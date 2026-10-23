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
    saveChatBranches,
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
    ConversationBranch,
} from '../types';
import { canonicalJson, globalPendingMutationQueue } from './sync';

// Sync state
let syncUserId: string | null = null;
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;
let realtimeUnsubscribe: (() => void) | null = null;
let lastSyncTimestamp: string | null = null;
let lastSyncConfigSignature: string | null = null;
let cloudBaselineReady = false;
let isDemoModeActive = false;
let automaticSyncRetryCount = 0;
type WorkspaceSyncData = { entities: Entity[]; relationships: Relationship[]; universalTags: TagDefinition[]; settings?: Partial<UserSettings> };
type DeferredSyncProvider = { userId: string; sessionToken: number; getData: () => WorkspaceSyncData };
let deferredSyncProvider: DeferredSyncProvider | null = null;
// Entities with an unresolved offline conflict must not be included in a
// debounced whole-workspace save. The user must choose a winner first.
const conflictedEntityIds = new Set<string>();
// Firebase identity alone is not workspace-sync consent. This is populated
// only from the explicit per-account/per-device local consent record.
let workspaceCloudSyncEnabled = false;

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
        deferredSyncProvider = null;
        stopRealtimeSync();
    }
};

export const isDemoSyncBlocked = (): boolean => isDemoModeActive;

/** Keep automatic workspace writes away from entities awaiting a user choice. */
export const setSyncEntityConflictBlocked = (entityId: string, blocked: boolean): void => {
    if (blocked) conflictedEntityIds.add(entityId);
    else conflictedEntityIds.delete(entityId);
};

/** Replace the current unresolved-conflict set after a reconciliation pass. */
export const setSyncConflictedEntityIds = (entityIds: Iterable<string>): void => {
    conflictedEntityIds.clear();
    for (const entityId of entityIds) conflictedEntityIds.add(entityId);
};

const withoutConflictedEntities = <T extends { entities: Entity[] }>(data: T): T => ({
    ...data,
    entities: data.entities.filter(entity => !conflictedEntityIds.has(entity.id)),
});

// Track message IDs we've just written to suppress echo from onSnapshot
const recentlyWrittenMessageIds = new Set<string>();
const MESSAGE_ECHO_TIMEOUT_MS = 5000;

// Listeners for store updates (will be connected from store.ts)
type OnSyncStatusChange = (status: 'idle' | 'syncing' | 'error', error?: string) => void;
type SyncReadMetadata = { fromCache: boolean; hasPendingWrites: boolean };
type OnSyncMetadataChange = (metadata: SyncReadMetadata) => void;
type OnRemoteDataChange = (data: {
    entities: Entity[];
    relationships: Relationship[];
    universalTags: TagDefinition[];
    messages?: Message[];
    chatSessions?: ChatSession[];
    conversationBranches?: ConversationBranch[];
    settings?: Partial<UserSettings>;
    foodLogs?: FoodLogEntry[];
    subjects?: Subject[];
    classSchedule?: ClassSchedule[];
    holidays?: Holiday[];
    attendanceLogs?: AttendanceLog[];
    isInitialLoad?: boolean;
    initialReadFailed?: boolean;
    syncMetadata?: SyncReadMetadata;
}) => void;


let onSyncStatusChange: OnSyncStatusChange | null = null;
let onRemoteDataChange: OnRemoteDataChange | null = null;
let onSyncMetadataChange: OnSyncMetadataChange | null = null;

const canWriteWorkspace = (): boolean => Boolean(
    syncUserId && workspaceCloudSyncEnabled && cloudBaselineReady &&
    isFirebaseConfigured() && !isDemoModeActive &&
    (typeof navigator === 'undefined' || navigator.onLine)
);

// Debounce delay for auto-sync (ms)
const SYNC_DEBOUNCE_MS = 2000;
const MAX_AUTOMATIC_SYNC_RETRIES = 3;
const automaticRetryDelay = (attempt: number): number => Math.min(8000, 1000 * (2 ** (attempt - 1)));

/**
 * Initialize sync manager for a user
 * Call this after successful login
 */
export const initializeSync = (
    userId: string,
    statusCallback: OnSyncStatusChange,
    remoteDataCallback: OnRemoteDataChange,
    hasWorkspaceCloudSyncConsent = false,
    syncMetadataCallback?: OnSyncMetadataChange,
) => {
    if (!isFirebaseConfigured()) {
        console.warn('[SyncManager] Firebase not configured, sync disabled');
        return;
    }

    const accountChanged = syncUserId !== userId;
    // A getter captured during another auth/session transition must never be
    // replayed after the new account's baseline is loaded.
    deferredSyncProvider = null;
    automaticSyncRetryCount = 0;
    if (accountChanged) {
        syncSessionToken++;
        if (syncDebounceTimer) {
            clearTimeout(syncDebounceTimer);
            syncDebounceTimer = null;
        }
        stopRealtimeSync();
        lastSyncTimestamp = null;
        lastSyncConfigSignature = null;
        cloudBaselineReady = false;
        conflictedEntityIds.clear();
    }

    console.log('[SyncManager] Initializing workspace sync');
    // Bump session token so any listener callbacks captured for the previous
    // user (or previous session) are invalidated immediately.
    syncSessionToken++;
    syncUserId = userId;
    conflictedEntityIds.clear();
    onSyncStatusChange = statusCallback;
    onRemoteDataChange = remoteDataCallback;
    onSyncMetadataChange = syncMetadataCallback || null;
    workspaceCloudSyncEnabled = hasWorkspaceCloudSyncConsent;
    cloudBaselineReady = false;

    if (workspaceCloudSyncEnabled) activateWorkspaceSync(true);
    else stopRealtimeSync();
};

/** Apply or revoke this device's explicit workspace-cloud consent at runtime. */
export const setWorkspaceCloudSyncConsent = (enabled: boolean): void => {
    if (workspaceCloudSyncEnabled === enabled) return;
    workspaceCloudSyncEnabled = enabled;
    syncSessionToken++;

    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
    }

    if (!enabled) {
        deferredSyncProvider = null;
        automaticSyncRetryCount = 0;
        cloudBaselineReady = false;
        stopRealtimeSync();
        return;
    }

    cloudBaselineReady = false;
    activateWorkspaceSync(true);
};

const activateWorkspaceSync = (requireServerSnapshot = false): void => {
    if (!workspaceCloudSyncEnabled || !syncUserId || isDemoModeActive) return;
    const userId = syncUserId;
    const capturedToken = syncSessionToken;

    // Read existing cloud state before listening. The caller reconciles this
    // data through the same store/kernel path used during normal sign-in.
    void loadUserData(userId, requireServerSnapshot ? 'server' : 'default').then(data => {
        if (!workspaceCloudSyncEnabled || capturedToken !== syncSessionToken || userId !== syncUserId) return;
        if (data) {
            // Never replay local changes over cached or unacknowledged state.
            cloudBaselineReady = data.syncMetadata?.fromCache === false &&
                data.syncMetadata?.hasPendingWrites === false;
            if (cloudBaselineReady) {
                lastSyncConfigSignature = canonicalJson({
                    universalTags: data.universalTags || [],
                    settings: data.settings,
                });
            }
            if (data.syncMetadata) onSyncMetadataChange?.(data.syncMetadata);
            onRemoteDataChange?.({ ...data, isInitialLoad: true });
            // Reconcile the authenticated server snapshot into the local store
            // before releasing a write that was waiting for this baseline.
            flushDeferredSync();
        }
        else {
            cloudBaselineReady = false;
            onRemoteDataChange?.({
                entities: [], relationships: [], universalTags: [],
                isInitialLoad: true, initialReadFailed: true,
            });
            onSyncStatusChange?.('error', 'Could not load cloud workspace');
            return;
        }
        if (!isDemoModeActive && startRealtimeSync()) onSyncStatusChange?.('idle');
    }).catch(() => {
        if (capturedToken !== syncSessionToken) return;
        console.error('[SyncManager] Initial cloud read failed');
        onSyncStatusChange?.('error', 'Could not load cloud workspace');
    });
};

/**
 * Start real-time sync listener
 * Call after initializeSync and initial data load
 */
export const startRealtimeSync = (): (() => void) | null => {
    if (!syncUserId || !workspaceCloudSyncEnabled || !isFirebaseConfigured() || isDemoSyncBlocked()) {
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
                conversationBranches: data.conversationBranches?.length || 0,
            });

            onRemoteDataChange({
                entities: data.entities || [],
                relationships: data.relationships || [],
                universalTags: data.universalTags || [],
                messages: filteredMessages,
                chatSessions: data.chatSessions || [],
                conversationBranches: data.conversationBranches || [],
                settings: data.settings,
            });
        }
    }, (metadata) => {
        if (capturedToken !== syncSessionToken || isDemoModeActive) return;
        if (metadata.fromCache || metadata.hasPendingWrites) cloudBaselineReady = false;
        else if (workspaceCloudSyncEnabled) {
            cloudBaselineReady = true;
            flushDeferredSync();
        }
        onSyncMetadataChange?.(metadata);
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
    getData: () => WorkspaceSyncData
) => {
    if (!syncUserId || !workspaceCloudSyncEnabled || !isFirebaseConfigured() || isDemoModeActive) {
        return;
    }
    // Keep a getter, not a frozen workspace snapshot. It is identity- and
    // session-bound, and evaluated only after a fresh server baseline has been
    // reconciled. This prevents debounce expiry during an acknowledgement or
    // auth transition from silently dropping the user's local change.
    const provider: DeferredSyncProvider = { userId: syncUserId, sessionToken: syncSessionToken, getData };
    deferredSyncProvider = provider;
    automaticSyncRetryCount = 0;
    scheduleDeferredSyncIfReady(provider);
};

/**
 * Requeue durable entity mutations after a fresh server snapshot has been
 * reconciled. The in-memory debounce provider does not survive a tab restart,
 * so the persisted mutation queue is the source of truth for offline replay.
 */
export const replayPendingEntityMutations = (
    getData: () => WorkspaceSyncData
): void => {
    const hasReplayableMutations = globalPendingMutationQueue.getAll().some(mutation =>
        mutation.status === 'pending' || mutation.status === 'in_flight'
    );
    if (hasReplayableMutations) scheduleSync(getData);
};

const scheduleDeferredSyncIfReady = (provider: DeferredSyncProvider, delayMs = SYNC_DEBOUNCE_MS): void => {
    if (deferredSyncProvider !== provider || provider.userId !== syncUserId ||
        provider.sessionToken !== syncSessionToken || !canWriteWorkspace()) return;

    // Clear existing debounce timer
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
    }

    // Set up new debounced sync
    syncDebounceTimer = setTimeout(async () => {
        syncDebounceTimer = null;
        if (deferredSyncProvider !== provider || provider.userId !== syncUserId ||
            provider.sessionToken !== syncSessionToken || !canWriteWorkspace()) return;
        if (isSyncing) {
            scheduleDeferredSyncIfReady(provider, SYNC_DEBOUNCE_MS);
            return;
        }
        const success = await performSync(provider.getData);
        if (deferredSyncProvider !== provider) return;
        if (success) {
            deferredSyncProvider = null;
            automaticSyncRetryCount = 0;
            return;
        }
        // A failed save stays queued and gets a few bounded retries. This
        // covers transient Firestore contention/transport failures without
        // looping forever on revoked access or a persistent rules error.
        automaticSyncRetryCount += 1;
        if (automaticSyncRetryCount <= MAX_AUTOMATIC_SYNC_RETRIES) {
            scheduleDeferredSyncIfReady(provider, automaticRetryDelay(automaticSyncRetryCount));
        }
    }, delayMs);
};

const flushDeferredSync = (): void => {
    if (deferredSyncProvider) scheduleDeferredSyncIfReady(deferredSyncProvider);
};

/**
 * Force immediate sync (bypasses debounce)
 * Use for critical operations like sign-out or page unload
 */
export const forceSync = async (
    getData: () => { entities: Entity[]; relationships: Relationship[]; universalTags: TagDefinition[]; settings?: Partial<UserSettings> }
): Promise<boolean> => {
    if (!syncUserId || !workspaceCloudSyncEnabled || !cloudBaselineReady || !isFirebaseConfigured() || isDemoModeActive ||
        (typeof navigator !== 'undefined' && !navigator.onLine)) {
        return false;
    }

    // Clear any pending debounced sync
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
    }

    automaticSyncRetryCount = 0;
    const provider = deferredSyncProvider;
    const success = await performSync(() => withoutConflictedEntities(getData()));
    if (success && provider && deferredSyncProvider === provider) deferredSyncProvider = null;
    return success;
};

/** Run the explicit full-workspace sync action through the same consent gate. */
export const syncWorkspaceNow = async (
    data: Parameters<typeof saveUserData>[1],
): Promise<boolean> => {
    if (!syncUserId || !workspaceCloudSyncEnabled || !cloudBaselineReady || !isFirebaseConfigured() || isDemoModeActive || isSyncing ||
        (typeof navigator !== 'undefined' && !navigator.onLine)) {
        return false;
    }

    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
    }

    const userId = syncUserId;
    const capturedToken = syncSessionToken;
    isSyncing = true;

    try {
        const success = await saveUserData(userId, withoutConflictedEntities(data));
        if (capturedToken !== syncSessionToken || userId !== syncUserId || !workspaceCloudSyncEnabled) return false;
        if (!success) {
            onSyncStatusChange?.('error', 'Cloud save did not complete');
            return false;
        }
        lastSyncTimestamp = new Date().toISOString();
        onSyncStatusChange?.('idle');
        return true;
    } catch {
        if (capturedToken === syncSessionToken) {
            console.error('[SyncManager] Explicit full sync failed');
            onSyncStatusChange?.('error', 'Cloud save failed');
        }
        return false;
    } finally {
        isSyncing = false;
    }
};

/**
 * Perform the actual sync operation.
 * Incremental: only writes entities/relationships changed since lastSyncTimestamp.
 * Falls back to full save on first sync or error.
 */
const performSync = async (
    getData: () => { entities: Entity[]; relationships: Relationship[]; universalTags: TagDefinition[]; settings?: Partial<UserSettings> }
): Promise<boolean> => {
    if (!syncUserId || !workspaceCloudSyncEnabled || !cloudBaselineReady || isSyncing || isDemoModeActive ||
        (typeof navigator !== 'undefined' && !navigator.onLine)) {
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
                !conflictedEntityIds.has(e.id) &&
                !e.id.startsWith('recruiter-') &&
                !e.id.startsWith('demo-') &&
                !e.id.startsWith('goal-recruiter') &&
                !e.id.startsWith('task-recruiter')
            ),
        };
        const now = new Date().toISOString();

        if (lastSyncTimestamp) {
            // Incremental sync: only write entities modified since last sync
            const pendingEntityIds = new Set(globalPendingMutationQueue.getAll()
                .filter(mutation => mutation.status === 'pending' || mutation.status === 'in_flight')
                .map(mutation => mutation.entity_id));
            const changedEntities = data.entities.filter((e: Entity) => {
                const updatedAt = e.updated_at || e.created_at;
                return pendingEntityIds.has(e.id) || (updatedAt && updatedAt > lastSyncTimestamp!);
            });
            const changedRelationships = data.relationships.filter((r: Relationship) => {
                return r.created_at && r.created_at > lastSyncTimestamp!;
            });

            const configSignature = canonicalJson({
                universalTags: data.universalTags,
                settings: data.settings,
            });
            const configChanged = configSignature !== lastSyncConfigSignature;

            // A deferred save can be triggered by reference churn in a remote
            // snapshot. Treat a materially unchanged workspace as acknowledged
            // without entering the syncing state or writing the config doc.
            if (changedEntities.length === 0 && changedRelationships.length === 0 && !configChanged) {
                lastSyncTimestamp = now;
                onSyncStatusChange?.('idle');
                return true;
            }

            const promises: Promise<boolean>[] = [];
            onSyncStatusChange?.('syncing');
            if (changedEntities.length > 0) {
                promises.push(syncEntities(syncUserId!, changedEntities));
            }
            if (changedRelationships.length > 0) {
                promises.push(syncRelationships(syncUserId!, changedRelationships));
            }
            if (configChanged) {
                promises.push(saveUserConfig(syncUserId!, {
                    universalTags: data.universalTags,
                    settings: data.settings,
                }));
            }

            const results = await Promise.all(promises);
            const allSuccess = results.every(r => r);

            if (allSuccess) {
                lastSyncTimestamp = now;
                if (configChanged) lastSyncConfigSignature = configSignature;
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
            onSyncStatusChange?.('syncing');
            const success = await saveUserData(syncUserId, {
                entities: data.entities,
                relationships: data.relationships,
                universalTags: data.universalTags,
                settings: data.settings,
            });

            if (success) {
                lastSyncTimestamp = now;
                lastSyncConfigSignature = canonicalJson({
                    universalTags: data.universalTags,
                    settings: data.settings,
                });
                console.log('[SyncManager] Full initial sync successful');
                onSyncStatusChange?.('idle');
                return true;
            } else {
                console.error('[SyncManager] Initial sync failed');
                onSyncStatusChange?.('error', 'Sync failed');
                return false;
            }
        }
    } catch {
        console.error('[SyncManager] Sync operation failed');
        onSyncStatusChange?.('error', 'Cloud sync failed');
        return false;
    } finally {
        isSyncing = false;
    }
};

/** Re-read an authoritative server snapshot before replaying offline edits. */
export const refreshWorkspaceFromCloud = (): void => {
    if (!workspaceCloudSyncEnabled || !syncUserId || !isFirebaseConfigured() || isDemoModeActive ||
        (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    cloudBaselineReady = false;
    activateWorkspaceSync(true);
};

/**
 * Load initial data from cloud
 * Returns full data: entities, relationships, tags, messages, food, attendance
 */
export const loadInitialData = async (): Promise<UserData | null> => {
    if (!syncUserId || !workspaceCloudSyncEnabled || !isFirebaseConfigured() || isDemoModeActive) {
        return null;
    }

    // A cloud read belongs to the identity/session that started it. Auth may
    // change (or consent may be revoked) while Firestore is resolving the read.
    const userId = syncUserId;
    const capturedToken = syncSessionToken;

    try {
        const data = await loadUserData(userId, 'server');
        if (
            capturedToken !== syncSessionToken ||
            userId !== syncUserId ||
            !workspaceCloudSyncEnabled ||
            isDemoModeActive
        ) return null;
        if (data) {
            console.log('[SyncManager] Loaded initial data:', data.entities.length, 'entities,', data.messages.length, 'messages');
            return data;
        }
        return null;
    } catch {
        if (capturedToken !== syncSessionToken) return null;
        console.error('[SyncManager] Failed to load initial data');
        return null;
    }
};

/** Read-only state helper for presenting the explicit sync action accurately. */
export const isWorkspaceCloudSyncActiveFor = (userId: string | null | undefined): boolean =>
    Boolean(userId && userId === syncUserId && workspaceCloudSyncEnabled && isFirebaseConfigured() && !isDemoModeActive);

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
    const userId = syncUserId;
    if (!userId || !canWriteWorkspace()) {
        return false;
    }

    // Add to echo suppression set
    recentlyWrittenMessageIds.add(message.id);
    setTimeout(() => {
        recentlyWrittenMessageIds.delete(message.id);
    }, MESSAGE_ECHO_TIMEOUT_MS);

    try {
        return await saveMessageToFirestore(userId, message);
    } catch {
        console.error('[SyncManager] Message sync failed');
        recentlyWrittenMessageIds.delete(message.id);
        return false;
    }
};

/**
 * Sync food logs to Firestore
 */
export const syncFoodLogsToCloud = async (foodLogs: FoodLogEntry[]): Promise<boolean> => {
    const userId = syncUserId;
    if (!userId || !canWriteWorkspace()) return false;
    return saveFoodLogs(userId, foodLogs);
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
    const userId = syncUserId;
    if (!userId || !canWriteWorkspace()) return false;
    return saveAttendanceData(userId, data);
};

/**
 * Sync chat sessions to Firestore
 */
export const syncChatSessionsToCloud = async (sessions: ChatSession[]): Promise<boolean> => {
    const userId = syncUserId;
    if (!userId || !canWriteWorkspace()) return false;
    return saveChatSessions(userId, sessions);
};

/** Persist branch metadata only after the authorized workspace has a server baseline. */
export const syncChatBranchesToCloud = async (branches: ConversationBranch[]): Promise<boolean> => {
    const userId = syncUserId;
    const capturedToken = syncSessionToken;
    if (!userId || !canWriteWorkspace()) return false;

    // Branches have their own transactional document and do not pass through
    // the deferred workspace-save queue. Retry a few transient transaction or
    // transport failures here so a quiet client does not leave a fork/delete
    // pending until some unrelated edit happens. Re-check identity and consent
    // before every attempt so retries cannot cross an account or consent edge.
    for (let attempt = 0; attempt <= MAX_AUTOMATIC_SYNC_RETRIES; attempt += 1) {
        if (capturedToken !== syncSessionToken || userId !== syncUserId || !canWriteWorkspace()) return false;
        if (await saveChatBranches(userId, branches)) return true;
        if (attempt === MAX_AUTOMATIC_SYNC_RETRIES) return false;
        await new Promise<void>(resolve => setTimeout(resolve, automaticRetryDelay(attempt + 1)));
    }
    return false;
};

/**
 * Delete channel messages from Firestore cloud
 */
export const deleteChannelMessagesFromCloud = async (channelId: string): Promise<boolean> => {
    const userId = syncUserId;
    if (!userId || !canWriteWorkspace()) return false;
    return deleteChannelMessages(userId, channelId);
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
    deferredSyncProvider = null;
    automaticSyncRetryCount = 0;
    stopRealtimeSync();
    recentlyWrittenMessageIds.clear();
    lastSyncTimestamp = null;
    lastSyncConfigSignature = null;
    cloudBaselineReady = false;
    syncUserId = null;
    conflictedEntityIds.clear();
    workspaceCloudSyncEnabled = false;
    onSyncStatusChange = null;
    onRemoteDataChange = null;
    isSyncing = false;
    console.log('[SyncManager] Cleaned up');
};

/**
 * Check if sync is currently active
 */
export const isSyncActive = () => !!syncUserId && workspaceCloudSyncEnabled;

/**
 * Get current sync user ID
 */
export const getSyncUserId = () => workspaceCloudSyncEnabled ? syncUserId : null;

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorage } from './services/storage';
import { v4 as uuidv4 } from 'uuid';
import { GoogleCalendarAdapter } from './services/googleSync';
import { generateBriefing } from './services/ai';
import { mergeData, mergeMessages, mergeCloudSettings } from './services/firestoreSync';
import { scheduleSync, syncMessage, syncFoodLogsToCloud, syncAttendanceToCloud, syncChatSessionsToCloud, deleteChannelMessagesFromCloud, setDemoModeSyncBlock, syncWorkspaceNow, loadInitialData, isWorkspaceCloudSyncActiveFor } from './services/syncManager';
import { AuthenticatedIdentity, getPlatform } from './services/platform';
import { validatePersistedState, validateOperations } from './utils/validation';
import {
    normalizePayload,
    expandOperationType,
    calculateNextDate,
    resolveEntityId,
    HistorySnapshot,
    isEntityActive,
    getActiveEntities,
    isChatSessionActive,
    getActiveChatSessions,
} from './store/helpers';
import {
    Entity,
    Relationship,
    Message,
    ChatSession,
    EntityKind,
    EntityStatus,
    RelationshipType,
    ToonOperation,
    ToonOperationType,
    SyncQueueItem,
    ViewType,
    CalendarViewMode,
    UserSettings,
    DebugLogEntry,
    FocusSession,
    DailyBriefing,
    RecurrenceType,
    Toast,
    TagDefinition,
    HabitMetadata,
    Subtask,
    ActivityLogEntry,
    FoodLogEntry,
    Subject,
    ClassSchedule,
    Holiday,
    AttendanceLog,
    ConversationBranch,
    BranchQueueItem,
    BranchExecutionLease,
    DeveloperDiagnostics,
    ConversationDraft,
    TurnExecutor,
} from './types';
import { resolveBranchHistory, getSiblingVersions, findLeafMessage, sanitizeSecrets } from './utils/conversationGraph';
import {
    Entity as KernelEntity,
    SchemaDefinition,
    AuditLogEntry,
    AttributeValue,
    SchemaRegistry,
    KernelAuthorizer,
    ActionExecutionEngine,
    ExecutionPlan,
    ConfirmedExecutionPlan,
    InMemoryPersistenceAdapter,
    StorePersistenceAdapter,
    convertOperationsToActionProposal,
} from './services/kernel';
import { bootstrapKernel } from './services/kernel/bootstrap';
import { projectKernelEntitiesToLegacy } from './store/kernelProjection';
import {
    upgradeLegacyEntityToKernel,
    upgradeLegacyMealLogToKernel,
    mapLegacyKindToSchemaId,
} from './services/persistence/legacyMigration';
import {
    ConflictDescriptor,
    ConflictResolutionOption,
    globalIdempotencyTracker,
    globalPendingMutationQueue,
    reconcileEntityCollection,
} from './services/sync';

// --- Store Definition ---

export interface FlowmateState {
    isHydrated: boolean;
    // Canonical Greenfield Domain Kernel State
    kernelEntities: Record<string, KernelEntity>;
    schemas: Record<string, SchemaDefinition>;
    auditLogs: AuditLogEntry[];

    // Read-only Compatibility Projection for Legacy Views (runtime frozen via Object.freeze)
    entities: Entity[];
    relationships: Relationship[];
    universalTags: TagDefinition[];
    messages: Message[];
    pendingOps: {
        ops: ToonOperation[];
        originalMessageId: string;
        reviewId: string;
    } | null;
    syncQueue: SyncQueueItem[];
    currentView: ViewType;
    selectedEntityId: string | null;
    settings: UserSettings;
    debugLogs: DebugLogEntry[];
    focusSession: FocusSession | null;
    dailyBriefing: DailyBriefing | null;
    foodLogs: FoodLogEntry[]; // Flowmate 3.0: Food Tracking
    // Flowmate 3.1: Attendance Tracking
    subjects: Subject[];
    classSchedule: ClassSchedule[];
    holidays: Holiday[];
    attendanceLogs: AttendanceLog[];

    // Auth State
    currentUser: AuthenticatedIdentity | null;
    isCloudSyncEnabled: boolean;

    // Sync State (P1-09)
    syncStatus: 'idle' | 'syncing' | 'error';
    lastSyncedAt: string | null;
    syncError: string | null;
    conflicts: ConflictDescriptor[];

    // Offline Support
    isOnline: boolean;
    offlineQueue: { id: string; message: string; timestamp: string }[];

    // UI State
    isZenMode: boolean;
    toasts: Toast[];
    showConfetti: boolean;
    pendingOrchestration: string | null;
    knowledgeInitialFilters: string[] | null;  // Filters to apply when navigating to Knowledge
    calendarInitialView: CalendarViewMode | null;  // View mode to apply when navigating to Calendar

    // History
    history: HistorySnapshot[];
    historyPointer: number;

    // Chat Sessions (ChatGPT-style multi-chat)
    chatSessions: ChatSession[];
    activeSessionId: string;

    // Conversation Graph & Branching (Phase 3)
    branches: ConversationBranch[];
    activeBranchId: string;
    branchQueues: Record<string, BranchQueueItem[]>;
    activeLease: BranchExecutionLease | null;
    developerModeEnabled: boolean;
    lastTurnDiagnostics?: DeveloperDiagnostics['lastTurnMetrics'];
    isStreaming: boolean;
    streamingMessageId: string | null;
    unsentDrafts: Record<string, ConversationDraft>;

    // Actions
    setHydrated: (val: boolean) => void;
    addMessage: (role: 'user' | 'assistant', text: string, ops?: ToonOperation[], attachment?: string | null, channelId?: string) => string;
    createChatSession: (title?: string) => string;
    setActiveSessionId: (id: string) => void;
    deleteChatSession: (id: string) => void;
    renameChatSession: (id: string, newTitle: string) => void;
    clearChatSession: (id: string) => void;
    setPendingOps: (ops: ToonOperation[], originalMessageId?: string) => void;
    clearPendingOps: () => void;
    applyOperations: (ops: ToonOperation[]) => void;
    processSyncQueue: () => Promise<void>;
    getSnapshot: () => { entities: Entity[]; relationships: Relationship[] };
    getActiveEntities: () => Entity[];

    // Entity/Relationship CRUD
    addEntity: (entity: Entity) => void;
    updateEntity: (id: string, updates: Partial<Entity>) => void;
    deleteEntity: (id: string) => void;
    addRelationship: (rel: Relationship) => void;
    removeRelationship: (id: string) => void;

    // Greenfield Action Execution Pipeline
    planOperations: (ops: ToonOperation[], source?: 'user_ui' | 'ai_agent') => { success: boolean; plan?: ExecutionPlan; error?: string };
    confirmPlan: (plan: ExecutionPlan) => ConfirmedExecutionPlan;
    executeConfirmedPlan: (confirmedPlan: ConfirmedExecutionPlan) => Promise<boolean>;

    // View Navigation
    setView: (view: ViewType, knowledgeFilters?: string[], calendarView?: CalendarViewMode) => void;
    selectEntity: (id: string | null) => void;
    updateSettings: (settings: Partial<UserSettings>) => void;
    addDebugLog: (type: DebugLogEntry['type'], summary: string, details?: any) => void;
    clearDebugLogs: () => void;
    importData: (data: Partial<FlowmateState>) => void;

    // Toggle UI
    toggleZenMode: () => void;
    addToast: (message: string, type?: Toast['type']) => void;
    removeToast: (id: string) => void;
    triggerConfetti: () => void;
    setPendingOrchestration: (message: string | null) => void;

    // Undo/Redo
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;

    // Focus Timer Actions
    startFocusSession: (entityId: string, durationMinutes?: number) => void;
    endFocusSession: () => void;

    // AI Actions
    refreshDailyBriefing: () => Promise<string | null>;

    // Quick CRUD helpers for the Orchestrator
    findEntityByTitle: (title: string) => Entity | undefined;

    // Computed
    getXP: () => number;

    // Auto-maintenance
    autoArchiveStaleEntities: () => number;

    // Auth & Cloud Sync
    setCurrentUser: (user: AuthenticatedIdentity | null) => void;
    setCloudSyncEnabled: (enabled: boolean) => void;
    syncToCloud: () => Promise<void>;
    loadFromCloud: () => Promise<void>;
    resolveConflict: (conflictId: string, resolution: ConflictResolutionOption) => void;
    clearConflict: (conflictId: string) => void;

    // Offline Queue
    setOnline: (status: boolean) => void;
    addToOfflineQueue: (message: string) => void;
    removeFromOfflineQueue: (id: string) => void;
    getOfflineQueue: () => { id: string; message: string; timestamp: string }[];

    // Conversation Graph & Branching Actions (Phase 3)
    toggleDeveloperMode: () => void;
    setUnsentDraft: (branchId: string, text: string) => void;
    setDraftAttachment: (branchId: string, attachment: string | null) => void;
    getUnsentDraft: (branchId: string) => string;
    updateMessageText: (id: string, text: string) => void;
    updateMessageTurnMetadata: (id: string, metadata: Partial<NonNullable<Message['turn_metadata']>>) => void;
    createBranch: (name: string, forkMessageId?: string, channelId?: string) => string;
    setActiveBranchId: (branchId: string) => void;
    renameBranch: (branchId: string, newName: string) => void;
    deleteBranch: (branchId: string) => void;
    restoreBranch: (branchId: string) => void;
    editAndBranchMessage: (messageId: string, newText: string) => string;
    switchSiblingVersion: (targetMessageId: string) => void;
    enqueueUserMessage: (text: string, branchId?: string, channelId?: string) => BranchQueueItem;
    cancelQueuedItem: (itemId: string, branchId: string) => void;
    setIsStreaming: (isStreaming: boolean, messageId?: string | null) => void;
    setLastTurnDiagnostics: (metrics: DeveloperDiagnostics['lastTurnMetrics']) => void;
    forkBranch: (messageId: string, name?: string) => string;
    forkAndSendMessage: (
        messageId: string,
        newText: string,
        options?: { submissionId?: string; simulatedFailure?: boolean }
    ) => Promise<{ branchId: string; userMessageId: string; assistantMessageId?: string; queueItemId?: string } | null>;
    retryQueuedUserMessage: (userMessageId: string) => Promise<boolean>;
    registerTurnExecutor: (executor: TurnExecutor | null) => void;
    processBranchQueue: (branchId: string) => Promise<void>;

    // Demo Workspace Isolation (P0-B)
    isDemoMode: boolean;
    personalSnapshot: {
        // Account identity binding — snapshot is only valid for this UID
        snapshotOwnerId: string | null;
        kernelEntities: Record<string, KernelEntity>;
        entities: Entity[];
        relationships: Relationship[];
        universalTags: TagDefinition[];
        selectedEntityId: string | null;
        messages: Message[];
        chatSessions: ChatSession[];
        activeSessionId: string;
        syncQueue: SyncQueueItem[];
        // Branch state captured before demo entry (fix: demo branches must not persist)
        branches: ConversationBranch[];
        activeBranchId: string;
        branchQueues: Record<string, BranchQueueItem[]>;
        unsentDrafts?: Record<string, ConversationDraft>;
        history?: HistorySnapshot[];
        historyPointer?: number;
        dailyBriefing?: DailyBriefing | null;
        focusSession?: FocusSession | null;
    } | null;
    enterDemoMode: (demoEntities: Record<string, KernelEntity>) => void;
    exitDemoMode: () => Promise<void>;
    resetDemoWorkspace: (demoEntities: Record<string, KernelEntity>) => void;
}

// Global consumed confirmation tokens Set for single-use token replay protection
const consumedPlanTokens = new Set<string>();
let registeredTurnExecutor: TurnExecutor | null = null;
const inFlightSubmissions = new Set<string>();
let sampleExitInProgress = false;
let personalStorageAtSampleEntry: string | null = null;

export const useStore = create<FlowmateState>()(
    persist(
        (set, get) => ({
            isHydrated: false,
            kernelEntities: {},
            schemas: bootstrapKernel().schemas,
            auditLogs: [],
            entities: [],
            relationships: [],
            universalTags: [], // Initialize empty, will be populated if needed by migration
            messages: [
                {
                    id: 'init-1',
                    role: 'assistant',
                    text: 'Welcome to Flowmate. What would you like to talk through or work on?',
                    created_at: new Date().toISOString(),
                    channelId: 'general'
                }
            ],
            chatSessions: [
                {
                    id: 'general',
                    title: 'General Chat',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            ],
            activeSessionId: 'general',
            branches: [
                {
                    id: 'b_main_general',
                    conversation_id: 'general',
                    name: 'Main',
                    head_message_id: 'init-1',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            ],
            activeBranchId: 'b_main_general',
            branchQueues: {},
            activeLease: null,
            developerModeEnabled: false,
            isStreaming: false,
            streamingMessageId: null,
            unsentDrafts: {},
            pendingOps: null,
            syncQueue: [],
            currentView: 'dashboard',
            selectedEntityId: null,
            settings: {
                timezone: 'Asia/Kolkata', // Force IST
                preferred_model: 'gemini-3.8-flash',
                preferred_live_model: 'gemini-3.8-live',
                preferred_live_reasoning_level: 'medium',
                sync_ai_preferences: false,
                save_voice_transcripts: false,
                sync_enabled: false,
                debug_mode: false,
                custom_instructions: '',
                feature_toggles: {
                    food_tracking: true,        // Mess menu display
                    attendance_tracking: false, // Disabled by default
                    people_tracking: true,
                    gamification: false,        // Disabled by default
                    quick_streaks: true,        // Enabled
                },
                productivity_calc_method: 'LOGGED_TIME',
                home_location: undefined,
                travel_preferences: {
                    station_buffer_minutes: 45,
                    airport_buffer_minutes: 120,
                    default_transit_mode: 'driving'
                },
                privacy_preferences: {
                    capabilities: {
                        device_location: {
                            read: 'ask',
                            mutation: 'deny',
                        },
                    },
                    audit_logging_enabled: true,
                }
            },
            debugLogs: [],
            focusSession: null,
            dailyBriefing: null,
            foodLogs: [], // Flowmate 3.0: Food Tracking
            // Flowmate 3.1: Attendance Tracking
            subjects: [],
            classSchedule: [],
            holidays: [],
            attendanceLogs: [],
            isZenMode: false,
            toasts: [],
            showConfetti: false,
            pendingOrchestration: null,
            knowledgeInitialFilters: null,  // Filters for Knowledge view
            calendarInitialView: null,  // View mode for Calendar
            history: [],
            historyPointer: -1,

            // Auth State
            currentUser: null,
            isCloudSyncEnabled: false,

            // Sync State (P1-09)
            syncStatus: 'idle' as const,
            lastSyncedAt: null,
            syncError: null,
            conflicts: [],

            // Offline Support
            isOnline: getPlatform().getCapabilities().isOnline,
            offlineQueue: [],

            // Demo Workspace Isolation (P0-B)
            isDemoMode: false,
            personalSnapshot: null,

            enterDemoMode: (demoEntities: Record<string, KernelEntity>) => {
                const state = get();
                if (state.isStreaming || state.activeLease) {
                    state.addToast('Stop the current response before opening sample data', 'info');
                    return;
                }
                setDemoModeSyncBlock(true);
                try { personalStorageAtSampleEntry = window.localStorage.getItem('flowmate-storage'); } catch { personalStorageAtSampleEntry = null; }
                if (state.isDemoMode) {
                    const projected = projectKernelEntitiesToLegacy(demoEntities);
                    set({
                        kernelEntities: demoEntities,
                        entities: projected,
                        selectedEntityId: null,
                    });
                    return;
                }

                // Snapshot personal entities, branch state, and account identity.
                // snapshotOwnerId binds this snapshot to the current user's UID so
                // exitDemoMode can refuse to restore it under a different account.
                const personalSnapshot = {
                    snapshotOwnerId: state.currentUser?.uid ?? null,
                    kernelEntities: { ...state.kernelEntities },
                    entities: [...state.entities],
                    relationships: [...state.relationships],
                    universalTags: [...state.universalTags],
                    selectedEntityId: state.selectedEntityId,
                    messages: [...(state.messages || [])],
                    chatSessions: [...(state.chatSessions || [])],
                    activeSessionId: state.activeSessionId,
                    syncQueue: [...(state.syncQueue || [])],
                    // Branch state — captured so demo-created branches never leak into personal storage
                    branches: [...(state.branches || [])],
                    activeBranchId: state.activeBranchId ?? 'main',
                    branchQueues: { ...(state.branchQueues || {}) },
                    unsentDrafts: { ...(state.unsentDrafts || {}) },
                    history: state.history,
                    historyPointer: state.historyPointer,
                    dailyBriefing: state.dailyBriefing,
                    focusSession: state.focusSession,
                };

                try {
                    if (typeof window !== 'undefined' && window.localStorage) {
                        window.localStorage.setItem('flowmate_personal_state_backup', JSON.stringify(personalSnapshot));
                    }
                } catch (e) {
                    console.warn('[DemoMode] Backup write warning:', e);
                }

                const projected = projectKernelEntitiesToLegacy(demoEntities);
                set({
                    isDemoMode: true,
                    personalSnapshot,
                    kernelEntities: demoEntities,
                    entities: projected,
                    selectedEntityId: null,
                    // Reset branch state for demo workspace — prevents personal branches
                    // from being visible during demo and demo branches from entering
                    // the personal branch list.
                    relationships: [], universalTags: [], messages: [],
                    chatSessions: [{ id: 'sample', title: 'Sample conversation', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
                    activeSessionId: 'sample', syncQueue: [], pendingOps: null,
                    history: [], historyPointer: -1, dailyBriefing: null, focusSession: null, unsentDrafts: {},
                    branches: [{ id: 'b_main_sample', conversation_id: 'sample', name: 'Main', head_message_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
                    activeBranchId: 'b_main_sample',
                    branchQueues: {},
                });
            },

            exitDemoMode: async () => {
                const state = get();
                if (state.isDemoMode && (state.isStreaming || state.activeLease)
                    && state.personalSnapshot?.snapshotOwnerId === (state.currentUser?.uid ?? null)) {
                    state.addToast('Stop the current response before leaving sample data', 'info');
                    return;
                }
                setDemoModeSyncBlock(false);
                sampleExitInProgress = true;
                let restored = state.personalSnapshot;

                if (!restored) {
                    try {
                        if (typeof window !== 'undefined' && window.localStorage) {
                            const backup = window.localStorage.getItem('flowmate_personal_state_backup');
                            if (backup) {
                                restored = JSON.parse(backup);
                            }
                        }
                    } catch (e) {
                        console.warn('[DemoMode] Backup read warning:', e);
                    }
                }

                try {
                    if (typeof window !== 'undefined' && window.localStorage) {
                        window.localStorage.removeItem('flowmate_personal_state_backup');
                    }
                } catch {}

                // SECURITY: Validate that the snapshot belongs to the current account.
                // If the user changed accounts during the demo session, the snapshot
                // was captured for a different UID and MUST NOT be restored.
                // In unauthenticated mode, both are null which is valid for local restoration.
                const currentUid = state.currentUser?.uid ?? null;
                const snapshotOwner = restored ? (restored.snapshotOwnerId ?? null) : null;
                const snapshotIsForCurrentUser = snapshotOwner === currentUid;

                if (restored && snapshotIsForCurrentUser) {
                    set({
                        isDemoMode: false,
                        personalSnapshot: null,
                        kernelEntities: restored.kernelEntities || {},
                        entities: restored.entities || [],
                        relationships: restored.relationships || [],
                        universalTags: restored.universalTags || [],
                        selectedEntityId: restored.selectedEntityId || null,
                        messages: restored.messages || [],
                        chatSessions: restored.chatSessions || [],
                        activeSessionId: restored.activeSessionId || (restored.chatSessions?.[0]?.id ?? 'general'),
                        syncQueue: restored.syncQueue || [],
                        // Restore branch state from pre-demo snapshot so demo branches are discarded
                        branches: restored.branches || [],
                        activeBranchId: restored.activeBranchId || 'main',
                        branchQueues: restored.branchQueues || {},
                        unsentDrafts: restored.unsentDrafts || {},
                        history: restored.history || [], historyPointer: restored.historyPointer ?? -1,
                        dailyBriefing: restored.dailyBriefing || null, focusSession: restored.focusSession || null,
                        pendingOps: null,
                    });
                } else {
                    // No valid snapshot for this account — return to clean empty state.
                    // This handles: first-time demo, account switch during demo, or corrupt backup.
                    if (restored && !snapshotIsForCurrentUser) {
                        console.warn('[DemoMode] Snapshot UID mismatch — discarding snapshot to prevent cross-account data leakage');
                    }
                    set({
                        isDemoMode: false,
                        personalSnapshot: null,
                        kernelEntities: {},
                        entities: [],
                        relationships: [],
                        universalTags: [],
                        selectedEntityId: null,
                        messages: [],
                        chatSessions: [],
                        activeSessionId: 'general',
                        syncQueue: [],
                        branches: [],
                        activeBranchId: 'main',
                        branchQueues: {},
                        unsentDrafts: {}, history: [], historyPointer: -1, dailyBriefing: null, focusSession: null, pendingOps: null,
                    });
                }
                // Sample edits never write the personal snapshot. Reload the latest personal
                // state on exit, including edits made in another tab while samples were open.
                try {
                    let personalStateChanged = false;
                    try { personalStateChanged = window.localStorage.getItem('flowmate-storage') !== personalStorageAtSampleEntry; } catch { /* Keep the recoverable in-memory snapshot. */ }
                    if (snapshotIsForCurrentUser && personalStateChanged) await useStore.persist.rehydrate();
                } finally {
                    sampleExitInProgress = false;
                    personalStorageAtSampleEntry = null;
                }
            },

            resetDemoWorkspace: (demoEntities: Record<string, KernelEntity>) => {
                if (!get().isDemoMode) return; // Reset cannot replace an ordinary personal workspace.
                setDemoModeSyncBlock(true);
                const projected = projectKernelEntitiesToLegacy(demoEntities);
                set({
                    kernelEntities: demoEntities,
                    entities: projected,
                    selectedEntityId: null,
                    relationships: [], messages: [], unsentDrafts: {}, history: [], historyPointer: -1,
                    pendingOps: null, dailyBriefing: null, focusSession: null, branchQueues: {},
                    branches: [{ id: 'b_main_sample', conversation_id: 'sample', name: 'Main', head_message_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
                    activeBranchId: 'b_main_sample', activeSessionId: 'sample',
                    chatSessions: [{ id: 'sample', title: 'Sample conversation', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
                });
            },

            // Offline Queue Actions
            setOnline: (status) => set({ isOnline: status }),
            addToOfflineQueue: (message) => set(state => ({
                offlineQueue: [...state.offlineQueue, {
                    id: uuidv4(),
                    message,
                    timestamp: new Date().toISOString()
                }]
            })),
            removeFromOfflineQueue: (id) => set(state => ({
                offlineQueue: state.offlineQueue.filter(q => q.id !== id)
            })),
            getOfflineQueue: () => get().offlineQueue,

            // Pending Orchestration (for triggering LLM from other components)
            setPendingOrchestration: (message) => set({ pendingOrchestration: message }),

            // Auth Actions
            setCurrentUser: (user) => set({ currentUser: user }),

            setCloudSyncEnabled: (enabled) => set({ isCloudSyncEnabled: enabled }),

            syncToCloud: async () => {
                const { currentUser, isDemoMode, entities, relationships, universalTags, messages, settings, foodLogs, subjects, classSchedule, holidays, attendanceLogs, addDebugLog, addToast } = get();
                if (isDemoMode) {
                    addToast('Cloud sync is blocked while the isolated sample workspace is open', 'info');
                    return;
                }
                if (!currentUser) {
                    addToast('Sign in to sync to cloud', 'info');
                    return;
                }
                if (!isWorkspaceCloudSyncActiveFor(currentUser.uid)) {
                    addToast('Enable workspace cloud sync in Settings before syncing personal data.', 'info');
                    return;
                }

                try {
                    set({ syncStatus: 'syncing', syncError: null });
                    const success = await syncWorkspaceNow({
                        entities,
                        relationships,
                        universalTags,
                        messages,
                        settings,
                        foodLogs,
                        subjects,
                        classSchedule,
                        holidays,
                        attendanceLogs,
                    });
                    if (success) {
                        set({ syncStatus: 'idle', lastSyncedAt: new Date().toISOString(), syncError: null });
                        addDebugLog('sync', 'Synced to Firestore', { entityCount: entities.length });
                        addToast('Synced to cloud', 'success');
                    } else {
                        set({ syncStatus: 'error', syncError: 'Cloud save did not complete' });
                        addToast('Cloud save did not complete; local data is retained', 'error');
                    }
                } catch {
                    set({ syncStatus: 'error', syncError: 'Cloud save failed' });
                    console.error('Cloud sync failed');
                    addToast('Cloud sync failed', 'error');
                }
            },

            loadFromCloud: async () => {
                const { currentUser, isDemoMode, kernelEntities, relationships, messages, addDebugLog, addToast } = get();
                if (isDemoMode) {
                    addToast('Please exit Demo Mode before loading personal cloud data', 'info');
                    return;
                }
                if (!currentUser) return;
                if (!isWorkspaceCloudSyncActiveFor(currentUser.uid)) {
                    addToast('Enable workspace cloud sync in Settings before loading personal cloud data.', 'info');
                    return;
                }

                try {
                    const data = await loadInitialData();
                    if (data) {
                        // Reconcile entities into canonical kernelEntities using deterministic P1-09 engine
                        const { nextKernelEntities, conflicts: newConflicts } = reconcileEntityCollection(
                            kernelEntities,
                            data.entities || [],
                            globalPendingMutationQueue
                        );
                        const projectedEntities = projectKernelEntitiesToLegacy(nextKernelEntities);

                        // Merge relationships (newer wins)
                        const merged = mergeData(
                            { entities: projectedEntities as Entity[], relationships },
                            { entities: data.entities, relationships: data.relationships }
                        );
                        // Merge messages (additive union by ID)
                        const mergedMsgs = mergeMessages(messages || [], data.messages || []);

                        set({
                            kernelEntities: nextKernelEntities,
                            entities: projectedEntities,
                            relationships: merged.relationships,
                            universalTags: data.universalTags,
                            messages: mergedMsgs,
                            conflicts: [...(get().conflicts || []), ...newConflicts],
                            settings: mergeCloudSettings(get().settings, data.settings || {}) as UserSettings,
                            foodLogs: data.foodLogs?.length ? data.foodLogs : get().foodLogs,
                            subjects: data.subjects?.length ? data.subjects : get().subjects,
                            classSchedule: data.classSchedule?.length ? data.classSchedule : get().classSchedule,
                            holidays: data.holidays?.length ? data.holidays : get().holidays,
                            attendanceLogs: data.attendanceLogs?.length ? data.attendanceLogs : get().attendanceLogs,
                        });
                        addDebugLog('sync', 'Merged from Firestore with deterministic P1-09 reconciliation', {
                            cloudCount: data.entities.length,
                            canonicalCount: Object.keys(nextKernelEntities).length,
                            conflictsCount: newConflicts.length,
                            messagesCount: mergedMsgs.length,
                        });
                        addToast('Synced with cloud', 'success');
                    } else {
                        addToast('No cloud workspace was available; local data was left unchanged.', 'info');
                    }
                } catch {
                    console.error('Cloud load failed');
                    addToast('Failed to load from cloud', 'error');
                }
            },

            resolveConflict: (conflictId, resolution) => {
                const state = get();
                const conflict = (state.conflicts || []).find(c => c.id === conflictId);
                if (!conflict) return;

                const entityId = conflict.entity_id;
                const existing = state.kernelEntities[entityId];

                if (resolution === 'keep_local' && existing) {
                    const updated: KernelEntity = {
                        ...existing,
                        version: Math.max(conflict.local_revision, conflict.remote_revision) + 1,
                        lifecycle: {
                            ...existing.lifecycle,
                            updated_at: new Date().toISOString(),
                        },
                    };
                    const nextKernel = { ...state.kernelEntities, [entityId]: updated };
                    const projected = projectKernelEntitiesToLegacy(nextKernel);
                    set({
                        kernelEntities: nextKernel,
                        entities: projected,
                        conflicts: (state.conflicts || []).filter(c => c.id !== conflictId),
                    });
                    if (!get().isDemoMode) {
                        scheduleSync(() => ({
                            entities: projected,
                            relationships: state.relationships,
                            universalTags: state.universalTags,
                            settings: state.settings,
                        }));
                    }
                } else {
                    set({
                        conflicts: (state.conflicts || []).filter(c => c.id !== conflictId),
                    });
                }
            },

            clearConflict: (conflictId) => {
                set(state => ({
                    conflicts: (state.conflicts || []).filter(c => c.id !== conflictId),
                }));
            },

            setHydrated: (val) => set({ isHydrated: val }),

            setView: (view, knowledgeFilters, calendarView) => set({
                currentView: view,
                knowledgeInitialFilters: knowledgeFilters || null,
                calendarInitialView: calendarView || null
            }),

            selectEntity: (id) => set({ selectedEntityId: id }),

            // Entity/Relationship CRUD Methods (wrappers around applyOperations)
            addEntity: (entity) => {
                get().applyOperations([{ type: 'create_entity', payload: entity }]);
            },
            updateEntity: (id, updates) => {
                get().applyOperations([{ type: 'update_entity', payload: { id, fields: updates } }]);
            },
            deleteEntity: (id) => {
                get().applyOperations([{ type: 'delete_entity', payload: { id } }]);
            },
            addRelationship: (rel) => {
                get().applyOperations([{ type: 'link_entities', payload: { from: rel.from, to: rel.to, type: rel.type } }]);
            },
            removeRelationship: (id) => {
                get().applyOperations([{ type: 'unlink_entities', payload: { id } }]);
            },

            planOperations: (ops, source = 'ai_agent') => {
                try {
                    const { schemas, kernelEntities, relationships, currentUser } = get();
                    const userId = currentUser?.uid || 'local_user';

                    const schemaRegistry = new SchemaRegistry();
                    for (const schema of Object.values(schemas)) {
                        schemaRegistry.register(schema);
                    }
                    const authorizer = new KernelAuthorizer();
                    const dummyPersistence = new InMemoryPersistenceAdapter();
                    const engine = new ActionExecutionEngine(schemaRegistry, authorizer, dummyPersistence);

                    const proposal = convertOperationsToActionProposal(ops, {
                        source,
                        currentEntities: kernelEntities,
                        currentRelationships: relationships,
                        intent: `Execute ${ops.length} operation(s)`,
                    });

                    return engine.plan(
                        proposal,
                        {
                            actor: source,
                            authenticated_user_id: userId,
                        },
                        (id) => kernelEntities[id] || null
                    );
                } catch (err: unknown) {
                    return {
                        success: false,
                        error: err instanceof Error ? err.message : String(err),
                    };
                }
            },

            confirmPlan: (plan) => {
                const { schemas, currentUser } = get();
                const userId = currentUser?.uid || 'local_user';

                const schemaRegistry = new SchemaRegistry();
                for (const schema of Object.values(schemas)) {
                    schemaRegistry.register(schema);
                }
                const authorizer = new KernelAuthorizer();
                const dummyPersistence = new InMemoryPersistenceAdapter();
                const engine = new ActionExecutionEngine(schemaRegistry, authorizer, dummyPersistence);

                return engine.confirm(plan, {
                    actor: 'user_ui',
                    authenticated_user_id: userId,
                });
            },

            executeConfirmedPlan: async (confirmedPlan) => {
                const { schemas, currentUser, addToast, addDebugLog } = get();
                const userId = currentUser?.uid || 'local_user';

                const schemaRegistry = new SchemaRegistry();
                for (const schema of Object.values(schemas)) {
                    schemaRegistry.register(schema);
                }
                const authorizer = new KernelAuthorizer();

                const persistence = new StorePersistenceAdapter({
                    getKernelEntities: () => get().kernelEntities,
                    getRelationships: () => get().relationships,
                    getSchemas: () => get().schemas,
                    getAuditLogs: () => get().auditLogs,
                    applyBatch: (mutations) => {
                        const nextKernelEntities: Record<string, KernelEntity> = { ...get().kernelEntities };
                        const nextAuditLogs: AuditLogEntry[] = [...get().auditLogs];
                        let nextRelationships: Relationship[] = [...(get().relationships || [])];
                        const now = new Date().toISOString();

                        for (const m of mutations) {
                            if (m.type === 'set_entity') {
                                nextKernelEntities[m.entity.id] = m.entity;
                                globalIdempotencyTracker.record(`${m.entity.id}_${m.entity.version}`);
                                if (typeof navigator !== 'undefined' && !navigator.onLine) {
                                    globalPendingMutationQueue.enqueue(
                                        `mut_${uuidv4()}`,
                                        m.entity.id,
                                        Math.max(0, m.entity.version - 1),
                                        'upsert_entity',
                                        m.entity,
                                        now
                                    );
                                }
                            } else if (m.type === 'soft_delete_entity') {
                                const existing = nextKernelEntities[m.id];
                                if (existing) {
                                    const deletedEntity: KernelEntity = {
                                        ...existing,
                                        version: (existing.version || 1) + 1,
                                        lifecycle: {
                                            ...existing.lifecycle,
                                            status: 'deleted',
                                            deleted_at: now,
                                            updated_at: now,
                                        },
                                        attributes: {
                                            ...existing.attributes,
                                            deleted: true,
                                        },
                                    };
                                    nextKernelEntities[m.id] = deletedEntity;
                                    globalIdempotencyTracker.record(`${m.id}_${deletedEntity.version}`);
                                    if (typeof navigator !== 'undefined' && !navigator.onLine) {
                                        globalPendingMutationQueue.enqueue(
                                            `mut_${uuidv4()}`,
                                            m.id,
                                            existing.version || 1,
                                            'soft_delete_entity',
                                            deletedEntity,
                                            now
                                        );
                                    }
                                }
                            } else if (m.type === 'append_audit_log') {
                                nextAuditLogs.push(m.entry);
                            } else if (m.type === 'set_relationship') {
                                const rel = m.relationship;
                                const existingIdx = nextRelationships.findIndex(r => r.id === rel.id || (
                                    r.from === rel.from &&
                                    r.to === rel.to &&
                                    r.type === (rel.type as unknown as RelationshipType)
                                ));
                                const storeRel: Relationship = {
                                    id: rel.id,
                                    from: rel.from,
                                    to: rel.to,
                                    type: rel.type as RelationshipType,
                                    meta: rel.meta || {},
                                    created_at: rel.created_at || now,
                                };
                                if (existingIdx >= 0) {
                                    nextRelationships[existingIdx] = storeRel;
                                } else {
                                    nextRelationships.push(storeRel);
                                }
                                globalIdempotencyTracker.record(`rel_${rel.id}`);
                            } else if (m.type === 'delete_relationship') {
                                nextRelationships = nextRelationships.filter(r => r.id !== m.id);
                                globalIdempotencyTracker.record(`del_rel_${m.id}`);
                            }
                        }

                        const projectedEntities = projectKernelEntitiesToLegacy(nextKernelEntities);
                        set({
                            kernelEntities: nextKernelEntities,
                            entities: projectedEntities,
                            relationships: nextRelationships,
                            auditLogs: nextAuditLogs.slice(-100),
                        });
                    },
                });

                const engine = new ActionExecutionEngine(schemaRegistry, authorizer, persistence, consumedPlanTokens);
                const success = await engine.execute(confirmedPlan, {
                    actor: 'user_ui',
                    authenticated_user_id: userId,
                });

                if (success) {
                    globalIdempotencyTracker.record(confirmedPlan.confirmation_token);
                    if (confirmedPlan.plan.validated_mutations.length === 0) {
                        addToast('No operations to execute in confirmed plan', 'warning');
                    } else {
                        addToast(`Executed ${confirmedPlan.plan.validated_mutations.length} planned operations`, 'success');
                    }
                    addDebugLog('system', 'Executed confirmed execution plan', {
                        fingerprint: confirmedPlan.verified_fingerprint,
                        confirmed_by: confirmedPlan.confirmed_by,
                    });
                    // Auto-sync kernel state changes to cloud (blocked in demo mode)
                    if (!get().isDemoMode) {
                        scheduleSync(() => {
                            const s = get();
                            return {
                                entities: s.entities,
                                relationships: s.relationships,
                                universalTags: s.universalTags,
                                settings: s.settings,
                            };
                        });
                    }
                }

                return success;
            },

            toggleZenMode: () => set(state => ({ isZenMode: !state.isZenMode })),

            addToast: (message, type = 'info') => {
                const id = uuidv4();
                set(state => ({ toasts: [...state.toasts, { id, message, type }] }));
                setTimeout(() => {
                    get().removeToast(id);
                }, 3000);
            },

            removeToast: (id) => set(state => ({ toasts: state.toasts.filter(t => t.id !== id) })),

            triggerConfetti: () => {
                set({ showConfetti: true });
                setTimeout(() => set({ showConfetti: false }), 2500);
            },

            updateSettings: (newSettings) => set((state) => ({
                settings: { ...state.settings, ...newSettings }
            })),

            addDebugLog: (type, summary, details) => {
                const state = get();
                if (!state.settings?.debug_mode) return;

                set(state => ({
                    debugLogs: [
                        {
                            id: uuidv4(),
                            timestamp: new Date().toISOString(),
                            type,
                            summary,
                            details: details || {}
                        },
                        ...(state.debugLogs || []).slice(0, 49)
                    ]
                }));
            },

            clearDebugLogs: () => set({ debugLogs: [] }),

            // Flowmate 3.0: Auto-Archive Stale Entities
            autoArchiveStaleEntities: () => {
                const { kernelEntities, addDebugLog } = get();
                const now = Date.now();
                const dayMs = 24 * 60 * 60 * 1000;

                const completedTaskDays = 30;
                const pastEventDays = 60;
                const canceledDays = 14;

                let archivedCount = 0;
                const nextKernelEntities: Record<string, KernelEntity> = { ...kernelEntities };

                for (const [id, entity] of Object.entries(kernelEntities)) {
                    // Skip already archived or deleted
                    if (entity.lifecycle.status === 'archived' || entity.lifecycle.deleted_at !== null) continue;

                    let shouldArchive = false;
                    const updatedAt = new Date(entity.lifecycle.updated_at).getTime();

                    // Completed tasks older than 30 days
                    if (entity.schema_id === 'system/task' && entity.lifecycle.status === 'completed') {
                        if ((now - updatedAt) / dayMs > completedTaskDays) shouldArchive = true;
                    }

                    // Past events older than 60 days
                    if (entity.schema_id === 'system/event') {
                        const eventDateStr = entity.validity?.valid_until || entity.validity?.valid_from || (typeof entity.attributes.end_time === 'string' ? entity.attributes.end_time : undefined) || (typeof entity.attributes.start_time === 'string' ? entity.attributes.start_time : undefined);
                        if (eventDateStr) {
                            const eventTime = new Date(eventDateStr).getTime();
                            if ((now - eventTime) / dayMs > pastEventDays) shouldArchive = true;
                        }
                    }

                    // Canceled entities older than 14 days
                    if (entity.lifecycle.status === 'canceled') {
                        if ((now - updatedAt) / dayMs > canceledDays) shouldArchive = true;
                    }

                    if (shouldArchive) {
                        archivedCount++;
                        nextKernelEntities[id] = {
                            ...entity,
                            attributes: {
                                ...entity.attributes,
                                archived: true,
                            },
                            lifecycle: {
                                ...entity.lifecycle,
                                status: 'archived',
                                updated_at: new Date().toISOString(),
                            },
                        };
                    }
                }

                if (archivedCount > 0) {
                    set({
                        kernelEntities: nextKernelEntities,
                        entities: projectKernelEntitiesToLegacy(nextKernelEntities),
                    });
                    addDebugLog('system', `Auto-archived ${archivedCount} stale entities`);
                }

                return archivedCount;
            },

            importData: (data) => {
                const nextKernelEntities: Record<string, KernelEntity> = {};
                if (data.entities && Array.isArray(data.entities)) {
                    data.entities.forEach(e => {
                        const kernel = upgradeLegacyEntityToKernel(e as unknown as Record<string, unknown>);
                        nextKernelEntities[kernel.id] = kernel;
                    });
                } else if (data.kernelEntities && typeof data.kernelEntities === 'object') {
                    Object.assign(nextKernelEntities, data.kernelEntities);
                }

                set((state) => ({
                    kernelEntities: nextKernelEntities,
                    entities: projectKernelEntitiesToLegacy(nextKernelEntities),
                    relationships: data.relationships || [],
                    messages: data.messages || [],
                    settings: mergeCloudSettings(state.settings, data.settings || {}) as UserSettings,
                    history: [], // Reset history on import
                    historyPointer: -1,
                    universalTags: data.universalTags || [] // Import tags if available
                }));
            },

            addMessage: (role, text, ops, attachment, channelId) => {
                const state = get();
                const effectiveChannelId = channelId || state.activeSessionId || 'general';

                // Block adding messages to soft-deleted chat sessions
                const targetSession = (state.chatSessions || []).find(s => s.id === effectiveChannelId);
                if (targetSession && targetSession.deleted) {
                    console.warn(`[Store] Blocked message insertion into deleted session: ${effectiveChannelId}`);
                    return '';
                }

                // Resolve active branch for this session or create default
                let currentBranches = state.branches || [];
                let activeBranch = currentBranches.find(b => b.id === state.activeBranchId && b.conversation_id === effectiveChannelId && !b.deleted_at);
                if (!activeBranch) {
                    activeBranch = currentBranches.find(b => b.conversation_id === effectiveChannelId && !b.deleted_at);
                }
                if (!activeBranch) {
                    const defaultBranch: ConversationBranch = {
                        id: `b_main_${effectiveChannelId}`,
                        conversation_id: effectiveChannelId,
                        name: 'Main',
                        head_message_id: null,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    currentBranches = [...currentBranches, defaultBranch];
                    activeBranch = defaultBranch;
                }

                const id = uuidv4();
                const parentId = activeBranch.head_message_id || null;
                const newMessage: Message = {
                    id,
                    role,
                    text,
                    channelId: effectiveChannelId,
                    parent_id: parentId,
                    branch_id: activeBranch.id,
                    status: 'completed',
                    attachment: attachment || null,
                    created_at: new Date().toISOString(),
                    ops_preview: ops
                };

                const updatedBranches = currentBranches.map(b =>
                    b.id === activeBranch!.id
                        ? { ...b, head_message_id: id, updated_at: new Date().toISOString() }
                        : b
                );

                let updatedSessions = state.chatSessions || [];
                // Auto-rename session if it's the first user message and session has generic title
                if (role === 'user' && text.trim()) {
                    const session = updatedSessions.find(s => s.id === effectiveChannelId);
                    if (session && (session.title === 'New Chat' || (session.title === 'General Chat' && (state.messages || []).filter(m => (m.channelId || 'general') === effectiveChannelId).length === 0))) {
                        const trimmedTitle = text.trim().slice(0, 36) + (text.trim().length > 36 ? '...' : '');
                        updatedSessions = updatedSessions.map(s =>
                            s.id === effectiveChannelId ? { ...s, title: trimmedTitle, updated_at: new Date().toISOString() } : s
                        );
                    }
                }
                const titleChanged = updatedSessions !== (state.chatSessions || []);

                set((state) => ({
                    messages: [...(state.messages || []), newMessage],
                    chatSessions: updatedSessions,
                    branches: updatedBranches,
                    activeBranchId: activeBranch!.id
                }));

                // Write-through message to Firestore (fire and forget — no debounce)
                if (!get().isDemoMode) {
                    syncMessage(newMessage).catch((err) =>
                        console.warn('[Store] Message sync failed:', err)
                    );
                }

                // If session title was updated from initial prompt, sync sessions to cloud
                if (titleChanged && !get().isDemoMode) {
                    syncChatSessionsToCloud(updatedSessions).catch((err) =>
                        console.warn('[Store] Chat sessions sync failed:', err)
                    );
                }

                return id;
            },

            createChatSession: (title = 'New Chat') => {
                const id = uuidv4();
                const branchId = `b_main_${id}`;
                const now = new Date().toISOString();
                const newSession: ChatSession = {
                    id,
                    title,
                    created_at: now,
                    updated_at: now
                };
                const newBranch: ConversationBranch = {
                    id: branchId,
                    conversation_id: id,
                    name: 'Main',
                    head_message_id: null,
                    created_at: now,
                    updated_at: now
                };
                const updatedSessions = [newSession, ...(get().chatSessions || [])];
                set((state) => ({
                    chatSessions: updatedSessions,
                    branches: [...(state.branches || []), newBranch],
                    activeSessionId: id,
                    activeBranchId: branchId
                }));
                if (!get().isDemoMode) {
                    syncChatSessionsToCloud(updatedSessions).catch(err =>
                        console.warn('[Store] Chat sessions sync failed:', err)
                    );
                }
                return id;
            },

            setActiveSessionId: (id: string) => {
                const state = get();
                const session = state.chatSessions.find(s => s.id === id && isChatSessionActive(s));
                if (!session) return;
                const available = (state.branches || []).filter(b => b.conversation_id === id && !b.deleted_at);
                const remembered = id === state.activeSessionId ? state.activeBranchId : session.active_branch_id;
                const sessionBranch = available.find(b => b.id === remembered) || available[0];
                set({
                    activeSessionId: id,
                    chatSessions: state.chatSessions.map(s => s.id === state.activeSessionId ? { ...s, active_branch_id: state.activeBranchId } : s),
                    activeBranchId: sessionBranch?.id || `b_main_${id}`
                });
            },

            toggleDeveloperMode: () => set(state => ({ developerModeEnabled: !state.developerModeEnabled })),

            setUnsentDraft: (branchId: string, text: string) => {
                set(state => {
                    const existingDraft = state.unsentDrafts?.[branchId];
                    const nextDraft: ConversationDraft = {
                        ...existingDraft,
                        text,
                        base_revision: existingDraft ? existingDraft.current_revision : 0,
                        current_revision: (existingDraft ? existingDraft.current_revision : 0) + 1,
                        client_id: state.currentUser?.uid || 'local',
                        updated_at: new Date().toISOString(),
                        conflict_draft: existingDraft?.conflict_draft || null
                    };
                    return {
                        unsentDrafts: {
                            ...(state.unsentDrafts || {}),
                            [branchId]: nextDraft
                        }
                    };
                });
            },

            getUnsentDraft: (branchId: string) => {
                const state = get();
                return state.unsentDrafts?.[branchId]?.text || '';
            },

            setDraftAttachment: (branchId: string, attachment: string | null) => {
                get().setUnsentDraft(branchId, get().getUnsentDraft(branchId));
                set(state => ({ unsentDrafts: { ...state.unsentDrafts, [branchId]: { ...state.unsentDrafts[branchId], attachment } } }));
            },

            updateMessageText: (id: string, text: string) => {
                set(state => ({
                    messages: (state.messages || []).map(m => m.id === id ? { ...m, text } : m)
                }));
            },

            updateMessageTurnMetadata: (id: string, metadata: Partial<NonNullable<Message['turn_metadata']>>) => {
                set(state => ({
                    messages: (state.messages || []).map(m => m.id === id ? {
                        ...m,
                        turn_metadata: { ...(m.turn_metadata || {}), ...metadata }
                    } : m)
                }));
            },

            createBranch: (name: string, forkMessageId?: string, channelId?: string) => {
                const state = get();
                const effectiveChannelId = channelId || state.activeSessionId || 'general';
                const branchId = `b_${uuidv4().slice(0, 8)}`;
                const newBranch: ConversationBranch = {
                    id: branchId,
                    conversation_id: effectiveChannelId,
                    name,
                    diverged_from_branch_id: state.activeBranchId,
                    diverged_from_message_id: forkMessageId || null,
                    head_message_id: forkMessageId || null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                set(state => ({
                    branches: [...(state.branches || []), newBranch],
                    activeBranchId: branchId
                }));
                return branchId;
            },

            setActiveBranchId: (branchId: string) => {
                const state = get();
                const branch = state.branches.find(b => b.id === branchId && !b.deleted_at);
                if (!branch || !state.chatSessions.some(s => s.id === branch.conversation_id && isChatSessionActive(s))) return;
                set({ activeBranchId: branchId, activeSessionId: branch.conversation_id,
                    chatSessions: state.chatSessions.map(s => s.id === branch.conversation_id ? { ...s, active_branch_id: branchId } : s) });
            },

            renameBranch: (branchId: string, newName: string) => {
                const name = newName.trim().slice(0, 80);
                if (!name) return;
                const branch = get().branches.find(b => b.id === branchId && !b.deleted_at);
                if (!branch) return;
                const updatedAt = new Date().toISOString();
                set(state => ({
                    branches: state.branches.map(b => b.id === branchId ? { ...b, name, updated_at: updatedAt } : b)
                }));
            },

            deleteBranch: (branchId: string) => {
                const state = get();
                const branch = state.branches.find(b => b.id === branchId && !b.deleted_at);
                if (!branch || !branch.diverged_from_branch_id) return; // Main history is never removed here.
                if ((state.branchQueues[branchId] || []).some(q => q.status === 'queued' || q.status === 'leased' || q.status === 'needs_action')) return;
                const fallback = state.branches.find(b => b.id === branch.diverged_from_branch_id && !b.deleted_at)
                    || state.branches.find(b => b.conversation_id === branch.conversation_id && b.id !== branchId && !b.deleted_at);
                if (!fallback) return;
                const now = new Date().toISOString();
                set({ branches: state.branches.map(b => b.id === branchId ? { ...b, deleted_at: now, updated_at: now } : b) });
                if (state.activeBranchId === branchId) get().setActiveBranchId(fallback.id);
            },

            restoreBranch: (branchId: string) => {
                const branch = get().branches.find(b => b.id === branchId && b.deleted_at);
                if (!branch || !get().chatSessions.some(s => s.id === branch.conversation_id && isChatSessionActive(s))) return;
                set(state => ({ branches: state.branches.map(b => b.id === branchId ? { ...b, deleted_at: null, updated_at: new Date().toISOString() } : b) }));
                get().setActiveBranchId(branchId);
            },

            editAndBranchMessage: (messageId: string, newText: string) => {
                const state = get();
                const original = (state.messages || []).find(m => m.id === messageId);
                if (!original) return '';

                const effectiveChannelId = original.channelId || state.activeSessionId || 'general';
                const parentId = original.parent_id || null;
                const newBranchId = `b_fork_${parentId || 'root'}_${uuidv4().slice(0, 8)}`;
                const branchCount = (state.branches || []).filter(b => b.conversation_id === effectiveChannelId).length;
                const branchName = `Branch ${branchCount + 1}`;

                const newMsgId = uuidv4();
                const editedMessage: Message = {
                    id: newMsgId,
                    role: 'user',
                    text: newText,
                    parent_id: parentId,
                    branch_id: newBranchId,
                    channelId: effectiveChannelId,
                    status: 'completed',
                    created_at: new Date().toISOString()
                };

                const newBranch: ConversationBranch = {
                    id: newBranchId,
                    conversation_id: effectiveChannelId,
                    diverged_from_branch_id: original.branch_id || state.activeBranchId,
                    diverged_from_message_id: parentId || undefined,
                    name: branchName,
                    head_message_id: newMsgId,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                set(state => ({
                    messages: [...(state.messages || []), editedMessage],
                    branches: [...(state.branches || []), newBranch],
                    activeBranchId: newBranchId
                }));

                if (!get().isDemoMode) {
                    syncMessage(editedMessage).catch(err =>
                        console.warn('[Store] Sync edited message failed:', err)
                    );
                }

                return newMsgId;
            },

            switchSiblingVersion: (targetMessageId: string) => {
                const state = get();
                const target = (state.messages || []).find(m => m.id === targetMessageId);
                if (!target) return;

                const effectiveChannelId = target.channelId || state.activeSessionId || 'general';

                let matchingBranch = (state.branches || []).find(b => b.id === target.branch_id);
                if (!matchingBranch) {
                    matchingBranch = (state.branches || []).find(b => {
                        if (b.conversation_id !== effectiveChannelId) return false;
                        const hist = resolveBranchHistory(state.messages || [], b.head_message_id, effectiveChannelId);
                        return hist.some(m => m.id === targetMessageId);
                    });
                }

                if (matchingBranch) {
                    set({ activeBranchId: matchingBranch.id });
                } else {
                    const leaf = findLeafMessage(state.messages || [], targetMessageId);
                    const newBranchId = `b_${uuidv4().slice(0, 8)}`;
                    const newBranch: ConversationBranch = {
                        id: newBranchId,
                        conversation_id: effectiveChannelId,
                        name: `Branch ${(state.branches || []).length + 1}`,
                        head_message_id: leaf.id,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    set(state => ({
                        branches: [...(state.branches || []), newBranch],
                        activeBranchId: newBranchId
                    }));
                }
            },

            enqueueUserMessage: (text: string, branchId?: string, channelId?: string) => {
                const state = get();
                const effectiveChannelId = channelId || state.activeSessionId || 'general';
                const effectiveBranchId = branchId || state.activeBranchId || `b_main_${effectiveChannelId}`;

                const userMsgId = uuidv4();
                const currentBranch = (state.branches || []).find(b => b.id === effectiveBranchId);
                const parentId = currentBranch?.head_message_id || null;

                const userMsg: Message = {
                    id: userMsgId,
                    role: 'user',
                    text,
                    channelId: effectiveChannelId,
                    parent_id: parentId,
                    branch_id: effectiveBranchId,
                    status: 'queued',
                    created_at: new Date().toISOString()
                };

                const queueItem: BranchQueueItem = {
                    id: uuidv4(),
                    branch_id: effectiveBranchId,
                    owner_uid: state.currentUser?.uid ?? 'local',
                    user_message: userMsg,
                    status: 'queued',
                    enqueued_at: Date.now()
                };

                const currentQueue = state.branchQueues[effectiveBranchId] || [];

                set(state => ({
                    branchQueues: {
                        ...state.branchQueues,
                        [effectiveBranchId]: [...currentQueue, queueItem]
                    }
                }));

                return queueItem;
            },

            cancelQueuedItem: (itemId: string, branchId: string) => {
                set(state => {
                    const currentQueue = state.branchQueues[branchId] || [];
                    return {
                        branchQueues: {
                            ...state.branchQueues,
                            [branchId]: currentQueue.filter(item => item.id !== itemId)
                        }
                    };
                });
            },

            setIsStreaming: (isStreaming: boolean, messageId?: string | null) => {
                set({
                    isStreaming,
                    streamingMessageId: isStreaming ? (messageId || null) : null
                });
            },

            setLastTurnDiagnostics: (metrics: DeveloperDiagnostics['lastTurnMetrics']) => {
                set({ lastTurnDiagnostics: metrics });
            },

            registerTurnExecutor: (executor: TurnExecutor | null) => {
                registeredTurnExecutor = executor;
            },

            forkBranch: (messageId: string, name?: string) => {
                const state = get();
                const original = (state.messages || []).find(m => m.id === messageId);
                if (!original) return '';

                const effectiveChannelId = original.channelId || state.activeSessionId || 'general';
                const parentId = original.id;
                const newBranchId = `b_fork_${parentId || 'root'}_${uuidv4().slice(0, 8)}`;
                const branchCount = (state.branches || []).filter(b => b.conversation_id === effectiveChannelId).length;
                const branchName = name || `Branch ${branchCount + 1}`;

                const newBranch: ConversationBranch = {
                    id: newBranchId,
                    conversation_id: effectiveChannelId,
                    diverged_from_branch_id: original.branch_id || state.activeBranchId,
                    diverged_from_message_id: parentId || undefined,
                    name: branchName,
                    head_message_id: parentId,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                set(state => ({
                    branches: [...(state.branches || []), newBranch],
                    activeSessionId: effectiveChannelId,
                    chatSessions: state.chatSessions.map(s => s.id === effectiveChannelId ? { ...s, active_branch_id: newBranchId } : s),
                    activeBranchId: newBranchId
                }));

                return newBranchId;
            },

            forkAndSendMessage: async (messageId: string, newText: string, options?: { submissionId?: string; simulatedFailure?: boolean }) => {
                const state = get();
                const trimmed = newText.trim();
                if (!trimmed) return null;

                const dedupeKey = options?.submissionId || `${messageId}_${trimmed}`;
                if (inFlightSubmissions.has(dedupeKey)) {
                    console.warn(`[Store] Duplicate turn submission blocked for key: ${dedupeKey}`);
                    return null;
                }
                inFlightSubmissions.add(dedupeKey);

                try {
                    const original = (state.messages || []).find(m => m.id === messageId);
                    if (!original) return null;

                    const effectiveChannelId = original.channelId || state.activeSessionId || 'general';
                    const parentId = original.parent_id || null;
                    const newBranchId = `b_fork_${parentId || 'root'}_${uuidv4().slice(0, 8)}`;
                    const branchCount = (state.branches || []).filter(b => b.conversation_id === effectiveChannelId).length;
                    const branchName = `Branch ${branchCount + 1}`;

                    const userMsgId = options?.submissionId || uuidv4();

                    // Durable message identity: check if message already exists
                    let userMsg = (state.messages || []).find(m => m.id === userMsgId);
                    const isExisting = !!userMsg;

                    if (!userMsg) {
                        userMsg = {
                            id: userMsgId,
                            role: 'user',
                            text: trimmed,
                            parent_id: parentId,
                            branch_id: newBranchId,
                            channelId: effectiveChannelId,
                            status: options?.simulatedFailure ? 'failed' : 'queued',
                            created_at: new Date().toISOString()
                        };
                    } else {
                        userMsg = {
                            ...userMsg,
                            text: trimmed,
                            branch_id: userMsg.branch_id || newBranchId,
                            status: options?.simulatedFailure ? 'failed' : 'queued'
                        };
                    }

                    const newBranch: ConversationBranch = {
                        id: newBranchId,
                        conversation_id: effectiveChannelId,
                        diverged_from_branch_id: original.branch_id || state.activeBranchId,
                        diverged_from_message_id: parentId || undefined,
                        name: branchName,
                        head_message_id: userMsgId,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };

                    const updatedMessages = isExisting
                        ? (state.messages || []).map(m => m.id === userMsgId ? userMsg! : m)
                        : [...(state.messages || []), userMsg];

                    set(state => ({
                        messages: updatedMessages,
                        branches: [...(state.branches || []), newBranch],
                        activeBranchId: newBranchId
                    }));

                    if (!get().isDemoMode) {
                        syncMessage(userMsg).catch(err =>
                            console.warn('[Store] Sync forked user message failed:', err)
                        );
                    }

                    // If simulated failure (e.g. testing failed queue admission / offline retry)
                    if (options?.simulatedFailure) {
                        console.warn('[Store] Simulated queue admission failure for message:', userMsgId);
                        return null;
                    }

                    // Enqueue the user message on the new branch
                    const queueItem: BranchQueueItem = {
                        id: uuidv4(),
                        branch_id: newBranchId,
                        owner_uid: get().currentUser?.uid ?? 'local',
                        user_message: userMsg,
                        status: 'queued',
                        enqueued_at: Date.now()
                    };

                    const currentQueue = get().branchQueues[newBranchId] || [];
                    set(state => ({
                        branchQueues: {
                            ...state.branchQueues,
                            [newBranchId]: [...currentQueue, queueItem]
                        }
                    }));

                    // Execute queue processing on the new branch
                    await get().processBranchQueue(newBranchId);

                    // Find generated assistant message (if created)
                    const latestState = get();
                    const assistantMsg = (latestState.messages || []).find(
                        m => m.branch_id === newBranchId && m.parent_id === userMsgId && m.role === 'assistant'
                    );

                    return {
                        branchId: newBranchId,
                        userMessageId: userMsgId,
                        assistantMessageId: assistantMsg?.id,
                        queueItemId: queueItem.id
                    };
                } finally {
                    inFlightSubmissions.delete(dedupeKey);
                }
            },

            retryQueuedUserMessage: async (userMessageId: string) => {
                const state = get();
                const existingMsg = (state.messages || []).find(m => m.id === userMessageId);
                if (!existingMsg) return false;

                const branchId = existingMsg.branch_id || state.activeBranchId;
                const activeRetry = (state.branchQueues[branchId] || []).some(item => item.user_message.id === userMessageId
                    && (item.status === 'queued' || item.status === 'leased'));
                if (activeRetry) {
                    await get().processBranchQueue(branchId);
                    return true;
                }

                // Update existing message status to 'queued' without creating a duplicate
                set(state => ({
                    messages: (state.messages || []).map(m =>
                        m.id === userMessageId ? { ...m, status: 'queued' } : m
                    )
                }));

                const queueItem: BranchQueueItem = {
                    id: uuidv4(),
                    branch_id: branchId,
                    owner_uid: state.currentUser?.uid ?? 'local',
                    user_message: { ...existingMsg, status: 'queued' },
                    status: 'queued',
                    enqueued_at: Date.now()
                };

                const currentQueue = get().branchQueues[branchId] || [];
                set(state => ({
                    branchQueues: {
                        ...state.branchQueues,
                        [branchId]: [...currentQueue, queueItem]
                    }
                }));

                await get().processBranchQueue(branchId);
                return true;
            },

            processBranchQueue: async (branchId: string) => {
                const state = get();
                const currentLease = state.activeLease;
                const now = Date.now();

                // Fencing check: If an active lease is holding this branch and not expired, wait
                if (currentLease && currentLease.branch_id === branchId) {
                    const expiresAt = new Date(currentLease.expires_at).getTime();
                    if (now < expiresAt) {
                        return; // Active lease fencing prevents concurrent turns
                    }
                }

                const queue = state.branchQueues[branchId] || [];
                const staleLeases = queue.filter(item => item.status === 'leased'
                    && (!item.lease_expires_at || Number(item.lease_expires_at) <= now));
                if (staleLeases.length) {
                    const staleIds = new Set(staleLeases.map(item => item.id));
                    const staleUserIds = new Set(staleLeases.map(item => item.user_message.id));
                    set(current => ({
                        branchQueues: {
                            ...current.branchQueues,
                            [branchId]: (current.branchQueues[branchId] || []).map(item => staleIds.has(item.id)
                                ? { ...item, status: 'needs_action' as const, lease_token: undefined, error: 'The previous attempt ended before Flowmate could confirm its result. Review the conversation, then retry if you still want to send it.' }
                                : item),
                        },
                        messages: current.messages.map(message => {
                            if (staleUserIds.has(message.id)) return { ...message, status: 'interrupted' as const };
                            const parentWasLeased = staleLeases.some(item => item.user_message.id === message.parent_id);
                            return parentWasLeased && message.role === 'assistant' && message.status === 'streaming'
                                ? { ...message, status: 'interrupted' as const }
                                : message;
                        }),
                        activeLease: current.activeLease?.branch_id === branchId ? null : current.activeLease,
                        isStreaming: current.activeLease?.branch_id === branchId ? false : current.isStreaming,
                        streamingMessageId: current.activeLease?.branch_id === branchId ? null : current.streamingMessageId,
                    }));
                }

                const processingOwnerUid = state.currentUser?.uid ?? 'local';

                // A queued message must never cross an account boundary during
                // auth hydration or account switching. Legacy queue records have
                // no owner_uid and therefore require an explicit retry as well.
                const foreignQueuedItems = (get().branchQueues[branchId] || []).filter(item =>
                    item.status === 'queued' && item.owner_uid !== processingOwnerUid
                );
                if (foreignQueuedItems.length) {
                    const foreignIds = new Set(foreignQueuedItems.map(item => item.id));
                    const foreignMessageIds = new Set(foreignQueuedItems.map(item => item.user_message.id));
                    set(current => ({
                        branchQueues: {
                            ...current.branchQueues,
                            [branchId]: (current.branchQueues[branchId] || []).map(item => foreignIds.has(item.id)
                                ? { ...item, status: 'needs_action' as const, error: 'This message was queued under a different or unknown account. Review it, then retry explicitly to send it with the current account.' }
                                : item),
                        },
                        messages: current.messages.map(message => foreignMessageIds.has(message.id)
                            ? { ...message, status: 'interrupted' as const }
                            : message),
                    }));
                }

                // Never replay an expired lease automatically: the provider may
                // have completed before a tab closed or lost its response.
                const nextItem = (get().branchQueues[branchId] || []).find(item =>
                    item.status === 'queued' && item.owner_uid === processingOwnerUid
                );
                if (!nextItem) return;

                const leaseToken = uuidv4();
                const fenceToken = now;
                const leaseExpiresAt = new Date(now + 310_000).toISOString();

                const lease: BranchExecutionLease = {
                    branch_id: branchId,
                    active_turn_id: nextItem.id,
                    leased_by: 'client_ui',
                    fence_token: fenceToken,
                    leased_at: new Date(now).toISOString(),
                    expires_at: leaseExpiresAt
                };

                // Create assistant placeholder message on this branch
                const assistantMsgId = uuidv4();
                const assistantMsg: Message = {
                    id: assistantMsgId,
                    role: 'assistant',
                    text: '',
                    channelId: nextItem.user_message.channelId || state.activeSessionId || 'general',
                    parent_id: nextItem.user_message.id,
                    branch_id: branchId,
                    status: 'streaming',
                    created_at: new Date().toISOString()
                };

                // Update state: mark user message running, add assistant message, update branch head, lease active
                set(state => {
                    const updatedBranches = (state.branches || []).map(b =>
                        b.id === branchId
                            ? { ...b, head_message_id: assistantMsgId, updated_at: new Date().toISOString() }
                            : b
                    );

                    const updatedQueue = (state.branchQueues[branchId] || []).map(q =>
                        q.id === nextItem.id ? { ...q, status: 'leased' as const, lease_token: leaseToken, fence_token: fenceToken, lease_expires_at: now + 310_000 } : q
                    );

                    return {
                        messages: [
                            ...(state.messages || []).map(m => m.id === nextItem.user_message.id ? { ...m, status: 'in_flight' as const } : m),
                            assistantMsg
                        ],
                        branches: updatedBranches,
                        branchQueues: {
                            ...state.branchQueues,
                            [branchId]: updatedQueue
                        },
                        activeLease: lease,
                        isStreaming: true,
                        streamingMessageId: assistantMsgId
                    };
                });

                const placeholderSync = !get().isDemoMode
                    ? syncMessage(assistantMsg).catch(err => {
                        console.warn('[Store] Sync assistant placeholder failed:', err);
                        return false;
                    })
                    : Promise.resolve(false);

                try {
                    if (registeredTurnExecutor) {
                        await registeredTurnExecutor({
                            branchId,
                            channelId: nextItem.user_message.channelId || state.activeSessionId || 'general',
                            userMessage: nextItem.user_message,
                            assistantMessageId: assistantMsgId,
                            onChunk: (chunk) => {
                                // Real-time token streaming handled in executor
                            }
                        });
                    } else {
                        // Fallback response simulation for tests/headless
                        const defaultReply = `Response for: ${nextItem.user_message.text}`;
                        get().updateMessageText(assistantMsgId, defaultReply);
                    }

                    // Complete turn
                    set(state => {
                        const updatedQueue = (state.branchQueues[branchId] || []).map(q =>
                            q.id === nextItem.id ? { ...q, status: 'completed' as const } : q
                        );
                        return {
                            messages: (state.messages || []).map(m =>
                                m.id === assistantMsgId || m.id === nextItem.user_message.id ? { ...m, status: 'completed' as const } : m
                            ),
                            branchQueues: {
                                ...state.branchQueues,
                                [branchId]: updatedQueue
                            },
                            activeLease: null,
                            isStreaming: false,
                            streamingMessageId: null
                        };
                    });

                    // The initial empty placeholder is written before generation. Wait for
                    // that write, then persist the completed response so a remote snapshot
                    // cannot replace the visible answer with the empty placeholder.
                    if (!get().isDemoMode) {
                        await placeholderSync;
                        const completedAssistantMsg = get().messages.find(message => message.id === assistantMsgId);
                        if (completedAssistantMsg) {
                            await syncMessage(completedAssistantMsg).catch(err => {
                                console.warn('[Store] Sync completed assistant message failed:', err);
                            });
                        }
                    }
                } catch (err: any) {
                    console.error('[Store] Turn execution failed on branch:', branchId, err);
                    set(state => {
                        const isAbort = err?.name === 'AbortError';
                        const updatedQueue = (state.branchQueues[branchId] || []).map(q =>
                            q.id === nextItem.id ? {
                                ...q,
                                status: isAbort ? ('needs_action' as const) : ('failed' as const),
                                error: isAbort ? 'The request was interrupted before completion. Review its status before retrying.' : String(err?.message || 'The request failed.'),
                            } : q
                        );
                        return {
                            messages: (state.messages || []).map(m => {
                                if (m.id === assistantMsgId) {
                                    return { ...m, status: isAbort ? 'interrupted' as const : 'failed' as const };
                                }
                                if (m.id === nextItem.user_message.id) {
                                    return { ...m, status: isAbort ? 'interrupted' as const : 'failed' as const };
                                }
                                return m;
                            }),
                            branchQueues: {
                                ...state.branchQueues,
                                [branchId]: updatedQueue
                            },
                            activeLease: null,
                            isStreaming: false,
                            streamingMessageId: null
                        };
                    });
                }

                // Check if more queued items remain on this branch
                const remainingState = get();
                const remainingQueued = (remainingState.branchQueues[branchId] || []).some(q => q.status === 'queued');
                if (remainingQueued) {
                    await get().processBranchQueue(branchId);
                }
            },

            deleteChatSession: (id: string) => {
                const state = get();
                const now = new Date().toISOString();
                // Tombstone the session to prevent resurrection during sync or refresh
                const updatedSessions = (state.chatSessions || []).map(s =>
                    s.id === id ? { ...s, deleted: true, deleted_at: now, updated_at: now } : s
                );
                // Ensure the tombstone exists even if session was not in array
                const hasSession = updatedSessions.some(s => s.id === id);
                const allSessions = hasSession ? updatedSessions : [...updatedSessions, {
                    id,
                    title: 'Deleted Chat',
                    created_at: now,
                    updated_at: now,
                    deleted: true,
                    deleted_at: now
                }];

                const activeSessions = allSessions.filter(isChatSessionActive);
                let finalSessions = allSessions;
                let nextActive = state.activeSessionId;

                if (activeSessions.length === 0) {
                    const fallbackSession: ChatSession = {
                        id: 'general',
                        title: 'General Chat',
                        created_at: now,
                        updated_at: now
                    };
                    const hasGeneral = allSessions.some(s => s.id === 'general');
                    if (hasGeneral) {
                        finalSessions = allSessions.map(s => s.id === 'general' ? fallbackSession : s);
                    } else {
                        finalSessions = [...allSessions, fallbackSession];
                    }
                    nextActive = 'general';
                } else if (state.activeSessionId === id) {
                    nextActive = activeSessions[0].id;
                }

                const remainingMessages = (state.messages || []).filter(m => (m.channelId || 'general') !== id);
                set({
                    chatSessions: finalSessions,
                    activeSessionId: nextActive,
                    messages: remainingMessages
                });

                if (!get().isDemoMode) {
                    syncChatSessionsToCloud(finalSessions).catch(err =>
                        console.warn('[Store] Chat sessions sync failed:', err)
                    );

                    deleteChannelMessagesFromCloud(id).catch(err =>
                        console.warn('[Store] Cloud messages deletion failed for channel:', id, err)
                    );
                }
            },

            renameChatSession: (id: string, newTitle: string) => {
                const state = get();
                const updatedSessions = (state.chatSessions || []).map(s =>
                    s.id === id ? { ...s, title: newTitle.trim() || s.title, updated_at: new Date().toISOString() } : s
                );
                set({ chatSessions: updatedSessions });
                if (!get().isDemoMode) {
                    syncChatSessionsToCloud(updatedSessions).catch(err =>
                        console.warn('[Store] Chat sessions sync failed:', err)
                    );
                }
            },

            clearChatSession: (id: string) => {
                set((state) => ({
                    messages: (state.messages || []).filter(m => (m.channelId || 'general') !== id)
                }));
                if (!get().isDemoMode) {
                    deleteChannelMessagesFromCloud(id).catch(err =>
                        console.warn('[Store] Cloud messages deletion failed for channel:', id, err)
                    );
                }
            },

            setPendingOps: (ops, messageId) => {
                set({ pendingOps: { ops, originalMessageId: messageId, reviewId: uuidv4() } });
            },

            clearPendingOps: () => {
                set({ pendingOps: null });
            },

            startFocusSession: (entityId, durationMinutes = 25) => {
                set({
                    focusSession: {
                        entityId,
                        startTime: new Date().toISOString(),
                        durationMinutes,
                        status: 'active'
                    }
                });
            },

            endFocusSession: () => {
                set({ focusSession: null });
            },

            refreshDailyBriefing: async () => {
                const { entities, relationships } = get();
                const today = new Date().toISOString().split('T')[0];

                try {
                    const briefing = await generateBriefing({ entities, relationships });
                    set({
                        dailyBriefing: {
                            content: briefing.content,
                            source: briefing.source,
                            timestamp: new Date().toISOString(),
                            generated_for_date: today
                        }
                    });
                    return null;
                } catch (err) {
                    console.error("Failed to generate briefing", err);
                    return (err as { code?: string })?.code || 'GENERATION_FAILED';
                }
            },

            getSnapshot: () => {
                const { entities, relationships } = get();
                return { entities: getActiveEntities(entities), relationships: relationships || [] };
            },

            getActiveEntities: () => {
                return getActiveEntities(get().entities);
            },

            findEntityByTitle: (title) => {
                if (!title) return undefined;
                return getActiveEntities(get().entities).find(e => (e.title || '').toLowerCase() === title.toLowerCase());
            },

            getXP: () => {
                const { entities } = get();
                let xp = 0;
                getActiveEntities(entities).forEach(e => {
                    if (e.status === EntityStatus.COMPLETED) {
                        if (e.kind === EntityKind.PROJECT) xp += 100;
                        else if (e.kind === EntityKind.GOAL) xp += 200;
                        else if (e.kind === EntityKind.TASK) xp += 20;
                        else if (e.kind === EntityKind.ACTIVITY) xp += 10;
                        else xp += 5;
                    }
                });
                return xp;
            },

            undo: () => {
                const { history, historyPointer, addToast } = get();
                if (historyPointer > 0) {
                    const newPointer = historyPointer - 1;
                    const snapshot = history[newPointer];
                    const restoredKernel = snapshot.kernelEntities || {};
                    set({
                        kernelEntities: restoredKernel,
                        entities: snapshot.entities,
                        relationships: snapshot.relationships,
                        historyPointer: newPointer
                    });
                    addToast("Undone last action", "info");
                }
            },

            redo: () => {
                const { history, historyPointer, addToast } = get();
                if (historyPointer < history.length - 1) {
                    const newPointer = historyPointer + 1;
                    const snapshot = history[newPointer];
                    const restoredKernel = snapshot.kernelEntities || {};
                    set({
                        kernelEntities: restoredKernel,
                        entities: snapshot.entities,
                        relationships: snapshot.relationships,
                        historyPointer: newPointer
                    });
                    addToast("Redone last action", "info");
                }
            },

            canUndo: () => {
                return get().historyPointer > 0;
            },

            canRedo: () => {
                const { history, historyPointer } = get();
                return historyPointer < history.length - 1;
            },

            processSyncQueue: async () => {
                const { syncQueue, settings, entities, addDebugLog, isDemoMode } = get();
                if (isDemoMode || !settings.sync_enabled || syncQueue.length === 0) return;

                const pending = syncQueue.filter(i => i.status === 'pending');
                if (pending.length === 0) return;

                set(state => ({
                    syncQueue: state.syncQueue.map(i =>
                        pending.find(p => p.id === i.id) ? { ...i, status: 'in_progress' } : i
                    )
                }));

                for (const item of pending) {
                    try {
                        // Skip non-EVENT entities
                        if (item.op.type !== 'create_entity' || item.op.payload.kind !== 'EVENT') {
                            set(state => ({
                                syncQueue: state.syncQueue.map(i =>
                                    i.id === item.id ? { ...i, status: 'done' } : i
                                )
                            }));
                            continue;
                        }

                        // Create a mock entity for the sync call
                        const mockEntity = entities.find(e => e.title === item.op.payload.title) || {
                            id: item.op.payload.id || '',
                            title: item.op.payload.title,
                            kind: 'EVENT',
                            start_time: item.op.payload.start_time,
                            end_time: item.op.payload.end_time,
                            description: item.op.payload.description
                        } as any;
                        const result = await GoogleCalendarAdapter.createEvent(mockEntity, settings);

                        if (result.success) {
                            addDebugLog('sync', `Synced ${item.op.type}`, { externalId: result.externalId });
                            set(state => ({
                                syncQueue: state.syncQueue.map(i =>
                                    i.id === item.id ? { ...i, status: 'done' } : i
                                )
                            }));
                        } else {
                            throw new Error(result.error || "Unknown sync error");
                        }
                    } catch (err) {
                        console.error("Sync failed for item", item.id, err);
                        addDebugLog('sync', `Sync failed: ${item.op.type}`, { error: String(err) });
                        set(state => ({
                            syncQueue: state.syncQueue.map(i =>
                                i.id === item.id ? { ...i, status: 'failed', attempts: i.attempts + 1 } : i
                            )
                        }));
                    }
                }
            },

            applyOperations: (ops) => {
                const { addDebugLog, addToast, triggerConfetti } = get();

                // Validate and filter operations before applying
                const { validOps, invalidOps } = validateOperations(ops);
                if (validOps.length === 0 && ops.length > 0) {
                    addDebugLog('error', 'All operations were invalid', { originalCount: ops.length, errors: invalidOps });
                    addToast('Invalid operations received - no changes applied', 'warning');
                    return;
                }
                if (validOps.length < ops.length) {
                    addDebugLog('warning', `Filtered ${invalidOps.length} invalid operations`, {
                        original: ops.length,
                        valid: validOps.length,
                        errors: invalidOps
                    });
                }

                set((state) => {
                    // Ensure pre-mutation baseline exists at history[0] if history is empty
                    const newHistory = state.history.slice(0, state.historyPointer + 1);
                    if (newHistory.length === 0) {
                        newHistory.push({
                            entities: state.entities,
                            relationships: state.relationships,
                            kernelEntities: state.kernelEntities,
                            timestamp: Date.now()
                        });
                    }

                    // Canonical Kernel Entities Dictionary (sole mutable canonical state)
                    const nextKernelEntities: Record<string, KernelEntity> = { ...(state.kernelEntities || {}) };

                    // Defensive backfill if store had legacy entities but kernelEntities was not yet populated
                    if (Object.keys(nextKernelEntities).length === 0 && (state.entities || []).length > 0) {
                        for (const e of state.entities) {
                            nextKernelEntities[e.id] = upgradeLegacyEntityToKernel(e as unknown as Record<string, unknown>);
                        }
                    }

                    let newEntities = [...(state.entities || [])];
                    let newRelationships = [...(state.relationships || [])];
                    let newUniversalTags = [...(state.universalTags || [])];
                    let newFoodLogs: FoodLogEntry[] | null = null;

                    const sideEffectOps: ToonOperation[] = [];

                    validOps.forEach(op => {
                        try {
                            // Expand short operation types (c→create_entity, u→update_entity, etc.)
                            const type = expandOperationType(op.type);
                            const payload = normalizePayload(type, op.payload);
                            const now = new Date().toISOString();

                            switch (type) {
                                case 'create_entity': {
                                    if (!payload.title) {
                                        throw new Error("Missing title for create_entity");
                                    }

                                    // Resolve parent_id from parent shorthand
                                    const parentRef = payload.parent_id || payload.parent_temp || payload.parent;
                                    const resolvedParentId = parentRef ? resolveEntityId(parentRef, newEntities) : null;

                                    const entity: Entity = {
                                        id: payload.id || uuidv4(),
                                        kind: payload.kind || EntityKind.TASK,
                                        title: payload.title || 'Untitled',
                                        description: payload.description || null,
                                        status: EntityStatus.ACTIVE,
                                        priority: payload.priority || 1,
                                        start_time: payload.start_time || null,
                                        end_time: payload.end_time || null,
                                        deadline: payload.deadline || null,
                                        duration_minutes: payload.duration_minutes || null,
                                        recurrence: payload.recurrence || null,
                                        metadata: payload.metadata || {},
                                        created_at: now,
                                        updated_at: now,
                                        canonical_tags: Array.isArray(payload.canonical_tags) ? payload.canonical_tags : (Array.isArray(payload.tags) ? payload.tags : []),
                                        parent_id: resolvedParentId  // New: direct parent reference
                                    };
                                    newEntities.push(entity);
                                    const rawPayload = (op.payload && typeof op.payload === 'object' ? op.payload : {}) as Record<string, unknown>;
                                    const kernelInput: Record<string, unknown> = {
                                        ...entity,
                                        ...rawPayload,
                                        attributes: {
                                            ...(typeof rawPayload.attributes === 'object' && rawPayload.attributes !== null && !Array.isArray(rawPayload.attributes) ? rawPayload.attributes as Record<string, unknown> : {}),
                                            ...entity.metadata,
                                        },
                                        schema_id: typeof rawPayload.schema_id === 'string' && rawPayload.schema_id
                                            ? rawPayload.schema_id
                                            : mapLegacyKindToSchemaId(entity.kind),
                                        lifecycle: typeof rawPayload.lifecycle === 'object' && rawPayload.lifecycle !== null ? rawPayload.lifecycle : undefined,
                                        provenance: typeof rawPayload.provenance === 'object' && rawPayload.provenance !== null ? rawPayload.provenance : undefined,
                                        capabilities: Array.isArray(rawPayload.capabilities) ? rawPayload.capabilities : undefined,
                                    };
                                    nextKernelEntities[entity.id] = upgradeLegacyEntityToKernel(kernelInput);

                                    // Universal Tag Sync: If entity is TAG or CONTEXT, add to universal list
                                    if (entity.kind === EntityKind.TAG || entity.kind === EntityKind.CONTEXT) {
                                        const existingTag = newUniversalTags.find(t => t.id === entity.id || t.title.toLowerCase() === entity.title.toLowerCase());
                                        if (!existingTag) {
                                            newUniversalTags.push({
                                                id: entity.id,
                                                title: entity.title,
                                                kind: entity.kind,
                                                usage_count: 0
                                            });
                                        }
                                    }

                                    // Google Calendar Sync: If entity is EVENT, sync to Google Calendar (blocked in demo mode)
                                    const storeSettings = get().settings;
                                    if (entity.kind === EntityKind.EVENT && storeSettings.sync_enabled && !get().isDemoMode) {
                                        GoogleCalendarAdapter.createEvent(entity, storeSettings).then(result => {
                                            if (result.success && result.externalId) {
                                                // Store external ID in metadata for future updates
                                                set(state => {
                                                    const target = state.kernelEntities[entity.id];
                                                    if (!target) return {};
                                                    const updatedKernel: KernelEntity = {
                                                        ...target,
                                                        attributes: {
                                                            ...target.attributes,
                                                            gcal_id: result.externalId,
                                                        },
                                                        lifecycle: {
                                                            ...target.lifecycle,
                                                            updated_at: new Date().toISOString(),
                                                        },
                                                    };
                                                    const nextK = {
                                                        ...state.kernelEntities,
                                                        [entity.id]: updatedKernel,
                                                    };
                                                    return {
                                                        kernelEntities: nextK,
                                                        entities: projectKernelEntitiesToLegacy(nextK),
                                                    };
                                                });
                                                addDebugLog('sync', 'Synced to Google Calendar', { id: entity.id, gcal_id: result.externalId });
                                            }
                                        }).catch(err => {
                                            addDebugLog('system', 'Calendar sync failed', { error: err.message });
                                        });
                                    }

                                    // NOTE: PART_OF is now handled via parent_id field directly on entity

                                    // === SHORTHAND: Auto-link context (creates TAGGED_WITH) ===
                                    const contextRef = payload.context_id || payload.context_temp || payload.context;
                                    if (contextRef) {
                                        const contextId = resolveEntityId(contextRef, newEntities);
                                        if (contextId) {
                                            newRelationships.push({
                                                id: uuidv4(),
                                                from: entity.id,
                                                to: contextId,
                                                type: RelationshipType.TAGGED_WITH,
                                                meta: {},
                                                created_at: now
                                            });
                                        }
                                    }

                                    // === SHORTHAND: Auto-link tags array (creates TAGGED_WITH for each) ===
                                    const tagsArray = payload.tags || payload.tags_temp;
                                    if (Array.isArray(tagsArray)) {
                                        tagsArray.forEach((tagRef: string) => {
                                            const tagId = resolveEntityId(tagRef, newEntities);
                                            if (tagId) {
                                                newRelationships.push({
                                                    id: uuidv4(),
                                                    from: entity.id,
                                                    to: tagId,
                                                    type: RelationshipType.TAGGED_WITH,
                                                    meta: {},
                                                    created_at: now
                                                });
                                            }
                                        });
                                    }

                                    break;
                                }

                                case 'update_entity': {
                                    // Smart resolve: If ID not found, try finding by Title
                                    let targetId = payload.id;
                                    let targetEntity = newEntities.find(e => e.id === targetId);

                                    if (!targetEntity) {
                                        const resolvedId = resolveEntityId(payload.id, newEntities);
                                        if (resolvedId) {
                                            targetId = resolvedId;
                                            targetEntity = newEntities.find(e => e.id === targetId);
                                        }
                                    }

                                    if (!targetEntity) {
                                        addDebugLog('system', 'Skipped update_entity: Not found', { id: payload.id });
                                        break;
                                    }

                                    const updates = payload.fields || {};

                                    // Merge direct payload fields (AI hallucination tolerance)
                                    // Allow status, title, description, priority, etc. to be set directly in payload
                                    if (payload.status && !updates.status) updates.status = payload.status;
                                    if (payload.title && !updates.title) updates.title = payload.title;
                                    if (payload.description && !updates.description) updates.description = payload.description;
                                    if (payload.priority && !updates.priority) updates.priority = payload.priority;
                                    if (payload.deadline && !updates.deadline) updates.deadline = payload.deadline;
                                    if (payload.start_time && !updates.start_time) updates.start_time = payload.start_time;
                                    if (payload.end_time && !updates.end_time) updates.end_time = payload.end_time;
                                    if (payload.recurrence && !updates.recurrence) updates.recurrence = payload.recurrence;
                                    if (payload.metadata && !updates.metadata) updates.metadata = { ...targetEntity.metadata, ...payload.metadata };
                                    // NEW: Allow kind changes (e.g., HABIT → TASK)
                                    if (payload.kind && !updates.kind) updates.kind = payload.kind;

                                    // Handle Rename Sync for Tags
                                    if (updates.title && (targetEntity.kind === EntityKind.TAG || targetEntity.kind === EntityKind.CONTEXT)) {
                                        newUniversalTags = newUniversalTags.map(t =>
                                            t.id === targetId ? { ...t, title: updates.title } : t
                                        );

                                        // Note: We are NOT updating canonical_tags in all referenced entities here to avoid O(N^2) perf hit on simple rename.
                                        // But for strict consistency, we should. For MVP, we skip this deep update.
                                        // The UI will likely refetch relationship data anyway.
                                    }

                                    // Handle Recurrence & Celebration logic
                                    if (updates.status === EntityStatus.COMPLETED && targetEntity.status !== EntityStatus.COMPLETED) {
                                        triggerConfetti();

                                        if (targetEntity.recurrence) {
                                            const nextStart = targetEntity.start_time ? calculateNextDate(targetEntity.start_time, targetEntity.recurrence) : null;
                                            const nextDeadline = targetEntity.deadline ? calculateNextDate(targetEntity.deadline, targetEntity.recurrence) : null;

                                            if (nextStart || nextDeadline) {
                                                sideEffectOps.push({
                                                    type: 'create_entity',
                                                    payload: {
                                                        title: targetEntity.title,
                                                        kind: targetEntity.kind,
                                                        description: targetEntity.description,
                                                        priority: targetEntity.priority,
                                                        status: EntityStatus.ACTIVE,
                                                        start_time: nextStart,
                                                        deadline: nextDeadline,
                                                        recurrence: targetEntity.recurrence,
                                                        canonical_tags: targetEntity.canonical_tags,
                                                        metadata: { ...targetEntity.metadata, cloned_from: targetEntity.id }
                                                    }
                                                });
                                                addDebugLog('system', 'Generated recurring task instance', { originalId: targetEntity.id });
                                            }
                                        }
                                    }

                                    newEntities = newEntities.map(e =>
                                        e.id === targetId
                                            ? { ...e, ...updates, updated_at: now }
                                            : e
                                    );

                                    const existingKernel = nextKernelEntities[targetId] || upgradeLegacyEntityToKernel(targetEntity as unknown as Record<string, unknown>);
                                    const nextAttrs: Record<string, AttributeValue> = { ...existingKernel.attributes };
                                    if (updates.priority !== undefined) nextAttrs.priority = updates.priority;
                                    if (updates.deadline !== undefined) nextAttrs.deadline = updates.deadline;
                                    if (updates.start_time !== undefined) nextAttrs.start_time = updates.start_time;
                                    if (updates.end_time !== undefined) nextAttrs.end_time = updates.end_time;
                                    if (updates.duration_minutes !== undefined) nextAttrs.duration_minutes = updates.duration_minutes;
                                    if (updates.recurrence !== undefined) nextAttrs.cadence_rrule = updates.recurrence;
                                    if (updates.description !== undefined) {
                                        nextAttrs.notes = updates.description;
                                        if (existingKernel.schema_id === 'system/note') nextAttrs.content = updates.description;
                                    }
                                    if (updates.canonical_tags !== undefined && Array.isArray(updates.canonical_tags)) nextAttrs.tags = updates.canonical_tags;
                                    if (updates.kind !== undefined) nextAttrs.kind = updates.kind;
                                    if (updates.parent_id !== undefined) nextAttrs.parent_id = updates.parent_id;
                                    if (updates.metadata && typeof updates.metadata === 'object') {
                                        for (const [k, v] of Object.entries(updates.metadata)) {
                                            if (v !== undefined) nextAttrs[k] = v as AttributeValue;
                                        }
                                    }

                                    const nextStatus = updates.status ? updates.status.toLowerCase() : existingKernel.lifecycle.status;
                                    nextKernelEntities[targetId] = {
                                        ...existingKernel,
                                        title: updates.title !== undefined ? updates.title : existingKernel.title,
                                        version: existingKernel.version + 1,
                                        attributes: nextAttrs,
                                        lifecycle: {
                                            ...existingKernel.lifecycle,
                                            status: nextStatus,
                                            updated_at: now,
                                        },
                                        validity: {
                                            valid_from: nextAttrs.start_time ? String(nextAttrs.start_time) : existingKernel.validity?.valid_from,
                                            valid_until: nextAttrs.end_time ? String(nextAttrs.end_time) : existingKernel.validity?.valid_until,
                                        },
                                    };
                                    break;
                                }

                                case 'delete_entity': {
                                    // SOFT DELETE: Mark as deleted instead of hard removing
                                    // This allows sync to propagate the deletion properly
                                    const entityId = payload.id || payload.entity_id;
                                    const resolvedId = resolveEntityId(entityId, newEntities);
                                    if (!resolvedId) {
                                        addDebugLog('system', 'delete_entity: Entity not found', { id: entityId });
                                        break;
                                    }

                                    // Remove from universal tags if applicable
                                    newUniversalTags = newUniversalTags.filter(t => t.id !== resolvedId);

                                    newEntities = newEntities.map(e =>
                                        e.id === resolvedId
                                            ? {
                                                ...e,
                                                metadata: { ...e.metadata, deleted: true },
                                                updated_at: now
                                            }
                                            : e
                                    );

                                    const existingDeletedKernel = nextKernelEntities[resolvedId];
                                    if (existingDeletedKernel) {
                                        nextKernelEntities[resolvedId] = {
                                            ...existingDeletedKernel,
                                            lifecycle: {
                                                ...existingDeletedKernel.lifecycle,
                                                status: 'deleted',
                                                deleted_at: now,
                                                updated_at: now,
                                            },
                                            attributes: {
                                                ...existingDeletedKernel.attributes,
                                                deleted: true,
                                            },
                                        };
                                    }

                                    // Also remove relationships involving this entity
                                    newRelationships = newRelationships.filter(
                                        r => r.from !== resolvedId && r.to !== resolvedId
                                    );

                                    addDebugLog('system', 'Soft-deleted entity', { id: resolvedId });
                                    break;
                                }

                                case 'link_entities': {
                                    // Support from_temp and to_temp for batch referencing
                                    let fromId = payload.from;
                                    let toId = payload.to;

                                    if (!fromId && payload.from_temp) {
                                        fromId = resolveEntityId(payload.from_temp, newEntities);
                                    }
                                    if (!toId && payload.to_temp) {
                                        toId = resolveEntityId(payload.to_temp, newEntities);
                                    }

                                    // Fallback to normal resolution
                                    if (!fromId) fromId = resolveEntityId(payload.from, newEntities);
                                    if (!toId) toId = resolveEntityId(payload.to, newEntities);

                                    if (!fromId || !toId) {
                                        addDebugLog('system', 'Skipped link_entities: Entity not found', { from: payload.from || payload.from_temp, to: payload.to || payload.to_temp });
                                        break;
                                    }

                                    const exists = newRelationships.some(r =>
                                        r.from === fromId && r.to === toId && r.type === payload.type
                                    );
                                    if (!exists) {
                                        newRelationships.push({
                                            id: uuidv4(),
                                            from: fromId,
                                            to: toId,
                                            type: payload.type || RelationshipType.FULFILLS,
                                            meta: payload.meta || {},
                                            created_at: now
                                        });

                                        // SYNC TAGS: If type is TAGGED_WITH, update canonical_tags and usage count
                                        if (payload.type === RelationshipType.TAGGED_WITH) {
                                            const targetEntity = newEntities.find(e => e.id === toId);
                                            if (targetEntity) {
                                                // 1. Update source entity canonical_tags
                                                newEntities = newEntities.map(e => {
                                                    if (e.id === fromId) {
                                                        const tags = new Set(e.canonical_tags || []);
                                                        tags.add(targetEntity.title);
                                                        return { ...e, canonical_tags: Array.from(tags) };
                                                    }
                                                    return e;
                                                });

                                                if (nextKernelEntities[fromId]) {
                                                    const existingTags = Array.isArray(nextKernelEntities[fromId].attributes.tags)
                                                        ? [...(nextKernelEntities[fromId].attributes.tags as string[])]
                                                        : [];
                                                    if (!existingTags.includes(targetEntity.title)) {
                                                        existingTags.push(targetEntity.title);
                                                        nextKernelEntities[fromId] = {
                                                            ...nextKernelEntities[fromId],
                                                            attributes: { ...nextKernelEntities[fromId].attributes, tags: existingTags },
                                                            lifecycle: { ...nextKernelEntities[fromId].lifecycle, updated_at: now }
                                                        };
                                                    }
                                                }

                                                // 2. Update usage count in universalTags
                                                newUniversalTags = newUniversalTags.map(t =>
                                                    t.id === toId ? { ...t, usage_count: (t.usage_count || 0) + 1 } : t
                                                );
                                            }
                                        }
                                    }
                                    break;
                                }

                                case 'unlink_entities': {
                                    // Support deletion by relationship ID directly
                                    if (payload.id) {
                                        const relToRemove = newRelationships.find(r => r.id === payload.id);
                                        if (relToRemove) {
                                            newRelationships = newRelationships.filter(r => r.id !== payload.id);

                                            // SYNC TAGS: If type is TAGGED_WITH, remove from canonical_tags
                                            if (relToRemove.type === RelationshipType.TAGGED_WITH) {
                                                const targetEntity = newEntities.find(e => e.id === relToRemove.to);
                                                if (targetEntity) {
                                                    newEntities = newEntities.map(e => {
                                                        if (e.id === relToRemove.from) {
                                                            return {
                                                                ...e,
                                                                canonical_tags: (e.canonical_tags || []).filter(t => t !== targetEntity.title)
                                                            };
                                                        }
                                                        return e;
                                                    });

                                                    if (nextKernelEntities[relToRemove.from]) {
                                                        const existingTags = Array.isArray(nextKernelEntities[relToRemove.from].attributes.tags)
                                                            ? (nextKernelEntities[relToRemove.from].attributes.tags as string[]).filter(t => t !== targetEntity.title)
                                                            : [];
                                                        nextKernelEntities[relToRemove.from] = {
                                                            ...nextKernelEntities[relToRemove.from],
                                                            attributes: { ...nextKernelEntities[relToRemove.from].attributes, tags: existingTags },
                                                            lifecycle: { ...nextKernelEntities[relToRemove.from].lifecycle, updated_at: now }
                                                        };
                                                    }

                                                    newUniversalTags = newUniversalTags.map(t =>
                                                        t.id === relToRemove.to ? { ...t, usage_count: Math.max(0, (t.usage_count || 0) - 1) } : t
                                                    );
                                                }
                                            }
                                            addDebugLog('system', 'Removed relationship', { id: payload.id });
                                        }
                                        break;
                                    }

                                    // Legacy: match by from/to/type
                                    if (!payload.from || !payload.to) break;

                                    const fromId = resolveEntityId(payload.from, newEntities);
                                    const toId = resolveEntityId(payload.to, newEntities);

                                    if (fromId && toId) {
                                        newRelationships = newRelationships.filter(r =>
                                            !(r.from === fromId && r.to === toId && r.type === payload.type)
                                        );

                                        // SYNC TAGS: If type is TAGGED_WITH, remove from canonical_tags
                                        if (payload.type === RelationshipType.TAGGED_WITH) {
                                            const targetEntity = newEntities.find(e => e.id === toId);
                                            if (targetEntity) {
                                                // 1. Remove from source entity canonical_tags
                                                newEntities = newEntities.map(e => {
                                                    if (e.id === fromId) {
                                                        return {
                                                            ...e,
                                                            canonical_tags: (e.canonical_tags || []).filter(t => t !== targetEntity.title)
                                                        };
                                                    }
                                                    return e;
                                                });

                                                if (nextKernelEntities[fromId]) {
                                                    const existingTags = Array.isArray(nextKernelEntities[fromId].attributes.tags)
                                                        ? (nextKernelEntities[fromId].attributes.tags as string[]).filter(t => t !== targetEntity.title)
                                                        : [];
                                                    nextKernelEntities[fromId] = {
                                                        ...nextKernelEntities[fromId],
                                                        attributes: { ...nextKernelEntities[fromId].attributes, tags: existingTags },
                                                        lifecycle: { ...nextKernelEntities[fromId].lifecycle, updated_at: now }
                                                    };
                                                }

                                                // 2. Decrement usage count
                                                newUniversalTags = newUniversalTags.map(t =>
                                                    t.id === toId ? { ...t, usage_count: Math.max(0, (t.usage_count || 0) - 1) } : t
                                                );
                                            }
                                        }
                                    }
                                    break;
                                }

                                case 'log_activity': {
                                    const actId = uuidv4();
                                    // Smart Timestamp Logic
                                    let startTime = payload.start_time || payload.timestamp || now;
                                    let endTime = payload.end_time || null;
                                    let duration = payload.duration_minutes || null;

                                    // Calculate missing values if possible
                                    if (startTime && endTime && !duration) {
                                        const start = new Date(startTime).getTime();
                                        const end = new Date(endTime).getTime();
                                        duration = Math.max(0, Math.round((end - start) / 60000));
                                    } else if (startTime && duration && !endTime) {
                                        const start = new Date(startTime).getTime();
                                        const end = start + (duration * 60000);
                                        endTime = new Date(end).toISOString();
                                    } else if (endTime && duration && !startTime) {
                                        const end = new Date(endTime).getTime();
                                        const start = end - (duration * 60000);
                                        startTime = new Date(start).toISOString();
                                    }

                                    const activity: Entity = {
                                        id: actId,
                                        kind: EntityKind.ACTIVITY,
                                        title: payload.title || 'Activity Log',
                                        description: payload.notes || payload.description || null,
                                        status: EntityStatus.COMPLETED,
                                        priority: 1,
                                        start_time: startTime,
                                        end_time: endTime,
                                        deadline: null,
                                        duration_minutes: duration || 0,
                                        recurrence: null,
                                        metadata: {},
                                        created_at: now,
                                        updated_at: now,
                                        canonical_tags: []
                                    };
                                    newEntities.push(activity);
                                    nextKernelEntities[actId] = upgradeLegacyEntityToKernel(activity as unknown as Record<string, unknown>);
                                    triggerConfetti();

                                    if (payload.linked_entity_id) {
                                        const linkedId = resolveEntityId(payload.linked_entity_id, newEntities);
                                        if (linkedId) {
                                            newRelationships.push({
                                                id: uuidv4(),
                                                from: actId,
                                                to: linkedId,
                                                type: RelationshipType.FULFILLS,
                                                meta: {},
                                                created_at: now
                                            });

                                            // HABIT LOGIC: Update Habit Metadata if linked entity is a HABIT
                                            const linkedEntity = newEntities.find(e => e.id === linkedId);
                                            if (linkedEntity && linkedEntity.kind === EntityKind.HABIT) {
                                                const meta = { ...linkedEntity.metadata } as HabitMetadata;

                                                // 1. Update Counts
                                                meta.total_completions = (meta.total_completions || 0) + 1;
                                                if (meta.habit_type === 'BAD' && duration) {
                                                    meta.time_spent_minutes = (meta.time_spent_minutes || 0) + duration;
                                                }

                                                // 2. Streak Calculation (Simple Daily Logic)
                                                // If last completed was yesterday, increment streak.
                                                // If today, do nothing (already counted).
                                                // If before yesterday, reset to 1.
                                                const todayStr = new Date().toISOString().split('T')[0];
                                                const lastDateStr = meta.last_completed_at ? meta.last_completed_at.split('T')[0] : null;

                                                if (lastDateStr !== todayStr) {
                                                    const yesterday = new Date();
                                                    yesterday.setDate(yesterday.getDate() - 1);
                                                    const yesterdayStr = yesterday.toISOString().split('T')[0];

                                                    if (lastDateStr === yesterdayStr) {
                                                        meta.streak_current = (meta.streak_current || 0) + 1;
                                                    } else {
                                                        meta.streak_current = 1; // Reset or start new
                                                    }

                                                    // Update Best Streak
                                                    if ((meta.streak_current || 0) > (meta.streak_best || 0)) {
                                                        meta.streak_best = meta.streak_current;
                                                    }

                                                    meta.last_completed_at = now;
                                                }

                                                // Update the entity
                                                newEntities = newEntities.map(e =>
                                                    e.id === linkedId ? { ...e, metadata: meta, updated_at: now } : e
                                                );

                                                if (nextKernelEntities[linkedId]) {
                                                    const kMeta: Record<string, AttributeValue> = {};
                                                    for (const [k, v] of Object.entries(meta)) {
                                                        if (v !== undefined) kMeta[k] = v as AttributeValue;
                                                    }
                                                    nextKernelEntities[linkedId] = {
                                                        ...nextKernelEntities[linkedId],
                                                        attributes: {
                                                            ...nextKernelEntities[linkedId].attributes,
                                                            ...kMeta,
                                                        },
                                                        lifecycle: { ...nextKernelEntities[linkedId].lifecycle, updated_at: now }
                                                    };
                                                }
                                            }
                                        }
                                    }
                                    break;
                                }

                                case 'set_goal_progress': {
                                    const { goal_id, minutes, percent, note } = payload;
                                    const resolvedGoalId = resolveEntityId(goal_id, newEntities);

                                    if (!resolvedGoalId) break;

                                    newEntities = newEntities.map(e => {
                                        if (e.id === resolvedGoalId) {
                                            const meta = { ...e.metadata };
                                            if (minutes !== undefined) meta.progress_minutes = (meta.progress_minutes || 0) + minutes;
                                            if (percent !== undefined) meta.progress_percent = percent;
                                            if (note) meta.latest_progress_note = note;
                                            return { ...e, metadata: meta, updated_at: now };
                                        }
                                        return e;
                                    });

                                    if (nextKernelEntities[resolvedGoalId]) {
                                        const nextAttrs: Record<string, AttributeValue> = { ...nextKernelEntities[resolvedGoalId].attributes };
                                        if (minutes !== undefined) nextAttrs.progress_minutes = ((Number(nextAttrs.progress_minutes) || 0) + minutes);
                                        if (percent !== undefined) nextAttrs.progress_percent = percent;
                                        if (note) nextAttrs.latest_progress_note = note;
                                        nextKernelEntities[resolvedGoalId] = {
                                            ...nextKernelEntities[resolvedGoalId],
                                            attributes: nextAttrs,
                                            lifecycle: { ...nextKernelEntities[resolvedGoalId].lifecycle, updated_at: now },
                                        };
                                    }
                                    break;
                                }

                                case 'schedule_event': {
                                    const evtId = payload.id || uuidv4();
                                    const existingIndex = newEntities.findIndex(e => e.id === evtId);
                                    const safeTitle = payload.title || "Scheduled Event";

                                    if (existingIndex >= 0) {
                                        newEntities = newEntities.map(e =>
                                            e.id === evtId
                                                ? {
                                                    ...e,
                                                    title: safeTitle,
                                                    start_time: payload.start_time || e.start_time,
                                                    end_time: payload.end_time || e.end_time,
                                                    metadata: { ...e.metadata, ...(payload.metadata || {}) },
                                                    updated_at: now
                                                }
                                                : e
                                        );
                                        if (nextKernelEntities[evtId]) {
                                            const prev = nextKernelEntities[evtId];
                                            const prevAttrs = { ...prev.attributes };
                                            if (payload.start_time) prevAttrs.start_time = payload.start_time;
                                            if (payload.end_time) prevAttrs.end_time = payload.end_time;
                                            if (payload.metadata && typeof payload.metadata === 'object') {
                                                for (const [k, v] of Object.entries(payload.metadata)) {
                                                    if (v !== undefined) prevAttrs[k] = v as AttributeValue;
                                                }
                                            }
                                            nextKernelEntities[evtId] = {
                                                ...prev,
                                                title: safeTitle,
                                                version: prev.version + 1,
                                                attributes: prevAttrs,
                                                lifecycle: { ...prev.lifecycle, updated_at: now },
                                                validity: {
                                                    valid_from: payload.start_time ? String(payload.start_time) : prev.validity?.valid_from,
                                                    valid_until: payload.end_time ? String(payload.end_time) : prev.validity?.valid_until,
                                                },
                                            };
                                        }
                                    } else {
                                        const eventEntity: Entity = {
                                            id: evtId,
                                            kind: EntityKind.EVENT,
                                            title: safeTitle,
                                            description: payload.description || null,
                                            status: EntityStatus.ACTIVE,
                                            priority: 1,
                                            start_time: payload.start_time || null,
                                            end_time: payload.end_time || null,
                                            deadline: null,
                                            duration_minutes: null,
                                            recurrence: payload.recurrence || null,
                                            metadata: payload.metadata || {},
                                            created_at: now,
                                            updated_at: now,
                                            canonical_tags: []
                                        };
                                        newEntities.push(eventEntity);
                                        nextKernelEntities[evtId] = upgradeLegacyEntityToKernel(eventEntity as unknown as Record<string, unknown>);
                                    }
                                    break;
                                }

                                case 'tag_update': {
                                    // Deprecated: We now prefer linking entities.
                                    // However, we keep basic support for bulk updates if they occur.
                                    const { entity_id, tags } = payload;
                                    const resolvedId = resolveEntityId(entity_id, newEntities);

                                    if (!resolvedId || !Array.isArray(tags)) break;
                                    newEntities = newEntities.map(e =>
                                        e.id === resolvedId
                                            ? { ...e, canonical_tags: tags, updated_at: now }
                                            : e
                                    );
                                    if (nextKernelEntities[resolvedId]) {
                                        nextKernelEntities[resolvedId] = {
                                            ...nextKernelEntities[resolvedId],
                                            attributes: { ...nextKernelEntities[resolvedId].attributes, tags },
                                            lifecycle: { ...nextKernelEntities[resolvedId].lifecycle, updated_at: now },
                                        };
                                    }
                                    break;
                                }

                                // === FLOWMATE 3.0: NESTED ENTITY OPERATIONS ===

                                case 'add_subtask': {
                                    const entityId = payload.entity_id || payload.id;
                                    const resolvedId = resolveEntityId(entityId, newEntities);
                                    if (!resolvedId) {
                                        addDebugLog('system', 'add_subtask: Entity not found', { entity_id: entityId });
                                        break;
                                    }

                                    const newSubtask: Subtask = {
                                        id: payload.subtask_id || uuidv4(),
                                        title: payload.title || payload.subtask?.title || 'Subtask',
                                        completed: false,
                                        created_at: now,
                                        estimated_minutes: payload.estimated_minutes || payload.subtask?.estimated_minutes,
                                        order: payload.order || payload.subtask?.order
                                    };

                                    newEntities = newEntities.map(e => {
                                        if (e.id === resolvedId) {
                                            const subtasks = [...(e.metadata?.subtasks || []), newSubtask];
                                            return {
                                                ...e,
                                                metadata: { ...e.metadata, subtasks },
                                                updated_at: now
                                            };
                                        }
                                        return e;
                                    });

                                    if (nextKernelEntities[resolvedId]) {
                                        const rawSt = Array.isArray(nextKernelEntities[resolvedId].attributes.subtasks)
                                            ? (nextKernelEntities[resolvedId].attributes.subtasks as unknown as Subtask[])
                                            : [];
                                        nextKernelEntities[resolvedId] = {
                                            ...nextKernelEntities[resolvedId],
                                            attributes: {
                                                ...nextKernelEntities[resolvedId].attributes,
                                                subtasks: [...rawSt, newSubtask] as unknown as AttributeValue,
                                            },
                                            lifecycle: { ...nextKernelEntities[resolvedId].lifecycle, updated_at: now },
                                        };
                                    }
                                    break;
                                }

                                case 'toggle_subtask': {
                                    const entityId = payload.entity_id || payload.id;
                                    const subtaskId = payload.subtask_id;
                                    const resolvedId = resolveEntityId(entityId, newEntities);
                                    if (!resolvedId || !subtaskId) break;

                                    newEntities = newEntities.map(e => {
                                        if (e.id === resolvedId) {
                                            const subtasks = (e.metadata?.subtasks || []).map((st: Subtask) =>
                                                st.id === subtaskId
                                                    ? { ...st, completed: !st.completed, completed_at: !st.completed ? now : undefined }
                                                    : st
                                            );

                                            // Auto-recalculate progress
                                            const total = subtasks.length;
                                            const done = subtasks.filter((s: Subtask) => s.completed).length;
                                            const manual_progress = total > 0 ? Math.round((done / total) * 100) : 0;

                                            return {
                                                ...e,
                                                metadata: { ...e.metadata, subtasks, manual_progress },
                                                updated_at: now
                                            };
                                        }
                                        return e;
                                    });

                                    if (nextKernelEntities[resolvedId]) {
                                        const rawSt = Array.isArray(nextKernelEntities[resolvedId].attributes.subtasks)
                                            ? (nextKernelEntities[resolvedId].attributes.subtasks as unknown as Subtask[])
                                            : [];
                                        const subtasks = rawSt.map((st: Subtask) =>
                                            st.id === subtaskId
                                                ? { ...st, completed: !st.completed, completed_at: !st.completed ? now : undefined }
                                                : st
                                        );
                                        const total = subtasks.length;
                                        const done = subtasks.filter((s: Subtask) => s.completed).length;
                                        const manual_progress = total > 0 ? Math.round((done / total) * 100) : 0;
                                        nextKernelEntities[resolvedId] = {
                                            ...nextKernelEntities[resolvedId],
                                            attributes: {
                                                ...nextKernelEntities[resolvedId].attributes,
                                                subtasks: subtasks as unknown as AttributeValue,
                                                manual_progress,
                                            },
                                            lifecycle: { ...nextKernelEntities[resolvedId].lifecycle, updated_at: now },
                                        };
                                    }

                                    // Confetti if all done
                                    const targetEnt = newEntities.find(e => e.id === resolvedId);
                                    if (targetEnt?.metadata?.subtasks?.every((s: Subtask) => s.completed) && targetEnt?.metadata?.subtasks?.length > 0) {
                                        triggerConfetti();
                                    }
                                    break;
                                }

                                case 'delete_subtask': {
                                    const entityId = payload.entity_id || payload.id;
                                    const subtaskId = payload.subtask_id;
                                    const resolvedId = resolveEntityId(entityId, newEntities);
                                    if (!resolvedId || !subtaskId) break;

                                    newEntities = newEntities.map(e => {
                                        if (e.id === resolvedId) {
                                            const subtasks = (e.metadata?.subtasks || []).filter((st: Subtask) => st.id !== subtaskId);

                                            // Recalculate progress
                                            const total = subtasks.length;
                                            const done = subtasks.filter((s: Subtask) => s.completed).length;
                                            const manual_progress = total > 0 ? Math.round((done / total) * 100) : 0;

                                            return {
                                                ...e,
                                                metadata: { ...e.metadata, subtasks, manual_progress },
                                                updated_at: now
                                            };
                                        }
                                        return e;
                                    });

                                    if (nextKernelEntities[resolvedId]) {
                                        const rawSt = Array.isArray(nextKernelEntities[resolvedId].attributes.subtasks)
                                            ? (nextKernelEntities[resolvedId].attributes.subtasks as unknown as Subtask[])
                                            : [];
                                        const subtasks = rawSt.filter((st: Subtask) => st.id !== subtaskId);
                                        const total = subtasks.length;
                                        const done = subtasks.filter((s: Subtask) => s.completed).length;
                                        const manual_progress = total > 0 ? Math.round((done / total) * 100) : 0;
                                        nextKernelEntities[resolvedId] = {
                                            ...nextKernelEntities[resolvedId],
                                            attributes: {
                                                ...nextKernelEntities[resolvedId].attributes,
                                                subtasks: subtasks as unknown as AttributeValue,
                                                manual_progress,
                                            },
                                            lifecycle: { ...nextKernelEntities[resolvedId].lifecycle, updated_at: now },
                                        };
                                    }
                                    break;
                                }

                                case 'log_to_entity': {
                                    const entityId = payload.entity_id || payload.id || payload.linked_entity_id;
                                    const resolvedId = resolveEntityId(entityId, newEntities);
                                    if (!resolvedId) {
                                        addDebugLog('system', 'log_to_entity: Entity not found', { entity_id: entityId });
                                        break;
                                    }

                                    const logEntry: ActivityLogEntry = {
                                        id: uuidv4(),
                                        timestamp: payload.timestamp || now,
                                        title: payload.title || payload.t || 'Activity',
                                        duration_minutes: payload.duration_minutes || payload.m?.duration_minutes || 0,
                                        notes: payload.notes || payload.n,
                                        productivity: payload.productivity || payload.m?.productivity,
                                        color_hex: payload.color_hex || payload.m?.color_hex
                                    };

                                    newEntities = newEntities.map(e => {
                                        if (e.id === resolvedId) {
                                            const activity_log = [...(e.metadata?.activity_log || []), logEntry];
                                            const meta = { ...e.metadata, activity_log, last_interaction: now };

                                            // HABIT: Update streak if applicable
                                            if (e.kind === EntityKind.HABIT) {
                                                const habitMeta = meta as HabitMetadata & { activity_log: ActivityLogEntry[]; last_interaction: string };

                                                // Update Counts
                                                habitMeta.total_completions = (habitMeta.total_completions || 0) + 1;
                                                if (habitMeta.habit_type === 'BAD' && logEntry.duration_minutes) {
                                                    habitMeta.time_spent_minutes = (habitMeta.time_spent_minutes || 0) + logEntry.duration_minutes;
                                                }

                                                // Streak Calculation
                                                const todayStr = new Date().toISOString().split('T')[0];
                                                const lastDateStr = habitMeta.last_completed_at ? habitMeta.last_completed_at.split('T')[0] : null;

                                                if (lastDateStr !== todayStr) {
                                                    const yesterday = new Date();
                                                    yesterday.setDate(yesterday.getDate() - 1);
                                                    const yesterdayStr = yesterday.toISOString().split('T')[0];

                                                    if (lastDateStr === yesterdayStr) {
                                                        habitMeta.streak_current = (habitMeta.streak_current || 0) + 1;
                                                    } else {
                                                        habitMeta.streak_current = 1;
                                                    }

                                                    if ((habitMeta.streak_current || 0) > (habitMeta.streak_best || 0)) {
                                                        habitMeta.streak_best = habitMeta.streak_current;
                                                    }

                                                    habitMeta.last_completed_at = now;
                                                }
                                            }

                                            return { ...e, metadata: meta, updated_at: now };
                                        }
                                        return e;
                                    });

                                    if (nextKernelEntities[resolvedId]) {
                                        const rawAct = Array.isArray(nextKernelEntities[resolvedId].attributes.activity_log)
                                            ? (nextKernelEntities[resolvedId].attributes.activity_log as unknown as ActivityLogEntry[])
                                            : [];
                                        const nextAttrs: Record<string, AttributeValue> = {
                                            ...nextKernelEntities[resolvedId].attributes,
                                            activity_log: [...rawAct, logEntry] as unknown as AttributeValue,
                                            last_interaction: now,
                                        };
                                        nextKernelEntities[resolvedId] = {
                                            ...nextKernelEntities[resolvedId],
                                            attributes: nextAttrs,
                                            lifecycle: { ...nextKernelEntities[resolvedId].lifecycle, updated_at: now },
                                        };
                                    }

                                    triggerConfetti();
                                    break;
                                }

                                case 'archive_entity': {
                                    const entityId = payload.entity_id || payload.id;
                                    const archived = payload.archived !== undefined ? payload.archived : true;
                                    const resolvedId = resolveEntityId(entityId, newEntities);
                                    if (!resolvedId) break;

                                    newEntities = newEntities.map(e =>
                                        e.id === resolvedId
                                            ? { ...e, metadata: { ...e.metadata, archived }, updated_at: now }
                                            : e
                                    );

                                    if (nextKernelEntities[resolvedId]) {
                                        nextKernelEntities[resolvedId] = {
                                            ...nextKernelEntities[resolvedId],
                                            attributes: { ...nextKernelEntities[resolvedId].attributes, archived },
                                            lifecycle: {
                                                ...nextKernelEntities[resolvedId].lifecycle,
                                                status: archived ? 'archived' : 'active',
                                                updated_at: now,
                                            },
                                        };
                                    }
                                    break;
                                }

                                case 'log_food': {
                                    const foodEntry: FoodLogEntry = {
                                        id: uuidv4(),
                                        timestamp: payload.timestamp || now,
                                        food_name: payload.food_name || payload.title || payload.t || 'Unknown Food',
                                        meal_type: payload.meal_type,
                                        calories: payload.calories,
                                        protein_g: payload.protein_g,
                                        carbs_g: payload.carbs_g,
                                        fat_g: payload.fat_g,
                                        cost: payload.cost,
                                        notes: payload.notes,
                                        is_favorite: payload.is_favorite,
                                        // Enhanced tracking fields
                                        source: payload.source, // mess, ordered, homemade, outside
                                        vendor: payload.vendor, // "Sardarji", "Zomato", etc.
                                        rating: payload.rating, // 1-5
                                        skipped: payload.skipped // For skipped meals
                                    };

                                    const mealKernel = upgradeLegacyMealLogToKernel(foodEntry as unknown as Record<string, unknown>);
                                    nextKernelEntities[foodEntry.id] = mealKernel;

                                    // Add directly to state (returned from set() below)
                                    newFoodLogs = [...(newFoodLogs || state.foodLogs), foodEntry];

                                    triggerConfetti();
                                    break;
                                }
                            }
                        } catch (err) {
                            console.error(`Operation ${op.type} failed execution:`, err);
                            addDebugLog('system', `Operation execution failed: ${op.type}`, { error: String(err), payload: op.payload });
                        }
                    });

                    if (sideEffectOps.length > 0) {
                        setTimeout(() => {
                            get().applyOperations(sideEffectOps);
                        }, 100);
                    }

                    if (ops.length > 0) {
                        const count = ops.length;
                        const msg = count === 1 ? `Applied 1 operation` : `Applied ${count} operations`;
                        addToast(msg, 'success');
                    }

                    const newSyncItems: SyncQueueItem[] = ops.map(op => ({
                        id: uuidv4(),
                        op,
                        status: 'pending',
                        attempts: 0,
                        created_at: new Date().toISOString()
                    }));

                    // Cap syncQueue: keep only pending + recent items (max 200)
                    const currentSyncQueue = (state.syncQueue || [])
                        .filter(item => item.status === 'pending' || item.status === 'in_progress');
                    const cappedQueue = [...currentSyncQueue, ...newSyncItems].slice(-200);

                    const projectedEntities = projectKernelEntitiesToLegacy(nextKernelEntities);

                    // Record post-mutation state in history
                    newHistory.push({
                        entities: projectedEntities,
                        relationships: newRelationships,
                        kernelEntities: nextKernelEntities,
                        timestamp: Date.now()
                    });
                    while (newHistory.length > 25) newHistory.shift();
                    const newPointer = newHistory.length - 1;

                    return {
                        history: newHistory,
                        historyPointer: newPointer,
                        kernelEntities: nextKernelEntities,
                        entities: projectedEntities,
                        relationships: newRelationships,
                        universalTags: newUniversalTags,
                        pendingOps: null,
                        syncQueue: cappedQueue,
                        ...(newFoodLogs ? { foodLogs: newFoodLogs } : {})
                    };
                });

                if (!get().isDemoMode) {
                    get().processSyncQueue();
                }

                // Auto-sync to cloud after state changes (strictly blocked in demo mode)
                if (!get().isDemoMode) {
                    scheduleSync(() => {
                        const state = get();
                        return {
                            entities: state.entities,
                            relationships: state.relationships,
                            universalTags: state.universalTags,
                            settings: state.settings,
                        };
                    });
                }
            }
        }),
        {
            name: 'flowmate-storage',
            storage: createJSONStorage(() => ({
                getItem: key => asyncStorage.getItem(key),
                removeItem: key => asyncStorage.removeItem(key),
                setItem: (key, value) => {
                    const payload = JSON.parse(value) as { state?: { isDemoMode?: boolean } };
                    if (sampleExitInProgress || payload.state?.isDemoMode) return Promise.resolve();
                    return asyncStorage.setItem(key, value);
                },
            })),
            version: 17,
            // Only persist data that should survive page reloads
            partialize: (state: FlowmateState) => {
                // DEMO ISOLATION: When in demo mode, NEVER persist synthetic demo data!
                // Persist the user's personal snapshot instead so reloading never corrupts personal state.
                const kernelEntities = state.isDemoMode && state.personalSnapshot
                    ? state.personalSnapshot.kernelEntities
                    : state.kernelEntities;
                const entities = state.isDemoMode && state.personalSnapshot
                    ? state.personalSnapshot.entities
                    : state.entities;
                const relationships = state.isDemoMode && state.personalSnapshot
                    ? state.personalSnapshot.relationships
                    : state.relationships;
                const universalTags = state.isDemoMode && state.personalSnapshot
                    ? state.personalSnapshot.universalTags
                    : state.universalTags;
                const messages = state.isDemoMode && state.personalSnapshot
                    ? state.personalSnapshot.messages
                    : state.messages;
                const chatSessions = state.isDemoMode && state.personalSnapshot
                    ? state.personalSnapshot.chatSessions
                    : state.chatSessions;
                const activeSessionId = state.isDemoMode && state.personalSnapshot
                    ? state.personalSnapshot.activeSessionId
                    : state.activeSessionId;
                const syncQueue = state.isDemoMode && state.personalSnapshot
                    ? state.personalSnapshot.syncQueue
                    : state.syncQueue;
                // Branch state: also isolate from demo — persist pre-demo branches from snapshot
                const branches = state.isDemoMode && state.personalSnapshot
                    ? state.personalSnapshot.branches
                    : state.branches;
                const activeBranchId = state.isDemoMode && state.personalSnapshot
                    ? state.personalSnapshot.activeBranchId
                    : state.activeBranchId;
                const branchQueues = state.isDemoMode && state.personalSnapshot
                    ? state.personalSnapshot.branchQueues
                    : state.branchQueues;

                return {
                    isDemoMode: state.isDemoMode,
                    kernelEntities,
                    schemas: state.schemas,
                    auditLogs: state.auditLogs,
                    entities,
                    relationships,
                    universalTags,
                    messages,
                    chatSessions,
                    activeSessionId,
                    branches,
                    activeBranchId,
                    branchQueues,
                    developerModeEnabled: state.developerModeEnabled,
                    unsentDrafts: state.isDemoMode && state.personalSnapshot ? state.personalSnapshot.unsentDrafts || {} : state.unsentDrafts,
                    settings: state.settings,
                    foodLogs: state.foodLogs,
                    subjects: state.subjects,
                    classSchedule: state.classSchedule,
                    holidays: state.holidays,
                    attendanceLogs: state.attendanceLogs,
                    syncQueue,
                    debugLogs: state.debugLogs,
                    dailyBriefing: state.dailyBriefing,
                };
            },
            migrate: (persistedState: any, version): any => {
                const state = persistedState as Partial<FlowmateState>;

                // Validate and sanitize persisted state first
                const validationResult = validatePersistedState(state);
                if (validationResult.errors.length > 0) {
                    console.warn('[Migration] Data validation errors:', validationResult.errors);
                }

                // Use validated data (fallbacks to safe defaults)
                const safeEntities = validationResult.sanitizedEntities;
                const safeRelationships = validationResult.sanitizedRelationships;
                const safeMessages = Array.isArray(state.messages) ? state.messages : [];
                const safeSyncQueue = Array.isArray(state.syncQueue) ? state.syncQueue : [];
                const safeDebugLogs = Array.isArray(state.debugLogs) ? state.debugLogs : [];
                let safeTags = Array.isArray(state.universalTags) ? state.universalTags : [];

                // Migration: Populate universalTags if empty but tags exist in entities
                if (version < 14 && safeTags.length === 0) {
                    safeEntities.forEach(e => {
                        if (e.kind === EntityKind.TAG || e.kind === EntityKind.CONTEXT) {
                            if (!safeTags.find(t => t.id === e.id)) {
                                safeTags.push({
                                    id: e.id,
                                    title: e.title,
                                    kind: e.kind,
                                    usage_count: 0 // Will be recalculated or 0 for now
                                });
                            }
                        }
                    });
                    // Approximate usage count? Not strictly necessary for functionality, but nice.
                    // We can calculate usage by scanning relationships.
                    const usageMap: Record<string, number> = {};
                    safeRelationships.forEach(r => {
                        if (r.type === RelationshipType.TAGGED_WITH) {
                            usageMap[r.to] = (usageMap[r.to] || 0) + 1;
                        }
                    });
                    safeTags = safeTags.map(t => ({
                        ...t,
                        usage_count: usageMap[t.id] || 0
                    }));
                }

                // Migration v15→v16: Remap dead EntityKinds, normalize metadata fields
                if (version < 16) {
                    safeEntities.forEach(e => {
                        // Remap dead kinds
                        if ((e.kind as string) === 'COURSE') e.kind = EntityKind.PROJECT;
                        if ((e.kind as string) === 'TOPIC') e.kind = EntityKind.TAG;
                        if ((e.kind as string) === 'ROLE') e.kind = EntityKind.CONTEXT;

                        // Normalize metadata field names
                        if (e.metadata?.streak !== undefined) {
                            e.metadata.streak_current = e.metadata.streak;
                            delete e.metadata.streak;
                        }
                        if (e.metadata?.last_interaction !== undefined) {
                            e.metadata.last_completed_at = e.metadata.last_interaction;
                            delete e.metadata.last_interaction;
                        }
                    });

                    // Clean up orphaned relationships
                    const entityIds = new Set(safeEntities.map(e => e.id));
                    const cleanedRelationships = safeRelationships.filter(r => entityIds.has(r.from) && entityIds.has(r.to));
                    safeRelationships.length = 0;
                    cleanedRelationships.forEach(r => safeRelationships.push(r));
                }

                const mergedSettings = {
                    timezone: 'Asia/Kolkata', // Force IST fallback
                    preferred_model: 'gemini-3.8-flash',
                    preferred_live_model: 'gemini-3.8-live',
                    preferred_live_reasoning_level: 'medium',
                    sync_ai_preferences: false,
                    save_voice_transcripts: false,
                    sync_enabled: false,
                    debug_mode: false,
                    custom_instructions: '',
                    ...(state.settings || {})
                };

                const rawSessions: ChatSession[] = state.chatSessions?.length ? state.chatSessions : [{
                    id: 'general',
                    title: 'General Chat',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }];
                const activeSessions = rawSessions.filter(isChatSessionActive);
                let rehydratedSessions = rawSessions;
                let rehydratedActiveId = state.activeSessionId || 'general';

                if (activeSessions.length === 0) {
                    const fallbackGeneral: ChatSession = {
                        id: 'general',
                        title: 'General Chat',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    const hasGeneral = rawSessions.some(s => s.id === 'general');
                    rehydratedSessions = hasGeneral
                        ? rawSessions.map(s => s.id === 'general' ? fallbackGeneral : s)
                        : [...rawSessions, fallbackGeneral];
                    rehydratedActiveId = 'general';
                } else if (!activeSessions.some(s => s.id === rehydratedActiveId)) {
                    rehydratedActiveId = activeSessions[0].id;
                }

                const deletedSessionIds = new Set(rehydratedSessions.filter(s => s.deleted).map(s => s.id));
                const cleanMessages = safeMessages.filter(m => !m.channelId || !deletedSessionIds.has(m.channelId));

                // Greenfield Kernel Inversion: Ensure kernelEntities is initialized and authoritative
                const rehydratedKernelEntities: Record<string, KernelEntity> = {};
                if (state.kernelEntities && typeof state.kernelEntities === 'object' && Object.keys(state.kernelEntities).length > 0) {
                    Object.assign(rehydratedKernelEntities, state.kernelEntities);
                } else {
                    safeEntities.forEach(e => {
                        const kernel = upgradeLegacyEntityToKernel(e as unknown as Record<string, unknown>);
                        rehydratedKernelEntities[kernel.id] = kernel;
                    });
                }
                const projectedEntities = projectKernelEntitiesToLegacy(rehydratedKernelEntities);

                const rawBranches: ConversationBranch[] = Array.isArray(state.branches) && state.branches.length > 0
                    ? state.branches
                    : [{
                        id: 'b_main_general',
                        conversation_id: 'general',
                        name: 'Main',
                        head_message_id: 'init-1',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }];

                return {
                    ...state,
                    kernelEntities: rehydratedKernelEntities,
                    schemas: { ...(state.schemas || {}), ...bootstrapKernel().schemas },
                    auditLogs: Array.isArray(state.auditLogs) ? state.auditLogs : [],
                    settings: mergedSettings,
                    focusSession: state.focusSession || null,
                    dailyBriefing: state.dailyBriefing || null,
                    isHydrated: false,
                    isZenMode: false,
                    toasts: [],
                    showConfetti: false,
                    history: [],
                    chatSessions: rehydratedSessions,
                    activeSessionId: rehydratedActiveId,
                    branches: rawBranches,
                    activeBranchId: state.activeBranchId || 'b_main_general',
                    developerModeEnabled: !!state.developerModeEnabled,
                    unsentDrafts: state.unsentDrafts || {},
                    // Entities and relationships are already sanitized by validatePersistedState
                    entities: projectedEntities,
                    relationships: safeRelationships,
                    universalTags: safeTags,
                    messages: cleanMessages,
                    syncQueue: safeSyncQueue,
                    debugLogs: safeDebugLogs
                };
            },
            merge: (persistedState: unknown, currentState: FlowmateState) => {
                if (currentState.isDemoMode) return currentState;
                const persisted = (persistedState as Partial<FlowmateState>) || {};
                const persistedKernel = persisted.kernelEntities || {};

                // Deterministic reconciliation between current in-memory kernelEntities and persisted kernelEntities
                let reconciledKernel: Record<string, KernelEntity>;
                const currentKernel = currentState.kernelEntities || {};
                if (Object.keys(persistedKernel).length > 0 && Object.keys(currentKernel).length > 0) {
                    const { nextKernelEntities } = reconcileEntityCollection(
                        currentKernel,
                        Object.values(persistedKernel)
                    );
                    reconciledKernel = nextKernelEntities;
                } else {
                    reconciledKernel = Object.keys(persistedKernel).length > 0 ? persistedKernel : currentKernel;
                }

                const finalEntities = Object.keys(reconciledKernel).length > 0
                    ? projectKernelEntitiesToLegacy(reconciledKernel)
                    : (persisted.entities || currentState.entities);

                const rawSessions: ChatSession[] = persisted.chatSessions?.length ? persisted.chatSessions : currentState.chatSessions;
                const activeSessions = rawSessions.filter(isChatSessionActive);
                let rehydratedSessions = rawSessions;
                let rehydratedActiveId = persisted.activeSessionId || currentState.activeSessionId || 'general';

                if (activeSessions.length === 0) {
                    const fallbackGeneral: ChatSession = {
                        id: 'general',
                        title: 'General Chat',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    const hasGeneral = rawSessions.some(s => s.id === 'general');
                    rehydratedSessions = hasGeneral
                        ? rawSessions.map(s => s.id === 'general' ? fallbackGeneral : s)
                        : [...rawSessions, fallbackGeneral];
                    rehydratedActiveId = 'general';
                } else if (!activeSessions.some(s => s.id === rehydratedActiveId)) {
                    rehydratedActiveId = activeSessions[0].id;
                }

                const rawBranches = Array.isArray(persisted.branches) && persisted.branches.length > 0
                    ? persisted.branches
                    : currentState.branches;
                const desiredBranchId = persisted.activeBranchId || currentState.activeBranchId;
                const activeBranchId = rawBranches.find(b => b.id === desiredBranchId && b.conversation_id === rehydratedActiveId && !b.deleted_at)?.id
                    || rawBranches.find(b => b.conversation_id === rehydratedActiveId && !b.deleted_at)?.id || `b_main_${rehydratedActiveId}`;

                const deletedSessionIds = new Set(rehydratedSessions.filter(s => s.deleted).map(s => s.id));
                const rawMessages = Array.isArray(persisted.messages) ? persisted.messages : currentState.messages;
                const cleanMessages = rawMessages.filter((m: Message) => !m.channelId || !deletedSessionIds.has(m.channelId));

                return {
                    ...currentState,
                    ...persisted,
                    kernelEntities: reconciledKernel,
                    schemas: { ...(persisted.schemas || {}), ...bootstrapKernel().schemas },
                    entities: finalEntities,
                    chatSessions: rehydratedSessions,
                    activeSessionId: rehydratedActiveId,
                    branches: rawBranches,
                    activeBranchId,
                    // Snapshot adoption invalidates whole-state undo history from another revision.
                    history: [], historyPointer: -1,
                    developerModeEnabled: persisted.developerModeEnabled ?? currentState.developerModeEnabled ?? false,
                    unsentDrafts: persisted.unsentDrafts || currentState.unsentDrafts || {},
                    messages: cleanMessages
                };
            },
            onRehydrateStorage: () => (state) => {
                state?.setHydrated(true);
            }
        }
    )
);

if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as unknown as { __FLOWMATE_STORE__?: typeof useStore }).__FLOWMATE_STORE__ = useStore;
}

// Canonical Kernel State Selectors
export const selectLegacyEntities = (state: FlowmateState): ReadonlyArray<Readonly<Entity>> => state.entities;
export const selectKernelEntities = (state: FlowmateState): Record<string, KernelEntity> => state.kernelEntities;
export const selectSchemas = (state: FlowmateState): Record<string, SchemaDefinition> => state.schemas;
export const selectAuditLogs = (state: FlowmateState): AuditLogEntry[] => state.auditLogs;

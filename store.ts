import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { GoogleCalendarAdapter } from './services/googleSync';
import { generateBriefing } from './services/geminiService';
import { saveUserData, loadUserData } from './services/firestoreSync';
import { onAuthChange, User } from './services/firebase';
import {
    Entity,
    Relationship,
    Message,
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
    AttendanceLog
} from './types';

// --- Normalization & Validation Helper ---

const normalizePayload = (type: ToonOperationType, payload: any): any => {
    if (!payload) return {};
    const p = { ...payload };

    // 0. Short Field Aliases (Flowmate 3.1 — Token Optimization)
    if (p.k && !p.kind) p.kind = p.k;
    if (p.t && !p.title) p.title = p.t;
    if (p.d && !p.description) p.description = p.d;
    if (p.p && !p.parent && !p.parent_id) p.parent = p.p;
    if (p.s && !p.status) p.status = p.s;
    if (p.m && !p.metadata) p.metadata = p.m;
    if (p.dur && !p.duration_minutes) p.duration_minutes = p.dur;
    if (p.start && !p.start_time) p.start_time = p.start;
    if (p.end && !p.end_time) p.end_time = p.end;
    if (p.due && !p.deadline) p.deadline = p.due;

    // 1. Common Field Aliases (LLM Hallucination Fixes)
    if (p.name && !p.title) p.title = p.name;
    if (p.desc && !p.description) p.description = p.desc;
    if (p.details && !p.description) p.description = p.details;
    if (p.notes && !p.description) p.description = p.notes; // Common for tasks

    // Date aliases
    if (p.due_date && !p.deadline) p.deadline = p.due_date;
    if (p.target_date && !p.deadline) p.deadline = p.target_date;
    // Removed: end -> deadline alias (was incorrectly setting deadline on events)
    if (p.date && !p.start_time) p.start_time = p.date;
    if (p.start && !p.start_time) p.start_time = p.start;

    // log_activity specific aliases
    if (type === 'log_activity') {
        if (p.end && !p.end_time) p.end_time = p.end;
        if (p.duration && !p.duration_minutes) p.duration_minutes = p.duration;
    }

    // 2. Relationship Aliases
    if (type === 'link_entities' || type === 'unlink_entities') {
        // Source
        if (!p.from && p.source) p.from = p.source;
        if (!p.from && p.source_id) p.from = p.source_id;
        if (!p.from && p.from_entity_id) p.from = p.from_entity_id;
        if (!p.from && p.origin) p.from = p.origin;

        // Target
        if (!p.to && p.target) p.to = p.target;
        if (!p.to && p.target_id) p.to = p.target_id;
        if (!p.to && p.to_entity_id) p.to = p.to_entity_id;
        if (!p.to && p.destination) p.to = p.destination;

        // Type
        if (!p.type && p.relationship) p.type = p.relationship;
        if (!p.type && p.rel) p.type = p.rel;

        // Default type if missing
        if (!p.type) p.type = RelationshipType.DEPENDS_ON;
    }

    // 3. Kind Validation/Normalization
    if (p.kind) {
        const k = p.kind.toUpperCase();

        // Short kind aliases (Flowmate 3.1)
        const shortKindMap: Record<string, EntityKind> = {
            'CTX': EntityKind.CONTEXT,
            'GOL': EntityKind.GOAL,
            'PRJ': EntityKind.PROJECT,
            'TSK': EntityKind.TASK,
            'EVT': EntityKind.EVENT,
            'HAB': EntityKind.HABIT,
            'NOT': EntityKind.NOTE,
            'PER': EntityKind.PERSON,
            // Legacy aliases
            'MEETING': EntityKind.EVENT,
            'REMINDER': EntityKind.TASK,
            'SUBTASK': EntityKind.TASK,
            'IDEA': EntityKind.NOTE,
            'AREA': EntityKind.CONTEXT,
            'DOMAIN': EntityKind.CONTEXT,
            'SPACE': EntityKind.CONTEXT,
        };

        if (Object.values(EntityKind).includes(k as EntityKind)) {
            p.kind = k;
        } else if (shortKindMap[k]) {
            p.kind = shortKindMap[k];
        } else {
            p.kind = EntityKind.TASK; // Default fallback
        }
    }

    return p;
};

// --- Short Operation Type Expansion (Flowmate 3.1) ---
const SHORT_OP_MAP: Record<string, ToonOperationType> = {
    'c': 'create_entity',
    'u': 'update_entity',
    'd': 'delete_entity',
    'l': 'link_entities',
    's': 'add_subtask',
    'f': 'log_food',
    'log': 'log_to_entity',
    'arc': 'archive_entity',
};

const expandOperationType = (shortType: string): ToonOperationType => {
    return (SHORT_OP_MAP[shortType] || shortType) as ToonOperationType;
};

// --- Helper: Calculate Next Recurrence ---
const calculateNextDate = (currentDate: string, recurrence: RecurrenceType): string | null => {
    if (!currentDate || !recurrence) return null;
    const date = new Date(currentDate);

    switch (recurrence) {
        case 'DAILY': date.setDate(date.getDate() + 1); break;
        case 'WEEKLY': date.setDate(date.getDate() + 7); break;
        case 'MONTHLY': date.setMonth(date.getMonth() + 1); break;
        case 'YEARLY': date.setFullYear(date.getFullYear() + 1); break;
        default: return null;
    }
    return date.toISOString();
};

// --- Helper: Resolve ID from ID or Title ---
const resolveEntityId = (identifier: string, entities: Entity[]): string | null => {
    if (!identifier) return null;
    // 1. Direct ID match
    const byId = entities.find(e => e.id === identifier);
    if (byId) return byId.id;

    // 2. Title match (Case insensitive, search backwards to find most recently created)
    // We search backwards because if the user says "Create Task A" and then "Link Task A",
    // they likely mean the one just created.
    for (let i = entities.length - 1; i >= 0; i--) {
        if (entities[i].title.toLowerCase() === identifier.toLowerCase()) {
            return entities[i].id;
        }
    }

    // 3. Prefix ID match (Recovery for truncated UUIDs from LLM)
    // LLMs sometimes drop the last char of a UUID or truncate long strings.
    if (identifier.length > 20) {
        const byPrefix = entities.find(e => e.id.startsWith(identifier));
        if (byPrefix) return byPrefix.id;
    }

    return null;
};

// --- Store Definition ---

interface HistorySnapshot {
    entities: Entity[];
    relationships: Relationship[];
    timestamp: number;
}

interface FlowmateState {
    isHydrated: boolean;
    entities: Entity[];
    relationships: Relationship[];
    universalTags: TagDefinition[];
    messages: Message[];
    pendingOps: {
        ops: ToonOperation[];
        originalMessageId: string;
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
    currentUser: User | null;
    isCloudSyncEnabled: boolean;

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

    // Actions
    setHydrated: (val: boolean) => void;
    addMessage: (role: 'user' | 'assistant', text: string, ops?: ToonOperation[], attachment?: string | null, channelId?: string) => string;
    setPendingOps: (ops: ToonOperation[], originalMessageId: string) => void;
    clearPendingOps: () => void;
    applyOperations: (ops: ToonOperation[]) => void;
    processSyncQueue: () => Promise<void>;
    getSnapshot: () => { entities: Entity[]; relationships: Relationship[] };

    // Entity/Relationship CRUD
    addEntity: (entity: Entity) => void;
    updateEntity: (id: string, updates: Partial<Entity>) => void;
    deleteEntity: (id: string) => void;
    addRelationship: (rel: Relationship) => void;
    removeRelationship: (id: string) => void;

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
    refreshDailyBriefing: () => Promise<void>;

    // Quick CRUD helpers for the Orchestrator
    findEntityByTitle: (title: string) => Entity | undefined;

    // Computed
    getXP: () => number;

    // Auth & Cloud Sync
    setCurrentUser: (user: User | null) => void;
    setCloudSyncEnabled: (enabled: boolean) => void;
    syncToCloud: () => Promise<void>;
    loadFromCloud: () => Promise<void>;

    // Offline Queue
    setOnline: (status: boolean) => void;
    addToOfflineQueue: (message: string) => void;
    removeFromOfflineQueue: (id: string) => void;
    getOfflineQueue: () => { id: string; message: string; timestamp: string }[];
}

export const useStore = create<FlowmateState>()(
    persist(
        (set, get) => ({
            isHydrated: false,
            entities: [],
            relationships: [],
            universalTags: [], // Initialize empty, will be populated if needed by migration
            messages: [
                {
                    id: 'init-1',
                    role: 'assistant',
                    text: 'Welcome to Flowmate. I am ready to organize your productivity graph. What are you working on?',
                    created_at: new Date().toISOString()
                }
            ],
            pendingOps: null,
            syncQueue: [],
            currentView: 'chat_graph',
            selectedEntityId: null,
            settings: {
                timezone: 'Asia/Kolkata', // Force IST
                preferred_model: 'gemini-2.5-flash',
                sync_enabled: false,
                debug_mode: false,
                custom_instructions: '',
                feature_toggles: {
                    food_tracking: true,
                    attendance_tracking: true,
                    people_tracking: true
                },
                productivity_calc_method: 'LOGGED_TIME'
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

            // Offline Support
            isOnline: navigator.onLine,
            offlineQueue: [],

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
                const { currentUser, entities, relationships, universalTags, addDebugLog, addToast } = get();
                if (!currentUser) {
                    addToast('Sign in to sync to cloud', 'info');
                    return;
                }

                try {
                    const success = await saveUserData(currentUser.uid, { entities, relationships, universalTags });
                    if (success) {
                        addDebugLog('sync', 'Synced to Firestore', { entityCount: entities.length });
                        addToast('Synced to cloud', 'success');
                    }
                } catch (err) {
                    console.error('Cloud sync failed:', err);
                    addToast('Cloud sync failed', 'error');
                }
            },

            loadFromCloud: async () => {
                const { currentUser, entities, relationships, addDebugLog, addToast } = get();
                if (!currentUser) return;

                try {
                    const { mergeData } = await import('./services/firestoreSync');
                    const data = await loadUserData(currentUser.uid);
                    if (data) {
                        // FIXED: Merge instead of overwrite to preserve newer local changes
                        const merged = mergeData(
                            { entities, relationships },
                            { entities: data.entities, relationships: data.relationships }
                        );
                        set({
                            entities: merged.entities,
                            relationships: merged.relationships,
                            universalTags: data.universalTags
                        });
                        addDebugLog('sync', 'Merged from Firestore', {
                            cloudCount: data.entities.length,
                            mergedCount: merged.entities.length
                        });
                        addToast('Synced with cloud', 'success');
                    }
                } catch (err) {
                    console.error('Cloud load failed:', err);
                    addToast('Failed to load from cloud', 'error');
                }
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
                const { entities, addDebugLog } = get();
                const now = Date.now();
                const dayMs = 24 * 60 * 60 * 1000;

                const completedTaskDays = 30;
                const pastEventDays = 60;
                const canceledDays = 14;

                let archivedCount = 0;

                const updatedEntities = entities.map(e => {
                    // Skip already archived
                    if (e.metadata?.archived) return e;

                    let shouldArchive = false;

                    // Completed tasks older than 30 days
                    if (e.status === EntityStatus.COMPLETED && e.kind === EntityKind.TASK) {
                        const updatedAt = new Date(e.updated_at).getTime();
                        if ((now - updatedAt) / dayMs > completedTaskDays) shouldArchive = true;
                    }

                    // Past events older than 60 days
                    if (e.kind === EntityKind.EVENT && e.start_time) {
                        const eventTime = new Date(e.start_time).getTime();
                        if ((now - eventTime) / dayMs > pastEventDays) shouldArchive = true;
                    }

                    // Canceled entities older than 14 days
                    if (e.status === EntityStatus.CANCELED) {
                        const updatedAt = new Date(e.updated_at).getTime();
                        if ((now - updatedAt) / dayMs > canceledDays) shouldArchive = true;
                    }

                    if (shouldArchive) {
                        archivedCount++;
                        return {
                            ...e,
                            metadata: { ...e.metadata, archived: true },
                            updated_at: new Date().toISOString()
                        };
                    }

                    return e;
                });

                if (archivedCount > 0) {
                    set({ entities: updatedEntities });
                    addDebugLog('system', `Auto-archived ${archivedCount} stale entities`);
                }

                return archivedCount;
            },

            importData: (data) => {
                set((state) => ({
                    entities: data.entities || [],
                    relationships: data.relationships || [],
                    messages: data.messages || [],
                    settings: { ...state.settings, ...(data.settings || {}) },
                    history: [], // Reset history on import
                    historyPointer: -1,
                    universalTags: data.universalTags || [] // Import tags if available
                }));
            },

            addMessage: (role, text, ops, attachment, channelId = 'general') => {
                const id = uuidv4();
                const newMessage: Message = {
                    id,
                    role,
                    text,
                    channelId,
                    attachment: attachment || null,
                    created_at: new Date().toISOString(),
                    ops_preview: ops
                };
                set((state) => ({ messages: [...(state.messages || []), newMessage] }));
                return id;
            },

            setPendingOps: (ops, messageId) => {
                set({ pendingOps: { ops, originalMessageId: messageId } });
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
                    const content = await generateBriefing({ entities, relationships });
                    set({
                        dailyBriefing: {
                            content,
                            timestamp: new Date().toISOString(),
                            generated_for_date: today
                        }
                    });
                } catch (err) {
                    console.error("Failed to generate briefing", err);
                }
            },

            getSnapshot: () => {
                const { entities, relationships } = get();
                return { entities: entities || [], relationships: relationships || [] };
            },

            findEntityByTitle: (title) => {
                if (!title) return undefined;
                return (get().entities || []).find(e => (e.title || '').toLowerCase() === title.toLowerCase());
            },

            getXP: () => {
                const { entities } = get();
                let xp = 0;
                (entities || []).forEach(e => {
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
                if (historyPointer >= 0) {
                    const snapshot = history[historyPointer];
                    set({
                        entities: snapshot.entities,
                        relationships: snapshot.relationships,
                        historyPointer: historyPointer - 1
                    });
                    addToast("Undone last action", "info");
                }
            },

            redo: () => {
                const { history, historyPointer, addToast } = get();
                if (historyPointer < history.length - 1) {
                    const snapshot = history[historyPointer + 1];
                    set({
                        entities: snapshot.entities,
                        relationships: snapshot.relationships,
                        historyPointer: historyPointer + 1
                    });
                    addToast("Redone last action", "info");
                }
            },

            canUndo: () => {
                return get().historyPointer >= 0;
            },

            canRedo: () => {
                const { history, historyPointer } = get();
                return historyPointer < history.length - 1;
            },

            processSyncQueue: async () => {
                const { syncQueue, settings, entities, addDebugLog } = get();
                if (!settings.sync_enabled || syncQueue.length === 0) return;

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

                set((state) => {
                    // SAVE HISTORY SNAPSHOT
                    const newHistory = state.history.slice(0, state.historyPointer + 1);
                    newHistory.push({
                        entities: state.entities,
                        relationships: state.relationships,
                        timestamp: Date.now()
                    });
                    if (newHistory.length > 20) newHistory.shift();
                    const newPointer = newHistory.length - 1;

                    let newEntities = [...(state.entities || [])];
                    let newRelationships = [...(state.relationships || [])];
                    let newUniversalTags = [...(state.universalTags || [])];

                    const sideEffectOps: ToonOperation[] = [];

                    ops.forEach(op => {
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
                                        canonical_tags: [],
                                        parent_id: resolvedParentId  // New: direct parent reference
                                    };
                                    newEntities.push(entity);

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

                                    // Google Calendar Sync: If entity is EVENT, sync to Google Calendar
                                    const storeSettings = get().settings;
                                    if (entity.kind === EntityKind.EVENT && storeSettings.sync_enabled) {
                                        GoogleCalendarAdapter.createEvent(entity, storeSettings).then(result => {
                                            if (result.success && result.externalId) {
                                                // Store external ID in metadata for future updates
                                                set(state => ({
                                                    entities: state.entities.map(e =>
                                                        e.id === entity.id
                                                            ? { ...e, metadata: { ...e.metadata, gcal_id: result.externalId } }
                                                            : e
                                                    )
                                                }));
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
                                    break;
                                }

                                case 'delete_entity': {
                                    let targetId = payload.id;
                                    if (!newEntities.find(e => e.id === targetId)) {
                                        targetId = resolveEntityId(payload.id, newEntities) || targetId;
                                    }

                                    // Remove from universal tags if applicable
                                    newUniversalTags = newUniversalTags.filter(t => t.id !== targetId);

                                    newEntities = newEntities.filter(e => e.id !== targetId);
                                    newRelationships = newRelationships.filter(r => r.from !== targetId && r.to !== targetId);
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

                                                // 2. Decrement usage count
                                                newUniversalTags = newUniversalTags.map(t =>
                                                    t.id === toId ? { ...t, usage_count: Math.max(0, (t.usage_count || 0) - 1) } : t
                                                );
                                            }
                                        }
                                    }
                                    break;
                                }

                                case 'delete_entity': {
                                    // SOFT DELETE: Mark as deleted instead of removing
                                    // This allows sync to propagate the deletion properly
                                    const entityId = payload.id || payload.entity_id;
                                    const resolvedId = resolveEntityId(entityId, newEntities);
                                    if (!resolvedId) {
                                        addDebugLog('system', 'delete_entity: Entity not found', { id: entityId });
                                        break;
                                    }

                                    newEntities = newEntities.map(e =>
                                        e.id === resolvedId
                                            ? {
                                                ...e,
                                                metadata: { ...e.metadata, deleted: true },
                                                updated_at: now
                                            }
                                            : e
                                    );

                                    // Also remove relationships involving this entity
                                    newRelationships = newRelationships.filter(
                                        r => r.from !== resolvedId && r.to !== resolvedId
                                    );

                                    addDebugLog('system', 'Soft-deleted entity', { id: resolvedId });
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

                                    // Store will add this to foodLogs after the switch
                                    // For now, we'll use a side effect
                                    setTimeout(() => {
                                        set(state => ({
                                            foodLogs: [...state.foodLogs, foodEntry]
                                        }));
                                    }, 0);

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

                    const currentSyncQueue = state.syncQueue || [];

                    return {
                        history: newHistory,
                        historyPointer: newPointer,
                        entities: newEntities,
                        relationships: newRelationships,
                        universalTags: newUniversalTags,
                        pendingOps: null,
                        syncQueue: [...currentSyncQueue, ...newSyncItems]
                    };
                });

                get().processSyncQueue();
            }
        }),
        {
            name: 'flowmate-storage',
            version: 14, // Bumped to 14 for Tag System
            migrate: (persistedState: any, version) => {
                const state = persistedState as Partial<FlowmateState>;

                // Strict safe initialization of arrays to prevent "map of undefined"
                const safeEntities = Array.isArray(state.entities) ? state.entities : [];
                const safeRelationships = Array.isArray(state.relationships) ? state.relationships : [];
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

                const mergedSettings = {
                    timezone: 'Asia/Kolkata', // Force IST fallback
                    preferred_model: 'gemini-2.5-flash',
                    sync_enabled: false,
                    debug_mode: false,
                    custom_instructions: '',
                    ...(state.settings || {})
                };

                return {
                    ...state,
                    settings: mergedSettings,
                    focusSession: state.focusSession || null,
                    dailyBriefing: state.dailyBriefing || null,
                    isHydrated: false,
                    isZenMode: false,
                    toasts: [],
                    showConfetti: false,
                    history: [],
                    historyPointer: -1,
                    // Deep sanitize entities
                    entities: safeEntities.map(e => ({
                        ...e,
                        recurrence: e.recurrence || null,
                        canonical_tags: Array.isArray(e.canonical_tags) ? e.canonical_tags : []
                    })),
                    relationships: safeRelationships,
                    universalTags: safeTags,
                    messages: safeMessages,
                    syncQueue: safeSyncQueue,
                    debugLogs: safeDebugLogs
                };
            },
            onRehydrateStorage: () => (state) => {
                state?.setHydrated(true);
            }
        }
    )
);
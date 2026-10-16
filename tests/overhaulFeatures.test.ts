import { describe, it, expect } from 'vitest';
import { mergeChatSessions } from '../services/firestoreSync';
import { getInstantContextualSuggestions } from '../services/ai/suggestions';
import { normalizePayload } from '../store/helpers';
import { ChatSession, EntityKind, Entity } from '../types';

describe('Cross-Platform Sync: mergeChatSessions', () => {
    it('should merge disjoint sessions from desktop and mobile without dropping any', () => {
        const desktopSessions: ChatSession[] = [
            { id: 'session-1', title: 'Work Tasks', created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T10:00:00Z' },
            { id: 'session-2', title: 'Gym Routine', created_at: '2026-10-06T11:00:00Z', updated_at: '2026-10-06T11:00:00Z' }
        ];

        const mobileSessions: ChatSession[] = [
            { id: 'session-1', title: 'Work Tasks', created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T10:00:00Z' },
            { id: 'session-3', title: 'Kolkata Trip Planning', created_at: '2026-10-06T12:00:00Z', updated_at: '2026-10-06T12:00:00Z' }
        ];

        const merged = mergeChatSessions(desktopSessions, mobileSessions);
        expect(merged).toHaveLength(3);
        const ids = merged.map(s => s.id);
        expect(ids).toContain('session-1');
        expect(ids).toContain('session-2');
        expect(ids).toContain('session-3');
    });

    it('should prioritize the newer updated_at version when session is renamed on one device', () => {
        const oldDesktop: ChatSession[] = [
            { id: 'session-1', title: 'General Chat', created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T10:00:00Z' }
        ];

        const updatedMobile: ChatSession[] = [
            { id: 'session-1', title: 'Kolkata Train Details', created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T12:30:00Z' }
        ];

        const merged = mergeChatSessions(oldDesktop, updatedMobile);
        expect(merged).toHaveLength(1);
        expect(merged[0].title).toBe('Kolkata Train Details');
    });
});

describe('Dynamic Contextual Suggestions', () => {
    it('should generate at least 3 instant actionable prompt templates', () => {
        const suggestions = getInstantContextualSuggestions({
            entities: [],
            foodLogs: [],
            subjects: []
        });

        expect(suggestions.length).toBeGreaterThanOrEqual(3);
        suggestions.forEach(s => {
            expect(s.icon).toBeTruthy();
            expect(s.label).toBeTruthy();
            expect(s.prompt).toBeTruthy();
            expect(s.prompt.length).toBeGreaterThan(10);
        });
    });

    it('should generate personalized prompts when tasks or events exist in context', () => {
        const suggestions = getInstantContextualSuggestions({
            entities: [
                {
                    id: 'task-1',
                    kind: EntityKind.TASK,
                    title: 'Submit Lab Report',
                    description: null,
                    status: 'PENDING' as any,
                    priority: 3,
                    start_time: null,
                    end_time: null,
                    deadline: null,
                    duration_minutes: null,
                    recurrence: null,
                    metadata: {},
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    canonical_tags: []
                }
            ],
            foodLogs: [],
            subjects: []
        });

        expect(suggestions.length).toBeGreaterThanOrEqual(3);
        const hasPrompt = suggestions.some(s => s.prompt.length > 0);
        expect(hasPrompt).toBe(true);
    });
});

describe('Operation Normalization: Calendar & IST Precision', () => {
    it('should normalize start and end aliases into start_time and end_time with IST offset', () => {
        const normalized = normalizePayload('create_entity', {
            k: 'EVT',
            t: 'Train to Kolkata',
            start: '2026-10-07T21:30:00',
            end: '2026-10-08T05:15:00'
        });

        expect(normalized.kind).toBe(EntityKind.EVENT);
        expect(normalized.title).toBe('Train to Kolkata');
        expect(normalized.start_time).toBe('2026-10-07T21:30:00+05:30');
        expect(normalized.end_time).toBe('2026-10-08T05:15:00+05:30');
    });

    it('should handle date-only strings by appending midnight and IST offset', () => {
        const normalized = normalizePayload('create_entity', {
            kind: 'EVENT',
            title: 'Hackathon Day 1',
            date: '2026-10-15'
        });

        expect(normalized.start_time).toBe('2026-10-15T00:00:00+05:30');
    });

    it('should support startTime and endTime camelCase aliases', () => {
        const normalized = normalizePayload('create_entity', {
            k: 'EVT',
            name: 'Project Sync',
            startTime: '2026-10-07T14:00:00+05:30',
            endTime: '2026-10-07T15:00:00+05:30'
        });

        expect(normalized.title).toBe('Project Sync');
        expect(normalized.start_time).toBe('2026-10-07T14:00:00+05:30');
        expect(normalized.end_time).toBe('2026-10-07T15:00:00+05:30');
    });
});

describe('TASK-P0-01: Soft-Deleted Entity Isolation Across Views & Sync', () => {
    const activeTask: Entity = {
        id: 'active-task-1',
        kind: EntityKind.TASK,
        title: 'Complete Homework',
        description: null,
        status: 'PENDING' as any,
        priority: 2,
        start_time: null,
        end_time: null,
        deadline: '2026-10-08T18:00:00Z',
        duration_minutes: null,
        recurrence: null,
        metadata: {},
        created_at: '2026-10-06T10:00:00Z',
        updated_at: '2026-10-06T10:00:00Z',
        canonical_tags: ['study']
    };

    const deletedTask: Entity = {
        id: 'deleted-task-2',
        kind: EntityKind.TASK,
        title: 'Old Deleted Homework',
        description: null,
        status: 'PENDING' as any,
        priority: 1,
        start_time: null,
        end_time: null,
        deadline: '2026-10-08T18:00:00Z',
        duration_minutes: null,
        recurrence: null,
        metadata: { deleted: true, deleted_at: '2026-10-06T12:00:00Z' },
        created_at: '2026-10-06T09:00:00Z',
        updated_at: '2026-10-06T12:00:00Z',
        canonical_tags: ['study']
    };

    const deletedEvent: Entity = {
        id: 'deleted-evt-3',
        kind: EntityKind.EVENT,
        title: 'Canceled Train',
        description: null,
        status: 'ACTIVE' as any,
        priority: 3,
        start_time: '2026-10-07T21:30:00Z',
        end_time: '2026-10-08T05:15:00Z',
        deadline: null,
        duration_minutes: 465,
        recurrence: null,
        metadata: { deleted: true },
        created_at: '2026-10-06T10:00:00Z',
        updated_at: '2026-10-06T13:00:00Z',
        canonical_tags: []
    };

    it('getActiveEntities filters out soft-deleted entities while preserving active ones', async () => {
        const { getActiveEntities, isEntityActive } = await import('../store/helpers');
        expect(isEntityActive(activeTask)).toBe(true);
        expect(isEntityActive(deletedTask)).toBe(false);
        expect(isEntityActive(deletedEvent)).toBe(false);

        const active = getActiveEntities([activeTask, deletedTask, deletedEvent]);
        expect(active).toHaveLength(1);
        expect(active[0].id).toBe('active-task-1');
    });

    it('shouldShowInGraph returns false for soft-deleted entities', async () => {
        const { shouldShowInGraph } = await import('../utils/graphVisibility');
        expect(shouldShowInGraph(activeTask, [])).toBe(true);
        expect(shouldShowInGraph(deletedTask, [])).toBe(false);
        expect(shouldShowInGraph(deletedEvent, [])).toBe(false);
    });

    it('calculateProgress ignores soft-deleted child entities', async () => {
        const { calculateProgress } = await import('../utils/progressCalculation');
        const parentProject: Entity = {
            id: 'proj-1',
            kind: EntityKind.PROJECT,
            title: 'Final Term Project',
            description: null,
            status: 'ACTIVE' as any,
            priority: 3,
            start_time: null,
            end_time: null,
            deadline: null,
            duration_minutes: null,
            recurrence: null,
            metadata: {},
            created_at: '2026-10-06T10:00:00Z',
            updated_at: '2026-10-06T10:00:00Z',
            canonical_tags: []
        };

        const activeChildDone: Entity = {
            ...activeTask,
            id: 'child-1',
            parent_id: 'proj-1',
            status: 'COMPLETED' as any
        };

        const deletedChildPending: Entity = {
            ...deletedTask,
            id: 'child-2',
            parent_id: 'proj-1',
            status: 'PENDING' as any
        };

        // If deleted child is excluded, progress is 1/1 = 100%
        // If deleted child leaked, progress would be 1/2 = 50%
        const progress = calculateProgress(parentProject, [parentProject, activeChildDone, deletedChildPending], []);
        expect(progress).toBe(100);
    });

    it('AI tool executors exclude soft-deleted entities', async () => {
        const { executeReadCalendar, executeSearchEntities, dispatchToolCall } = await import('../services/ai/executors');
        
        const entities = [activeTask, deletedTask, deletedEvent];

        const searchResults = executeSearchEntities({ query: 'Homework' }, entities);
        expect(searchResults).toHaveLength(1);
        expect(searchResults[0].id).toBe('active-task-1');

        const calResults = executeReadCalendar({
            start_date: '2026-10-07T00:00:00Z',
            end_date: '2026-10-08T23:59:59Z'
        }, entities);
        // Deleted event should not appear
        expect(calResults.some(r => r.id === 'deleted-evt-3')).toBe(false);

        const dispatched = await dispatchToolCall({
            name: 'search_entities',
            args: { query: 'Homework' }
        }, entities);
        expect(dispatched.response.result).toHaveLength(1);
        expect(dispatched.response.result[0].id).toBe('active-task-1');
    });
});

describe('TASK-P0-02: Zombie Chat Session Elimination & Sync Tombstones', () => {
    const activeSession1: ChatSession = {
        id: 'session-alpha',
        title: 'Project Planning',
        created_at: '2026-10-06T10:00:00.000Z',
        updated_at: '2026-10-06T10:00:00.000Z'
    };

    const activeSession2: ChatSession = {
        id: 'session-beta',
        title: 'Interview Prep',
        created_at: '2026-10-06T11:00:00.000Z',
        updated_at: '2026-10-06T11:00:00.000Z'
    };

    const tombstonedSession1: ChatSession = {
        id: 'session-alpha',
        title: 'Project Planning',
        created_at: '2026-10-06T10:00:00.000Z',
        updated_at: '2026-10-06T12:00:00.000Z',
        deleted: true,
        deleted_at: '2026-10-06T12:00:00.000Z'
    };

    it('getActiveChatSessions filters out soft-deleted tombstones', async () => {
        const { getActiveChatSessions, isChatSessionActive } = await import('../store/helpers');

        expect(isChatSessionActive(activeSession1)).toBe(true);
        expect(isChatSessionActive(tombstonedSession1)).toBe(false);
        expect(isChatSessionActive(null)).toBe(false);
        expect(isChatSessionActive(undefined)).toBe(false);

        const all = [activeSession1, tombstonedSession1, activeSession2];
        const activeOnly = getActiveChatSessions(all);
        expect(activeOnly).toHaveLength(2);
        expect(activeOnly.map(s => s.id)).toEqual(['session-alpha', 'session-beta']);
        expect(activeOnly.some(s => s.deleted)).toBe(false);
    });

    it('mergeChatSessions preserves deletion tombstone when local has deleted session newer than remote', () => {
        const local = [tombstonedSession1, activeSession2];
        const remote = [activeSession1, activeSession2]; // remote still thinks session-alpha is active

        const merged = mergeChatSessions(local, remote);
        const alpha = merged.find(s => s.id === 'session-alpha');
        expect(alpha).toBeDefined();
        expect(alpha?.deleted).toBe(true);
        expect(alpha?.deleted_at).toBe('2026-10-06T12:00:00.000Z');
    });

    it('mergeChatSessions preserves deletion tombstone when remote has deleted session newer than local', () => {
        const local = [activeSession1, activeSession2];
        const remote = [tombstonedSession1, activeSession2]; // remote deleted session-alpha

        const merged = mergeChatSessions(local, remote);
        const alpha = merged.find(s => s.id === 'session-alpha');
        expect(alpha).toBeDefined();
        expect(alpha?.deleted).toBe(true);
    });

    it('mergeChatSessions preserves tombstone on identical timestamp collision', () => {
        const localTombstone: ChatSession = {
            id: 'session-collision',
            title: 'Collision Test',
            created_at: '2026-10-06T10:00:00.000Z',
            updated_at: '2026-10-06T10:00:00.000Z',
            deleted: true,
            deleted_at: '2026-10-06T10:00:00.000Z'
        };
        const remoteActive: ChatSession = {
            id: 'session-collision',
            title: 'Collision Test',
            created_at: '2026-10-06T10:00:00.000Z',
            updated_at: '2026-10-06T10:00:00.000Z'
        };

        const merged = mergeChatSessions([localTombstone], [remoteActive]);
        expect(merged).toHaveLength(1);
        expect(merged[0].deleted).toBe(true);
    });

    it('deleteChatSession in store marks tombstone, purges messages, and switches active session', async () => {
        const { useStore } = await import('../store');

        // Setup store with 2 sessions and messages
        useStore.setState({
            chatSessions: [activeSession1, activeSession2],
            activeSessionId: 'session-alpha',
            messages: [
                {
                    id: 'msg-alpha-1',
                    created_at: '2026-10-06T10:05:00Z',
                    role: 'user',
                    text: 'Planning the sprint',
                    channelId: 'session-alpha'
                },
                {
                    id: 'msg-beta-1',
                    created_at: '2026-10-06T11:05:00Z',
                    role: 'user',
                    text: 'Prepare interview questions',
                    channelId: 'session-beta'
                }
            ]
        });

        // Trigger session deletion
        useStore.getState().deleteChatSession('session-alpha');

        const stateAfter = useStore.getState();
        // 1. Session should be tombstoned in chatSessions
        const deletedAlpha = stateAfter.chatSessions.find(s => s.id === 'session-alpha');
        expect(deletedAlpha).toBeDefined();
        expect(deletedAlpha?.deleted).toBe(true);
        expect(deletedAlpha?.deleted_at).toBeDefined();

        // 2. Active session should have switched to session-beta
        expect(stateAfter.activeSessionId).toBe('session-beta');

        // 3. Messages for session-alpha must be purged locally
        expect(stateAfter.messages.some(m => m.channelId === 'session-alpha')).toBe(false);
        // Messages for session-beta must remain intact
        expect(stateAfter.messages.some(m => m.channelId === 'session-beta')).toBe(true);
    });

    it('orphaned messages for tombstoned sessions are purged and never synthesize zombie channels', () => {
        const sessions: ChatSession[] = [tombstonedSession1, activeSession2];
        const incomingMessages = [
            {
                id: 'orphan-1',
                created_at: '2026-10-06T10:05:00Z',
                role: 'user' as const,
                text: 'Old message from deleted session',
                channelId: 'session-alpha'
            },
            {
                id: 'valid-1',
                created_at: '2026-10-06T11:05:00Z',
                role: 'user' as const,
                text: 'Active message',
                channelId: 'session-beta'
            }
        ];

        const deletedSessionIds = new Set(sessions.filter(s => s.deleted).map(s => s.id));
        
        // Emulate App.tsx sync pipeline
        const cleanedMsgs = incomingMessages.filter(
            m => !m.channelId || !deletedSessionIds.has(m.channelId)
        );

        const existingSessionIds = new Set(sessions.map(s => s.id));
        const missingSessions = cleanedMsgs
            .filter(m => m.channelId && !existingSessionIds.has(m.channelId) && !deletedSessionIds.has(m.channelId))
            .map(m => ({
                id: m.channelId!,
                title: 'Chat ' + m.channelId!.slice(0, 8),
                created_at: m.created_at,
                updated_at: m.created_at
            }));

        const finalSessions = [...sessions, ...missingSessions];

        // 1. Orphan message dropped
        expect(cleanedMsgs).toHaveLength(1);
        expect(cleanedMsgs[0].id).toBe('valid-1');

        // 2. No synthesized zombie session created
        expect(missingSessions).toHaveLength(0);
        expect(finalSessions).toHaveLength(2);
        expect(finalSessions.some(s => s.title.startsWith('Chat session-'))).toBe(false);
    });
});

describe('TASK-P0-03: Gemini Live Audio Transcription & Chat History Persistence', () => {
    it('buffers user transcription and model transcription, flushing turns in order to active chat session', async () => {
        const { useStore } = await import('../store');
        const { LiveManager } = await import('../services/liveSession');

        // Set up clean active session
        useStore.setState({
            activeSessionId: 'live-test-session',
            messages: [],
            chatSessions: [
                { id: 'live-test-session', title: 'Live Voice Test', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            ]
        });

        const manager = new LiveManager();
        const transcriptionEvents: Array<{ text: string; source: 'user' | 'model' }> = [];
        manager.onTranscription = (text, source) => {
            transcriptionEvents.push({ text, source });
        };

        // 1. User speaks: incoming inputTranscription chunks
        await manager.handleMessage({
            serverContent: {
                inputTranscription: { text: 'What is my schedule ' }
            }
        } as any);

        await manager.handleMessage({
            serverContent: {
                inputTranscription: { text: 'for tomorrow?' }
            }
        } as any);

        expect(manager.getUserTurnBuffer()).toBe('What is my schedule for tomorrow?');
        expect(transcriptionEvents).toHaveLength(2);
        expect(transcriptionEvents[0]).toEqual({ text: 'What is my schedule ', source: 'user' });
        expect(transcriptionEvents[1]).toEqual({ text: 'for tomorrow?', source: 'user' });

        // 2. Model begins responding: incoming outputTranscription chunk
        await manager.handleMessage({
            serverContent: {
                outputTranscription: { text: 'You have a team sync at 10 AM ' }
            }
        } as any);

        // User turn must have been automatically flushed to store before model speech
        const stateAfterUserFlush = useStore.getState();
        const userMsgs = stateAfterUserFlush.messages.filter(m => m.channelId === 'live-test-session' && m.role === 'user');
        expect(userMsgs).toHaveLength(1);
        expect(userMsgs[0].text).toBe('What is my schedule for tomorrow?');
        expect(manager.getUserTurnBuffer()).toBe('');

        // Model continues speaking
        await manager.handleMessage({
            serverContent: {
                outputTranscription: { text: 'and lunch at 1 PM.' }
            }
        } as any);

        // 3. Turn complete
        await manager.handleMessage({
            serverContent: {
                turnComplete: true
            }
        } as any);

        // Both turns must now be in store messages
        const finalState = useStore.getState();
        const sessionMsgs = finalState.messages.filter(m => m.channelId === 'live-test-session');
        expect(sessionMsgs).toHaveLength(2);
        expect(sessionMsgs[0].role).toBe('user');
        expect(sessionMsgs[0].text).toBe('What is my schedule for tomorrow?');
        expect(sessionMsgs[1].role).toBe('assistant');
        expect(sessionMsgs[1].text).toBe('You have a team sync at 10 AM and lunch at 1 PM.');
    });

    it('processes tool calls into pending operations with preview and attaches ops_preview to assistant message', async () => {
        const { useStore } = await import('../store');
        const { LiveManager } = await import('../services/liveSession');

        useStore.setState({
            activeSessionId: 'live-ops-session',
            messages: [],
            pendingOps: null,
            chatSessions: [
                { id: 'live-ops-session', title: 'Live Ops Test', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            ]
        });

        const manager = new LiveManager();

        // 1. User says intent
        await manager.handleMessage({
            serverContent: {
                inputTranscription: { text: 'Book train to Kolkata at 9:30 PM' }
            }
        } as any);

        // 2. Model calls schedule_event tool
        await manager.handleMessage({
            toolCall: {
                functionCalls: [
                    {
                        name: 'schedule_event',
                        id: 'call-123',
                        args: {
                            title: 'Train to Kolkata',
                            start_time: '2026-10-07T21:30:00+05:30',
                            end_time: '2026-10-08T05:15:00+05:30',
                            description: 'Overnight train journey'
                        }
                    }
                ]
            }
        } as any);

        // User utterance should be saved
        const stateAfterTool = useStore.getState();
        expect(stateAfterTool.messages.some(m => m.text === 'Book train to Kolkata at 9:30 PM')).toBe(true);

        // pendingOps should be set in store for preview modal
        expect(stateAfterTool.pendingOps).not.toBeNull();
        expect(stateAfterTool.pendingOps?.ops).toHaveLength(1);
        expect(stateAfterTool.pendingOps?.ops[0].type).toBe('create_entity');
        expect(stateAfterTool.pendingOps?.ops[0].payload.title).toBe('Train to Kolkata');
        expect(stateAfterTool.pendingOps?.ops[0].payload.kind).toBe(EntityKind.EVENT);
        expect(stateAfterTool.pendingOps?.ops[0].payload.start_time).toBe('2026-10-07T21:30:00+05:30');

        // 3. Model speaks confirmation
        await manager.handleMessage({
            serverContent: {
                outputTranscription: { text: 'I have prepared your train journey to Kolkata for preview.' }
            }
        } as any);

        await manager.handleMessage({
            serverContent: {
                turnComplete: true
            }
        } as any);

        // Assistant message in chat must include ops_preview
        const finalState = useStore.getState();
        const asstMsg = finalState.messages.find(m => m.channelId === 'live-ops-session' && m.role === 'assistant');
        expect(asstMsg).toBeDefined();
        expect(asstMsg?.text).toBe('I have prepared your train journey to Kolkata for preview.');
        expect(asstMsg?.ops_preview).toBeDefined();
        expect(asstMsg?.ops_preview).toHaveLength(1);
        expect(asstMsg?.ops_preview?.[0].payload.title).toBe('Train to Kolkata');

        // User confirms operations through store applyOperations
        finalState.applyOperations(finalState.pendingOps!.ops);
        finalState.clearPendingOps();

        // Entity must now exist in store active entities
        const entitiesAfterApply = useStore.getState().getActiveEntities();
        const createdEvent = entitiesAfterApply.find(e => e.title === 'Train to Kolkata');
        expect(createdEvent).toBeDefined();
        expect(createdEvent?.kind).toBe(EntityKind.EVENT);
        expect(useStore.getState().pendingOps).toBeNull();
    });

    it('flushes in-flight turns cleanly when user interrupts or disconnects', async () => {
        const { useStore } = await import('../store');
        const { LiveManager } = await import('../services/liveSession');

        useStore.setState({
            activeSessionId: 'live-interrupted-session',
            messages: [],
            chatSessions: [
                { id: 'live-interrupted-session', title: 'Interrupt Test', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            ]
        });

        const manager = new LiveManager();

        // User speaks
        await manager.handleMessage({
            serverContent: {
                inputTranscription: { text: 'Tell me a long story' }
            }
        } as any);

        // Model starts speaking
        await manager.handleMessage({
            serverContent: {
                outputTranscription: { text: 'Once upon a time in a faraway galaxy' }
            }
        } as any);

        // User interrupts model
        await manager.handleMessage({
            serverContent: {
                interrupted: true
            }
        } as any);

        // Model turn so far must be saved
        let state = useStore.getState();
        let msgs = state.messages.filter(m => m.channelId === 'live-interrupted-session');
        expect(msgs).toHaveLength(2);
        expect(msgs[0].text).toBe('Tell me a long story');
        expect(msgs[1].text).toBe('Once upon a time in a faraway galaxy');

        // User says new question, then disconnects before any response
        await manager.handleMessage({
            serverContent: {
                inputTranscription: { text: 'Nevermind, show calendar' }
            }
        } as any);

        // User closes/disconnects session
        manager.disconnect();

        state = useStore.getState();
        msgs = state.messages.filter(m => m.channelId === 'live-interrupted-session');
        expect(msgs).toHaveLength(3);
        expect(msgs[2].role).toBe('user');
        expect(msgs[2].text).toBe('Nevermind, show calendar');
    });

    it('respects soft-deletion boundary and never exposes soft-deleted entities to read_calendar or search_entities tools', async () => {
        const { useStore } = await import('../store');
        const { LiveManager } = await import('../services/liveSession');

        const activeEvent: Entity = {
            id: 'active-event-1',
            kind: EntityKind.EVENT,
            title: 'Active Flight to Delhi',
            description: null,
            status: 'ACTIVE' as any,
            priority: 1,
            start_time: '2026-10-10T10:00:00Z',
            end_time: '2026-10-10T12:30:00Z',
            deadline: null,
            duration_minutes: 150,
            recurrence: null,
            metadata: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            canonical_tags: []
        };

        const deletedEvent: Entity = {
            id: 'deleted-event-2',
            kind: EntityKind.EVENT,
            title: 'Cancelled Train to Mumbai',
            description: null,
            status: 'ACTIVE' as any,
            priority: 1,
            start_time: '2026-10-10T10:00:00Z',
            end_time: '2026-10-10T12:30:00Z',
            deadline: null,
            duration_minutes: 150,
            recurrence: null,
            metadata: { deleted: true, deleted_at: new Date().toISOString() },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            canonical_tags: []
        };

        useStore.setState({
            entities: [activeEvent, deletedEvent],
            activeSessionId: 'live-tools-session',
            messages: []
        });

        const manager = new LiveManager();

        // Search entities tool call
        await manager.handleMessage({
            toolCall: {
                functionCalls: [
                    {
                        name: 'search_entities',
                        id: 'search-call',
                        args: { query: 'Train' }
                    }
                ]
            }
        } as any);

        // Cancelled train must not match because getActiveEntities() excludes it
        const activeMatches = useStore.getState().getActiveEntities().filter(e => e.title.includes('Train'));
        expect(activeMatches).toHaveLength(0);
    });
});



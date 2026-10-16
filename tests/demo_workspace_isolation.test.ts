import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { loadSyntheticDemoData, exitSyntheticDemoData, resetSyntheticDemoData } from './fixtures/syntheticWorkspaceData';
import { isDemoSyncBlocked, setDemoModeSyncBlock } from '../services/syncManager';
import { syncEntities, saveUserData, saveMessage, saveChatSessions, deleteChannelMessages } from '../services/firestoreSync';
import { GoogleCalendarAdapter } from '../services/googleSync';
import { EntityKind, EntityStatus, Entity, Relationship, RelationshipType, Message, ChatSession, SyncQueueItem } from '../types';
import { KernelEntity } from '../services/kernel/types';

describe('P0-B Demo Workspace Isolation & Personal State Boundary', () => {
  const initialPersonalEntities: Entity[] = [
    {
      id: 'personal-task-1',
      kind: EntityKind.TASK,
      title: 'Personal Confidential Task',
      description: 'Private personal user task',
      status: EntityStatus.ACTIVE,
      priority: 4,
      start_time: null,
      end_time: null,
      deadline: '2026-10-20T10:00:00Z',
      duration_minutes: 60,
      recurrence: null,
      canonical_tags: ['private', 'personal'],
      metadata: { secretNote: 'do-not-leak' },
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    },
    {
      id: 'personal-goal-1',
      kind: EntityKind.GOAL,
      title: 'Private Life Goal',
      description: 'Personal aspiration',
      status: EntityStatus.ACTIVE,
      priority: 5,
      start_time: null,
      end_time: null,
      deadline: '2027-01-01T00:00:00Z',
      duration_minutes: null,
      recurrence: null,
      canonical_tags: ['life'],
      metadata: { progress: 30 },
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    },
  ];

  const initialPersonalRelationships: Relationship[] = [
    {
      id: 'rel-personal-1',
      from: 'personal-task-1',
      to: 'personal-goal-1',
      type: RelationshipType.FULFILLS,
      meta: {},
      created_at: '2026-10-01T00:00:00Z',
    },
  ];

  const initialPersonalKernel: Record<string, KernelEntity> = {
    'personal-task-1': {
      id: 'personal-task-1',
      schema_id: 'system/task',
      version: 1,
      title: 'Personal Confidential Task',
      attributes: {
        kind: 'TASK',
        priority: 4,
        deadline: '2026-10-20T10:00:00Z',
        tags: ['private', 'personal'],
      },
      lifecycle: {
        status: 'active',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        deleted_at: null,
      },
      provenance: {
        source_type: 'user',
        observed_at: '2026-10-01T00:00:00Z',
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    },
  };

  const initialPersonalMessages: Message[] = [
    {
      id: 'msg-p1',
      role: 'user',
      text: 'Confidential personal chat message',
      created_at: '2026-10-15T00:00:00Z',
      channelId: 'p-sess-1',
    },
  ];

  const initialPersonalSessions: ChatSession[] = [
    {
      id: 'p-sess-1',
      title: 'Personal Session',
      created_at: '2026-10-15T00:00:00Z',
      updated_at: '2026-10-15T00:00:00Z',
    },
  ];

  const initialPersonalSyncQueue: SyncQueueItem[] = [
    {
      id: 'sq-1',
      op: {
        type: 'create_entity',
        payload: initialPersonalEntities[0],
      },
      status: 'pending',
      attempts: 0,
      created_at: '2026-10-15T00:00:00Z',
    },
  ];

  beforeEach(() => {
    // Reset store to known personal baseline
    setDemoModeSyncBlock(false);
    useStore.setState({
      isDemoMode: false,
      personalSnapshot: null,
      entities: initialPersonalEntities,
      relationships: initialPersonalRelationships,
      kernelEntities: initialPersonalKernel,
      messages: initialPersonalMessages,
      chatSessions: initialPersonalSessions,
      activeSessionId: 'p-sess-1',
      syncQueue: initialPersonalSyncQueue,
      universalTags: [
        { id: 'tag-1', title: 'private', kind: EntityKind.TAG, usage_count: 1 },
      ],
      selectedEntityId: 'personal-task-1',
    });
  });

  it('1. Enters demo mode, snapshots personal data, and isolates active workspace', async () => {
    loadSyntheticDemoData();

    const state = useStore.getState();
    expect(state.isDemoMode).toBe(true);
    expect(state.personalSnapshot).not.toBeNull();

    // Verify personal snapshot preserved exact personal entities, relationships, messages, sessions, syncQueue
    expect(state.personalSnapshot?.entities).toHaveLength(2);
    expect(state.personalSnapshot?.entities[0].id).toBe('personal-task-1');
    expect(state.personalSnapshot?.relationships).toHaveLength(1);
    expect(state.personalSnapshot?.messages).toHaveLength(1);
    expect(state.personalSnapshot?.messages?.[0].text).toBe('Confidential personal chat message');
    expect(state.personalSnapshot?.chatSessions).toHaveLength(1);
    expect(state.personalSnapshot?.activeSessionId).toBe('p-sess-1');
    expect(state.personalSnapshot?.syncQueue).toHaveLength(1);

    // Verify active store now holds synthetic demo entities
    const activeIds = state.entities.map(e => e.id);
    expect(activeIds).toContain('synthetic-demo-task');
    expect(activeIds).not.toContain('personal-task-1');
  });

  it('2. Blocks synchronization and filters demo entities across all cloud adapters', async () => {
    loadSyntheticDemoData();
    expect(useStore.getState().isDemoMode).toBe(true);

    // Sync manager must report demo block active
    expect(isDemoSyncBlocked()).toBe(true);

    // Firestore syncEntities: honest domain contract returns false (remote sync was blocked)
    const demoEntities = useStore.getState().entities;
    const syncResult = await syncEntities('test-user-id', demoEntities);
    expect(syncResult).toBe(false);

    // saveUserData: blocked when demo sync block active
    const saveResult = await saveUserData('test-user-id', {
      entities: demoEntities,
      relationships: [],
    });
    expect(saveResult).toBe(false);

    // saveMessage: blocked when demo sync block active
    const msgResult = await saveMessage('test-user-id', {
      id: 'demo-msg-1',
      role: 'user',
      text: 'demo message',
      created_at: new Date().toISOString(),
    });
    expect(msgResult).toBe(false);

    // saveChatSessions: blocked when demo sync block active
    const sessionsResult = await saveChatSessions('test-user-id', [
      { id: 'demo-session-1', title: 'Demo Session', created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' },
    ]);
    expect(sessionsResult).toBe(false);

    // deleteChannelMessages: blocked when demo sync block active
    const deleteResult = await deleteChannelMessages('test-user-id', 'demo-session-1');
    expect(deleteResult).toBe(false);

    // Google Calendar Adapter: blocked when demo entity or demo sync block active
    const gcalCreateResult = await GoogleCalendarAdapter.createEvent({
      id: 'demo-event-1',
      kind: EntityKind.EVENT,
      title: 'Synthetic Demo Event',
      description: 'Demo event',
      start_time: '2026-10-15T14:00:00Z',
      end_time: '2026-10-15T15:00:00Z',
      deadline: null,
      status: EntityStatus.ACTIVE,
      priority: 3,
      duration_minutes: 60,
      recurrence: null,
      canonical_tags: ['demo'],
      metadata: {},
      created_at: '2026-10-15T00:00:00Z',
      updated_at: '2026-10-15T00:00:00Z',
    });
    expect(gcalCreateResult.success).toBe(false);

    const gcalImportResult = await GoogleCalendarAdapter.importFromGoogleCalendar(demoEntities);
    expect(gcalImportResult).toEqual([]);
  });

  it('3. Repeated demo entry or reset preserves original personal snapshot', async () => {
    loadSyntheticDemoData();
    const firstSnapshot = useStore.getState().personalSnapshot;

    // Call load again while already in demo mode
    loadSyntheticDemoData();
    expect(useStore.getState().personalSnapshot).toBe(firstSnapshot);

    // Call reset demo workspace
    resetSyntheticDemoData();
    expect(useStore.getState().isDemoMode).toBe(true);
    expect(useStore.getState().personalSnapshot).toBe(firstSnapshot);
    expect(useStore.getState().personalSnapshot?.entities[0].id).toBe('personal-task-1');
  });

  it('4. Exits demo mode and restores byte/semantic-equivalent personal state', async () => {
    const originalJson = JSON.stringify({
      entities: useStore.getState().entities,
      relationships: useStore.getState().relationships,
      kernelEntities: useStore.getState().kernelEntities,
      messages: useStore.getState().messages,
      chatSessions: useStore.getState().chatSessions,
      activeSessionId: useStore.getState().activeSessionId,
      syncQueue: useStore.getState().syncQueue,
    });

    loadSyntheticDemoData();
    expect(useStore.getState().isDemoMode).toBe(true);
    expect(isDemoSyncBlocked()).toBe(true);

    await exitSyntheticDemoData();

    const restoredState = useStore.getState();
    expect(restoredState.isDemoMode).toBe(false);
    expect(restoredState.personalSnapshot).toBeNull();
    expect(isDemoSyncBlocked()).toBe(false);

    const restoredJson = JSON.stringify({
      entities: restoredState.entities,
      relationships: restoredState.relationships,
      kernelEntities: restoredState.kernelEntities,
      messages: restoredState.messages,
      chatSessions: restoredState.chatSessions,
      activeSessionId: restoredState.activeSessionId,
      syncQueue: restoredState.syncQueue,
    });

    // Byte/semantic equivalence assertion
    expect(restoredJson).toBe(originalJson);
    expect(restoredState.entities).toHaveLength(2);
    expect(restoredState.entities[0].title).toBe('Personal Confidential Task');
    expect(restoredState.messages).toHaveLength(1);
    expect(restoredState.messages[0].text).toBe('Confidential personal chat message');
    expect(restoredState.selectedEntityId).toBe('personal-task-1');
  });

  it('5. Partialize persists personal snapshot during demo mode so reload never saves demo data', async () => {
    loadSyntheticDemoData();
    expect(useStore.getState().isDemoMode).toBe(true);

    // Verify partialize behavior:
    // If the browser reloads while in demo mode, partialize must emit the personal data, not the demo data.
    const persistOptions = (useStore as any).persist?.getOptions();
    if (persistOptions?.partialize) {
      const persisted = persistOptions.partialize(useStore.getState());
      const persistedEntityIds = (persisted.entities as Entity[]).map(e => e.id);
      expect(persistedEntityIds).toContain('personal-task-1');
      expect(persistedEntityIds).not.toContain('synthetic-demo-task');
      expect(persisted.messages).toHaveLength(1);
      expect((persisted.messages as Message[])[0].text).toBe('Confidential personal chat message');
    }
  });
});

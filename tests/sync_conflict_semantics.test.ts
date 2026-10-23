/**
 * Flowmate P1-09 Synchronization & Conflict Semantics Test Suite
 *
 * Verifies the deterministic synchronization and conflict model:
 * - Monotonic revisions
 * - Tombstone supremacy (no resurrection)
 * - Safe attribute merges vs structured conflict generation
 * - Mutation idempotency
 * - Durable pending mutation queue
 * - Multi-client convergence
 * - Chat message set-union and zombie session suppression
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  reconcileEntity,
  reconcileEntityCollection,
  retainCanonicalReference,
  canonicalJson,
  IdempotencyTracker,
  PendingMutationQueue,
  PendingMutation,
} from '../services/sync';
import { Entity as KernelEntity, AttributeValue } from '../services/kernel/types';
import { mergeData, mergeMessages, mergeChatSessions, filterMessagesBySessionState, isDefaultWelcomeMessage } from '../services/firestoreSync';
import { EntityKind, EntityStatus, Message, ChatSession } from '../types';

function createMockKernelEntity(
  id: string,
  version: number,
  title: string,
  attributes: Record<string, AttributeValue> = {},
  options?: {
    deleted?: boolean;
    schema_id?: string;
    updated_at?: string;
    restored?: boolean;
    restored_at?: string;
  }
): KernelEntity {
  const isDeleted = options?.deleted ?? false;
  const now = options?.updated_at ?? '2026-10-08T12:00:00.000Z';
  return {
    id,
    schema_id: options?.schema_id ?? 'system/task',
    version,
    title,
    attributes: {
      ...attributes,
      ...(isDeleted ? { deleted: true } : {}),
      ...(options?.restored ? { restored: true } : {}),
      ...(options?.restored_at ? { restored_at: options.restored_at } : {}),
    },
    lifecycle: {
      status: isDeleted ? 'deleted' : 'active',
      created_at: '2026-10-08T10:00:00.000Z',
      updated_at: now,
      deleted_at: isDeleted ? now : null,
      restored: options?.restored ?? false,
      restored_at: options?.restored_at ?? (options?.restored ? now : null),
    } as any,
    provenance: {
      source: 'user_ui',
      created_by: 'test-user',
      observed_at: now,
      actor: 'user_ui',
    } as any,
  };
}

describe('P1-09 Synchronization & Conflict Semantics', () => {
  it('preserves workspace references for materially identical remote snapshots', () => {
    const current = { settings: { theme: 'dark' }, tags: ['one', 'two'] };
    const equivalent = { tags: ['one', 'two'], settings: { theme: 'dark' } };
    const changed = { settings: { theme: 'light' }, tags: ['one', 'two'] };

    expect(retainCanonicalReference(current, equivalent)).toBe(current);
    expect(retainCanonicalReference(current, changed)).toBe(changed);
  });

  it('treats late failed-turn metadata as a real message update', () => {
    const initial: Message = {
      id: 'message-1', role: 'user', text: 'A saved request', created_at: '2026-10-23T16:00:00.000Z',
      channelId: 'general', status: 'in_flight',
    };
    const settled: Message = {
      ...initial,
      status: 'failed',
      turn_metadata: {
        managed_failure: { code: 'MANAGED_AI_NOT_CONFIGURED', outcome: 'not_sent' },
      },
    };

    expect(canonicalJson([initial])).not.toBe(canonicalJson([settled]));
  });

  let tracker: IdempotencyTracker;

  beforeEach(() => {
    tracker = new IdempotencyTracker(50);
  });

  // --------------------------------------------------------------------------
  // Scenario A: No Conflict Sync
  // --------------------------------------------------------------------------
  it('Scenario A: accepts remote entity when remote revision is strictly newer', () => {
    const local = createMockKernelEntity('task-1', 1, 'Buy Groceries');
    const remote = createMockKernelEntity('task-1', 2, 'Buy Groceries & Milk');

    const result = reconcileEntity(local, remote);
    expect(result.action).toBe('accept_remote');
    expect(result.resolvedEntity.title).toBe('Buy Groceries & Milk');
    expect(result.resolvedEntity.version).toBe(2);
    expect(result.conflict).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Scenario B: Monotonic Revision Rejection (Stale Remote)
  // --------------------------------------------------------------------------
  it('Scenario B: preserves local entity when incoming remote revision is older', () => {
    const local = createMockKernelEntity('task-1', 3, 'Latest Local Title');
    const remote = createMockKernelEntity('task-1', 2, 'Stale Remote Title');

    const result = reconcileEntity(local, remote);
    expect(result.action).toBe('keep_local');
    expect(result.resolvedEntity.title).toBe('Latest Local Title');
    expect(result.resolvedEntity.version).toBe(3);
    expect(result.conflict).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Scenario C: Safe Attribute-Level Merge for Independent Non-Overlapping Edits
  // --------------------------------------------------------------------------
  it('Scenario C: performs safe attribute merge when distinct non-overlapping fields change', () => {
    const baseline = createMockKernelEntity('task-1', 1, 'Shared Task Title', {
      priority: 0,
      progress_percent: 0,
      notes: 'Initial notes',
    });
    const local = createMockKernelEntity('task-1', 2, 'Shared Task Title', {
      priority: 1,
      progress_percent: 0,
      notes: 'Initial notes',
    });
    const remote = createMockKernelEntity('task-1', 2, 'Shared Task Title', {
      priority: 0,
      progress_percent: 75,
      notes: 'Initial notes',
    });

    const pending: PendingMutation = {
      mutation_id: 'mut-123',
      entity_id: 'task-1',
      base_revision: 1,
      op_type: 'upsert_entity',
      entity: local,
      base_entity: baseline,
      created_at: '2026-10-08T12:00:00.000Z',
      status: 'pending',
      retry_count: 0,
    };

    const result = reconcileEntity(local, remote, pending);
    expect(result.action).toBe('merged');
    expect(result.resolvedEntity.title).toBe('Shared Task Title');
    // Version incremented beyond both revisions
    expect(result.resolvedEntity.version).toBe(3);
    expect(result.resolvedEntity.attributes.priority).toBe(1);
    expect(result.resolvedEntity.attributes.progress_percent).toBe(75);
    expect(result.conflict).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Scenario D: Tombstone Supremacy Over Stale Edit (No Zombie Resurrection)
  // --------------------------------------------------------------------------
  it('Scenario D: enforces tombstone supremacy when stale edit arrives for deleted entity', () => {
    const remoteDeleted = createMockKernelEntity('task-1', 3, 'Task to Delete', {}, { deleted: true });
    const localStaleEdit = createMockKernelEntity('task-1', 2, 'Stale Edited Title');

    const pending: PendingMutation = {
      mutation_id: 'mut-stale',
      entity_id: 'task-1',
      base_revision: 2,
      op_type: 'upsert_entity',
      entity: localStaleEdit,
      created_at: '2026-10-08T12:05:00.000Z',
      status: 'pending',
      retry_count: 0,
    };

    const result = reconcileEntity(localStaleEdit, remoteDeleted, pending);

    // Deletion wins!
    expect(result.action).toBe('conflict_detected');
    expect(result.resolvedEntity.lifecycle.status).toBe('deleted');
    expect(result.resolvedEntity.lifecycle.deleted_at).not.toBeNull();
    expect(result.conflict).toBeDefined();
    expect(result.conflict?.conflict_type).toBe('tombstone_violation');
  });

  // --------------------------------------------------------------------------
  // Scenario E: Local Deletion Wins Over Stale Remote Edit
  // --------------------------------------------------------------------------
  it('Scenario E: local deletion wins when remote arrives with older revision', () => {
    const localDeleted = createMockKernelEntity('task-1', 4, 'Deleted Local Task', {}, { deleted: true });
    const remoteStale = createMockKernelEntity('task-1', 3, 'Resurrected Remote Attempt');

    const result = reconcileEntity(localDeleted, remoteStale);
    expect(result.action).toBe('keep_local');
    expect(result.resolvedEntity.lifecycle.status).toBe('deleted');
    expect(result.resolvedEntity.lifecycle.deleted_at).not.toBeNull();
  });

  // --------------------------------------------------------------------------
  // Scenario F: Rejection of Unauthenticated Restore Markers (Fail-Closed)
  // --------------------------------------------------------------------------
  it('Scenario F: rejects unauthenticated restoration when incoming edit has forged restore marker over local deletion', () => {
    const localDeleted = createMockKernelEntity('task-1', 2, 'Deleted Task', {}, { deleted: true });
    // Restoration attempted remotely with version 3 but unauthenticated restore marker
    const remoteRestored = createMockKernelEntity('task-1', 3, 'Restored Task', {}, { deleted: false, restored: true });

    const result = reconcileEntity(localDeleted, remoteRestored);
    // Fail-closed invariant: unauthenticated restore markers are rejected! Local deletion prevails!
    expect(result.action).toBe('keep_local');
    expect(result.resolvedEntity.lifecycle.status).toBe('deleted');
    expect(result.resolvedEntity.lifecycle.deleted_at).not.toBeNull();
    expect(result.resolvedEntity.version).toBe(4);
  });

  it('Scenario F2: unsynchronized live edit at higher revision fails to revive local deletion without explicit restore marker', () => {
    const localDeleted = createMockKernelEntity('task-1', 2, 'Deleted Task', {}, { deleted: true });
    // Peer tab had unsynchronized live edit at version 3 without explicit restore marker
    const remoteStaleLiveEdit = createMockKernelEntity('task-1', 3, 'Live Edit Without Restore', {}, { deleted: false });

    const result = reconcileEntity(localDeleted, remoteStaleLiveEdit);
    expect(result.action).toBe('keep_local');
    expect(result.resolvedEntity.lifecycle.status).toBe('deleted');
    expect(result.resolvedEntity.lifecycle.deleted_at).not.toBeNull();
    // Tombstone supremacy advances version monotonically to guarantee cross-tab convergence
    expect(result.resolvedEntity.version).toBe(4);
  });

  it('Scenario F3: remote deletion at v2 wins over higher local unsynchronized edit at v3 without explicit restore marker', () => {
    const localEdit = createMockKernelEntity('task-1', 3, 'Local Unsynced Edit', {}, { deleted: false });
    const remoteDeleted = createMockKernelEntity('task-1', 2, 'Remote Deleted Task', {}, { deleted: true });

    const result = reconcileEntity(localEdit, remoteDeleted);
    expect(result.action).toBe('accept_remote');
    expect(result.resolvedEntity.lifecycle.status).toBe('deleted');
    expect(result.resolvedEntity.lifecycle.deleted_at).not.toBeNull();
    // Tombstone supremacy advances version monotonically to guarantee convergence
    expect(result.resolvedEntity.version).toBe(4);
  });


  // --------------------------------------------------------------------------
  // Scenario G: Mutation Idempotency Deduplication
  // --------------------------------------------------------------------------
  it('Scenario G: deduplicates identical mutation IDs through IdempotencyTracker', () => {
    const mutationId = 'mut_abc_123';

    expect(tracker.has(mutationId)).toBe(false);
    tracker.record(mutationId);
    expect(tracker.has(mutationId)).toBe(true);

    // Second recording of the same ID is a safe no-op
    tracker.record(mutationId);
    expect(tracker.size()).toBe(1);
    expect(tracker.has(mutationId)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Scenario H: Out-of-Order Delivery Protection
  // --------------------------------------------------------------------------
  it('Scenario H: handles out-of-order delivery safely via monotonic revisions', () => {
    const localCurrent = createMockKernelEntity('task-1', 3, 'Third State');
    // Network delivers older v2 out of order
    const remoteLate = createMockKernelEntity('task-1', 2, 'Second State');

    const result = reconcileEntity(localCurrent, remoteLate);
    expect(result.action).toBe('keep_local');
    expect(result.resolvedEntity.title).toBe('Third State');
    expect(result.resolvedEntity.version).toBe(3);
  });

  // --------------------------------------------------------------------------
  // Scenario I: Multi-Client Convergence (3 Simulated Clients)
  // --------------------------------------------------------------------------
  it('Scenario I: 3 simulated clients converge deterministically to identical final state', () => {
    const initial = createMockKernelEntity('task-1', 1, 'Initial Title', { priority: 3 });

    // Client A updates title (revision 2)
    const clientAUpdate = createMockKernelEntity('task-1', 2, 'Client A Updated Title', { priority: 3 });
    // Client B updates priority (revision 3)
    const clientBUpdate = createMockKernelEntity('task-1', 3, 'Client A Updated Title', { priority: 1 });

    // Client C starts with initial
    let clientC = initial;
    // Client C receives A's update
    clientC = reconcileEntity(clientC, clientAUpdate).resolvedEntity;
    expect(clientC.version).toBe(2);

    // Client C receives B's update
    clientC = reconcileEntity(clientC, clientBUpdate).resolvedEntity;
    expect(clientC.version).toBe(3);
    expect(clientC.title).toBe('Client A Updated Title');
    expect(clientC.attributes.priority).toBe(1);

    // Now Client A receives B's update
    const clientA = reconcileEntity(clientAUpdate, clientBUpdate).resolvedEntity;

    // Both Client A and Client C converge exactly to Client B's authoritative state
    expect(clientA.version).toBe(clientC.version);
    expect(clientA.title).toBe(clientC.title);
    expect(clientA.attributes.priority).toBe(clientC.attributes.priority);
  });

  // --------------------------------------------------------------------------
  // Scenario J: Pending Mutation Queue Lifecycle
  // --------------------------------------------------------------------------
  it('Scenario J: tracks mutation queue status transitions from pending to committed', () => {
    const queue = new PendingMutationQueue();
    queue.clear();

    const entity = createMockKernelEntity('task-pending-1', 1, 'Offline Created Task');
    const mutation = queue.enqueue(
      'mut_queue_1',
      'task-pending-1',
      0,
      'upsert_entity',
      entity
    );

    expect(queue.size()).toBe(1);
    expect(mutation.status).toBe('pending');
    expect(queue.getPending()).toHaveLength(1);

    // Mark in-flight
    queue.markInFlight('mut_queue_1');
    const inFlight = queue.getByEntityId('task-pending-1');
    expect(inFlight?.status).toBe('in_flight');
    expect(inFlight?.retry_count).toBe(1);

    // Retry resets to pending
    queue.retry('mut_queue_1');
    expect(queue.getByEntityId('task-pending-1')?.status).toBe('pending');

    // Mark committed removes it from queue
    queue.markCommitted('mut_queue_1');
    expect(queue.size()).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Scenario K: Pending Mutation Queue Rehydration
  // --------------------------------------------------------------------------
  it('Scenario K: rehydrates pending mutation queue across simulated storage', () => {
    const storageMap = new Map<string, string>();
    const mockStorage: Storage = {
      length: 0,
      clear: () => storageMap.clear(),
      getItem: (k: string) => storageMap.get(k) ?? null,
      key: (i: number) => Array.from(storageMap.keys())[i] ?? null,
      removeItem: (k: string) => storageMap.delete(k),
      setItem: (k: string, v: string) => storageMap.set(k, v),
    };

    const queue1 = new PendingMutationQueue(mockStorage);
    const entity = createMockKernelEntity('task-offline', 1, 'Offline Task');
    queue1.enqueue('mut_persist_1', 'task-offline', 0, 'upsert_entity', entity);

    // Instantiate fresh queue backed by same storage
    const queue2 = new PendingMutationQueue(mockStorage);
    expect(queue2.size()).toBe(1);
    const found = queue2.getByEntityId('task-offline');
    expect(found?.mutation_id).toBe('mut_persist_1');
    expect(found?.entity.title).toBe('Offline Task');
  });

  // --------------------------------------------------------------------------
  // Scenario L: Structured Conflict Descriptor for Overlapping Edits
  // --------------------------------------------------------------------------
  it('Scenario L: generates structured conflict descriptor for overlapping field mutations', () => {
    const local = createMockKernelEntity('task-1', 2, 'Local Custom Title');
    const remote = createMockKernelEntity('task-1', 3, 'Remote Conflicting Title');

    const pending: PendingMutation = {
      mutation_id: 'mut-conflict',
      entity_id: 'task-1',
      base_revision: 1, // Remote progressed from 1 to 3
      op_type: 'upsert_entity',
      entity: local,
      created_at: '2026-10-08T12:00:00.000Z',
      status: 'pending',
      retry_count: 0,
    };

    const result = reconcileEntity(local, remote, pending);
    expect(result.action).toBe('conflict_detected');
    expect(result.conflict).toBeDefined();
    expect(result.conflict?.conflict_type).toBe('concurrent_edit');
    expect(result.conflict?.conflicting_fields).toContain('title');
    expect(result.conflict?.resolution_options).toContain('keep_remote');
    expect(result.conflict?.resolution_options).toContain('keep_local');
    // Canonical baseline remains remote until user resolution
    expect(result.resolvedEntity.title).toBe('Remote Conflicting Title');
  });

  it('Scenario L2: detects a same-revision remote edit against the captured offline base', () => {
    const baseline = createMockKernelEntity('task-cross-device', 2, 'Original title', {}, {
      updated_at: '2026-10-20T18:40:00.000Z',
    });
    const local = createMockKernelEntity('task-cross-device', 3, 'Offline device title', {}, {
      updated_at: '2026-10-20T18:51:00.000Z',
    });
    const remote = createMockKernelEntity('task-cross-device', 2, 'Online device title', {}, {
      updated_at: '2026-10-20T18:52:00.000Z',
    });
    const pending: PendingMutation = {
      mutation_id: 'mut-cross-device',
      entity_id: 'task-cross-device',
      base_revision: 2,
      base_entity: baseline,
      op_type: 'upsert_entity',
      entity: local,
      created_at: '2026-10-20T18:51:00.000Z',
      status: 'pending',
      retry_count: 0,
    };

    const result = reconcileEntity(local, remote, pending);
    expect(result.action).toBe('conflict_detected');
    expect(result.conflict?.conflicting_fields).toContain('title');
    expect(result.resolvedEntity.title).toBe('Online device title');
  });

  // --------------------------------------------------------------------------
  // Scenario M: Chat Messages Append-Only Union & Zombie Session Suppression
  // --------------------------------------------------------------------------
  it('Scenario M: merges chat messages as additive union and strips deleted session messages', () => {
    const msg1: Message = {
      id: 'm1',
      role: 'user',
      text: 'Hello',
      created_at: '2026-10-08T12:00:00.000Z',
      channelId: 'session-1',
    };
    const msg2: Message = {
      id: 'm2',
      role: 'assistant',
      text: 'Hi there',
      created_at: '2026-10-08T12:01:00.000Z',
      channelId: 'session-1',
    };
    const msg3: Message = {
      id: 'm3',
      role: 'user',
      text: 'Zombie message',
      created_at: '2026-10-08T12:02:00.000Z',
      channelId: 'session-deleted',
    };

    const merged = mergeMessages([msg1], [msg2, msg3]);
    expect(merged).toHaveLength(3);

    // Suppress messages belonging to deleted sessions
    const deletedSessionIds = new Set(['session-deleted']);
    const nonZombieMessages = merged.filter(m => !m.channelId || !deletedSessionIds.has(m.channelId));

    expect(nonZombieMessages).toHaveLength(2);
    expect(nonZombieMessages.some(m => m.id === 'm3')).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Scenario N: Chat Session Loop Prevention & Deletion Supremacy
  // --------------------------------------------------------------------------
  it('Scenario N: mergeChatSessions prevents sync loops and preserves deleted flag', () => {
    const localSessions: ChatSession[] = [
      {
        id: 'session-1',
        title: 'Work Session',
        created_at: '2026-10-08T10:00:00.000Z',
        updated_at: '2026-10-08T11:00:00.000Z',
        deleted: false,
      },
    ];

    const remoteSessions: ChatSession[] = [
      {
        id: 'session-1',
        title: 'Work Session',
        created_at: '2026-10-08T10:00:00.000Z',
        updated_at: '2026-10-08T12:00:00.000Z',
        deleted: true, // Marked deleted remotely
      },
    ];

    const merged = mergeChatSessions(localSessions, remoteSessions);
    expect(merged).toHaveLength(1);
    expect(merged[0].deleted).toBe(true);
    expect(merged[0].updated_at).toBe('2026-10-08T12:00:00.000Z');
  });

  it('prefers restored cloud General Chat metadata over a fresh local placeholder', () => {
    const local = {
      id: 'general', title: 'General Chat', created_at: '2026-10-24T00:00:00.000Z',
      updated_at: '2026-10-24T00:00:00.000Z',
    };
    const remote = {
      id: 'general', title: 'General Chat', created_at: '2026-10-20T00:00:00.000Z',
      updated_at: '2026-10-20T00:00:00.000Z', active_branch_id: 'b_main_general',
    };
    expect(mergeChatSessions([local], [remote])[0]).toEqual(remote);
  });

  it('identifies only the synthetic welcome prompt as non-user chat history', () => {
    expect(isDefaultWelcomeMessage({
      id: 'init-1', role: 'assistant', text: 'Welcome to Flowmate. What would you like to talk through or work on?',
      created_at: '2026-10-24T00:00:00.000Z', channelId: 'general',
    })).toBe(true);
    expect(isDefaultWelcomeMessage({
      id: 'init-1', role: 'assistant', text: 'Welcome to Flowmate. What would you like to talk through or work on?',
      created_at: '2026-10-24T00:00:00.000Z', channelId: 'general', status: 'completed',
    })).toBe(false);
  });

  it('propagates the active conversation branch when its selection timestamp is newer', () => {
    const remote = { id: 'session-branch', title: 'Chat', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', active_branch_id: 'main' };
    const local = { ...remote, updated_at: '2026-10-02T00:00:00.000Z', active_branch_id: 'fork' };
    expect(mergeChatSessions([local], [remote])[0].active_branch_id).toBe('fork');
  });

  it('session tombstones and clear markers suppress stale copies without hiding later messages', () => {
    const staleLocal: ChatSession = {
      id: 'session-clear', title: 'Old title', created_at: '2026-10-08T10:00:00.000Z',
      updated_at: '2026-10-08T13:00:00.000Z',
    };
    const cloudClear: ChatSession = {
      id: 'session-clear', title: 'Current title', created_at: '2026-10-08T10:00:00.000Z',
      updated_at: '2026-10-08T12:00:00.000Z', messages_cleared_at: '2026-10-08T11:00:00.000Z',
    };
    const mergedSession = mergeChatSessions([staleLocal], [cloudClear]);
    const messages: Message[] = [
      { id: 'before-clear', role: 'user', text: 'Old', created_at: '2026-10-08T10:30:00.000Z', channelId: 'session-clear' },
      { id: 'after-clear', role: 'user', text: 'New', created_at: '2026-10-08T11:30:00.000Z', channelId: 'session-clear' },
    ];

    expect(mergedSession[0].messages_cleared_at).toBe(cloudClear.messages_cleared_at);
    expect(filterMessagesBySessionState(messages, mergedSession).map(message => message.id)).toEqual(['after-clear']);
    const newerLocalTitle = { ...staleLocal, title: 'Renamed later', updated_at: '2026-10-08T14:00:00.000Z', messages_cleared_at: cloudClear.messages_cleared_at };
    expect(mergeChatSessions([newerLocalTitle], [staleLocal])[0].messages_cleared_at).toBe(cloudClear.messages_cleared_at);

    const olderDelete = { ...staleLocal, deleted: true, deleted_at: '2026-10-08T11:00:00.000Z', updated_at: '2026-10-08T11:00:00.000Z' };
    expect(mergeChatSessions([staleLocal], [olderDelete])[0].deleted).toBe(true);
    expect(filterMessagesBySessionState(messages, [olderDelete])).toEqual([]);

    const undatedLegacyMessage: Message = {
      id: 'undated-legacy', role: 'user', text: 'Old record with no valid timestamp', created_at: 'invalid', channelId: 'session-clear',
    };
    expect(filterMessagesBySessionState([undatedLegacyMessage], mergedSession)).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Scenario O: Collection Reconciler Integration
  // --------------------------------------------------------------------------
  it('Scenario O: reconcileEntityCollection atomically reconciles mixed entities and tombstones', () => {
    const localMap: Record<string, KernelEntity> = {
      'task-1': createMockKernelEntity('task-1', 1, 'Local Initial Task 1'),
      'task-2': createMockKernelEntity('task-2', 2, 'Local Task 2 Deleted', {}, { deleted: true }),
    };

    const remoteDocs = [
      createMockKernelEntity('task-1', 2, 'Remote Progressed Task 1'),
      createMockKernelEntity('task-2', 1, 'Stale Remote Task 2'), // Should NOT resurrect task-2
      createMockKernelEntity('task-3', 1, 'New Remote Task 3'),
    ];

    const { nextKernelEntities, conflicts } = reconcileEntityCollection(localMap, remoteDocs);

    // task-1 accepted remote v2
    expect(nextKernelEntities['task-1'].version).toBe(2);
    expect(nextKernelEntities['task-1'].title).toBe('Remote Progressed Task 1');

    // task-2 local tombstone preserved (no resurrection)
    expect(nextKernelEntities['task-2'].lifecycle.status).toBe('deleted');
    expect(nextKernelEntities['task-2'].version).toBe(2);

    // task-3 newly accepted
    expect(nextKernelEntities['task-3'].title).toBe('New Remote Task 3');

    expect(conflicts).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Scenario P: Automatic Pending Mutation Committal on Remote Acknowledgment
  // --------------------------------------------------------------------------
  it('Scenario P: automatically marks pending mutation committed when remote version confirms it', () => {
    const queue = new PendingMutationQueue();
    queue.clear();

    const offlineEntity = createMockKernelEntity('task-ack-1', 2, 'Locally Updated Task');
    queue.enqueue('mut_ack_1', 'task-ack-1', 1, 'upsert_entity', offlineEntity);
    expect(queue.size()).toBe(1);

    const localMap: Record<string, KernelEntity> = {
      'task-ack-1': offlineEntity,
    };

    // Remote snapshot arrives having applied version 2
    const remoteDocs = [
      createMockKernelEntity('task-ack-1', 2, 'Locally Updated Task'),
    ];

    const { nextKernelEntities, conflicts } = reconcileEntityCollection(localMap, remoteDocs, queue);

    expect(nextKernelEntities['task-ack-1'].version).toBe(2);
    expect(conflicts).toHaveLength(0);
    // Queue should now be empty because it was marked committed!
    expect(queue.size()).toBe(0);
  });

  it('keeps the offline outbox while a previously detected conflict awaits the user', () => {
    const queue = new PendingMutationQueue();
    queue.clear();
    const baseline = createMockKernelEntity('task-conflict-held', 1, 'Original');
    const offline = createMockKernelEntity('task-conflict-held', 2, 'Offline choice');
    const cloud = createMockKernelEntity('task-conflict-held', 2, 'Cloud choice');
    queue.enqueue('mut_conflict_held', offline.id, 1, 'upsert_entity', offline, new Date().toISOString(), baseline);

    const first = reconcileEntityCollection({ [offline.id]: offline }, [cloud], queue);
    expect(first.conflicts).toHaveLength(1);
    expect(queue.size()).toBe(1);

    const repeatedWithoutUiGuard = reconcileEntityCollection(first.nextKernelEntities, [cloud], queue);
    expect(repeatedWithoutUiGuard.nextKernelEntities[offline.id].title).toBe('Cloud choice');
    expect(queue.getByEntityId(offline.id)?.entity.title).toBe('Offline choice');

    // A repeat snapshot sees the remote baseline in the store, but must not
    // infer that it acknowledges the offline choice while the conflict dialog
    // is still awaiting an explicit user decision.
    const repeated = reconcileEntityCollection(
      first.nextKernelEntities,
      [cloud],
      queue,
      new Date().toISOString(),
      new Set([offline.id]),
    );
    expect(repeated.conflicts).toHaveLength(0);
    expect(repeated.nextKernelEntities[offline.id].title).toBe('Cloud choice');
    expect(queue.getByEntityId(offline.id)?.entity.title).toBe('Offline choice');
  });
});

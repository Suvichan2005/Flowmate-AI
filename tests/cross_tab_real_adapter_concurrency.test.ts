/**
 * Flowmate Cross-Tab Asynchronous Storage & Concurrency Stress Tests
 * 
 * Directly tests the multi-tab failure modes identified in Codex review FM-COORD-ec69c887-c5dc-4ffc-9ba8-0d51b4a75b83:
 * 1. Concurrent writes before event delivery (both tabs write before BroadcastChannel delivery).
 * 2. Tombstone supremacy over stale peer edits (deleted entities cannot be resurrected).
 * 3. Monotonic revision supremacy (higher version wins across tabs).
 * 4. Asynchronous rehydration with uncommitted in-memory state.
 * 5. Offline race reconciliation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { reconcileStorageSnapshot, asyncStorage } from '../services/storage/asyncStorageAdapter';

interface MockKernelEntity {
  id: string;
  schema_id: string;
  version: number;
  title: string;
  attributes: Record<string, unknown>;
  lifecycle: {
    status: string;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  };
  provenance: {
    source_type: string;
    observed_at: string;
    confidence: number;
    is_inferred: boolean;
    user_confirmed: boolean;
  };
}

interface MockStorageState {
  state: {
    kernelEntities: Record<string, MockKernelEntity>;
    version: number;
  };
  version: number;
}

function makeEntity(
  id: string,
  title: string,
  version = 1,
  deletedAt: string | null = null
): MockKernelEntity {
  return {
    id,
    schema_id: 'system/task',
    version,
    title,
    attributes: { kind: 'TASK', priority: 1 },
    lifecycle: {
      status: deletedAt ? 'deleted' : 'active',
      created_at: '2026-10-12T00:00:00.000Z',
      updated_at: '2026-10-12T00:00:00.000Z',
      deleted_at: deletedAt,
    },
    provenance: {
      source_type: 'user',
      observed_at: '2026-10-12T00:00:00.000Z',
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
  };
}

function wrapSnapshot(entities: Record<string, MockKernelEntity>): string {
  const payload: MockStorageState = {
    state: {
      kernelEntities: entities,
      version: 17,
    },
    version: 17,
  };
  return JSON.stringify(payload);
}

describe('Cross-Tab Real-Adapter Concurrency & Monotonic Storage Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('Scenario 1: Concurrent writes before event delivery preserve both Tab A and Tab B entities', async () => {
    // Tab A creates task-1
    const taskA = makeEntity('task-1', 'Review Architecture Spec', 1);
    const snapshotA = wrapSnapshot({ 'task-1': taskA });

    // Tab B (concurrently, before any event delivery) creates task-2
    const taskB = makeEntity('task-2', 'Prepare Leadership Stories', 1);
    const snapshotB = wrapSnapshot({ 'task-2': taskB });

    // Tab A writes to storage
    await asyncStorage.setItem('flowmate-storage', snapshotA);

    // Tab B writes to storage WITHOUT having received or processed any event from Tab A
    await asyncStorage.setItem('flowmate-storage', snapshotB);

    // Read disk state
    const diskRaw = await asyncStorage.getItem('flowmate-storage');
    expect(diskRaw).not.toBeNull();

    const parsed: MockStorageState = JSON.parse(diskRaw!);
    const kernelEntities = parsed.state.kernelEntities;

    // CRITICAL: Both task-1 and task-2 must exist on disk!
    expect(Object.keys(kernelEntities).length).toBe(2);
    expect(kernelEntities['task-1']).toBeDefined();
    expect(kernelEntities['task-1'].title).toBe('Review Architecture Spec');
    expect(kernelEntities['task-2']).toBeDefined();
    expect(kernelEntities['task-2'].title).toBe('Prepare Leadership Stories');
  });

  it('Scenario 2: Tombstone supremacy - Tab A deletion tombstone cannot be overwritten by Tab B stale edit', async () => {
    // Initial state: task-1 exists at version 1
    const taskV1 = makeEntity('task-1', 'Atlas preparation', 1);
    await asyncStorage.setItem('flowmate-storage', wrapSnapshot({ 'task-1': taskV1 }));

    // Tab A deletes task-1, producing version 2 tombstone
    const tombstoneA = makeEntity('task-1', 'Atlas preparation', 2, '2026-10-12T01:00:00.000Z');
    await asyncStorage.setItem('flowmate-storage', wrapSnapshot({ 'task-1': tombstoneA }));

    // Tab B has stale version 1 edit ("Atlas preparation - Stale Local Edit") and writes to storage
    const staleEditB = makeEntity('task-1', 'Atlas preparation - Stale Local Edit', 1, null);
    await asyncStorage.setItem('flowmate-storage', wrapSnapshot({ 'task-1': staleEditB }));

    // Read disk state
    const diskRaw = await asyncStorage.getItem('flowmate-storage');
    const parsed: MockStorageState = JSON.parse(diskRaw!);
    const entity = parsed.state.kernelEntities['task-1'];

    // TOMBSTONE SUPREMACY: Version 2 deletion tombstone must win over stale version 1 edit!
    expect(entity.version).toBe(2);
    expect(entity.lifecycle.deleted_at).toBe('2026-10-12T01:00:00.000Z');
    expect(entity.lifecycle.status).toBe('deleted');
  });

  it('Scenario 3: Same-version tombstone supremacy - deletion wins when versions are equal', () => {
    const activeV1 = makeEntity('task-1', 'Active Task', 1, null);
    const deletedV1 = makeEntity('task-1', 'Active Task', 1, '2026-10-12T01:05:00.000Z');

    const existingDisk = wrapSnapshot({ 'task-1': deletedV1 });
    const incomingWrite = wrapSnapshot({ 'task-1': activeV1 });

    const reconciled = reconcileStorageSnapshot(existingDisk, incomingWrite);
    const parsed: MockStorageState = JSON.parse(reconciled);

    expect(parsed.state.kernelEntities['task-1'].lifecycle.deleted_at).toBe('2026-10-12T01:05:00.000Z');
  });

  it('Scenario 4: Monotonic revision supremacy - strictly higher version wins regardless of write order', async () => {
    // Initial state with task-1 v1
    await asyncStorage.setItem('flowmate-storage', wrapSnapshot({
      'task-1': makeEntity('task-1', 'Initial Title', 1)
    }));

    // Tab A writes v3
    await asyncStorage.setItem('flowmate-storage', wrapSnapshot({
      'task-1': makeEntity('task-1', 'Updated Title V3', 3)
    }));

    // Tab B writes stale v2
    await asyncStorage.setItem('flowmate-storage', wrapSnapshot({
      'task-1': makeEntity('task-1', 'Stale Title V2', 2)
    }));

    const diskRaw = await asyncStorage.getItem('flowmate-storage');
    const parsed: MockStorageState = JSON.parse(diskRaw!);
    const entity = parsed.state.kernelEntities['task-1'];

    // Version 3 must win over Version 2!
    expect(entity.version).toBe(3);
    expect(entity.title).toBe('Updated Title V3');
  });

  it('Scenario 5: Multi-entity asynchronous interleaving across three tabs without data loss', async () => {
    // Tab 1 commits task-A
    await asyncStorage.setItem('flowmate-storage', wrapSnapshot({
      'task-A': makeEntity('task-A', 'Goal Alignment', 1)
    }));

    // Tab 2 commits task-B
    await asyncStorage.setItem('flowmate-storage', wrapSnapshot({
      'task-B': makeEntity('task-B', 'Timeline Review', 1)
    }));

    // Tab 3 commits task-C
    await asyncStorage.setItem('flowmate-storage', wrapSnapshot({
      'task-C': makeEntity('task-C', 'Evening Triage', 1)
    }));

    const diskRaw = await asyncStorage.getItem('flowmate-storage');
    const parsed: MockStorageState = JSON.parse(diskRaw!);
    const entities = parsed.state.kernelEntities;

    // All 3 independent tasks from distinct tabs must survive without loss!
    expect(Object.keys(entities).length).toBe(3);
    expect(entities['task-A']).toBeDefined();
    expect(entities['task-B']).toBeDefined();
    expect(entities['task-C']).toBeDefined();
  });

  it('Scenario 6: Graceful fallback when existing disk snapshot is empty or corrupt', () => {
    const valid = wrapSnapshot({ 'task-1': makeEntity('task-1', 'Task 1', 1) });

    // Empty existing
    expect(reconcileStorageSnapshot(null, valid)).toBe(valid);

    // Corrupt existing
    expect(reconcileStorageSnapshot('invalid json', valid)).toBe(valid);
  });
});

/**
 * Flowmate Greenfield Domain Kernel — Stage 2 Store State Inversion Tests
 *
 * Verifies that:
 * 1. `kernelEntities` in Zustand is the sole canonical application state.
 * 2. `entities` is a derived, read-only compatibility projection.
 * 3. Projected entities are deeply frozen (Object.isFrozen) and immune to direct mutation.
 * 4. Mutations via applyOperations, addEntity, updateEntity, deleteEntity modify kernelEntities canonically.
 * 5. Undo/Redo preserves and restores kernelEntities snapshots.
 * 6. Soft-deletion tombstones update kernel lifecycle and project properly to metadata.deleted.
 * 7. ZERO `any` across all test assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, selectKernelEntities, selectLegacyEntities } from '../store';
import { EntityKind, EntityStatus } from '../types';

describe('Stage 2: Store State Inversion (Kernel Authority)', () => {
  beforeEach(() => {
    useStore.setState({
      kernelEntities: {},
      entities: [],
      relationships: [],
      messages: [],
      history: [],
      historyPointer: -1,
      toasts: [],
    });
  });

  it('mutates canonical kernelEntities when an entity is created via applyOperations', () => {
    useStore.getState().applyOperations([
      {
        type: 'create_entity',
        payload: {
          id: 'test-task-1',
          kind: EntityKind.TASK,
          title: 'Implement Kernel Integration',
          priority: 1,
          deadline: '2026-10-08T18:00:00.000Z',
          tags: ['architecture', 'kernel'],
        },
      },
    ]);

    const kernelMap = selectKernelEntities(useStore.getState());
    expect(kernelMap['test-task-1']).toBeDefined();
    expect(kernelMap['test-task-1'].title).toBe('Implement Kernel Integration');
    expect(kernelMap['test-task-1'].schema_id).toBe('system/task');
    expect(kernelMap['test-task-1'].attributes.priority).toBe(1);
    expect(kernelMap['test-task-1'].attributes.deadline).toBe('2026-10-08T18:00:00.000Z');

    // Projected entities must match
    const legacyEntities = selectLegacyEntities(useStore.getState());
    expect(legacyEntities.length).toBe(1);
    expect(legacyEntities[0].id).toBe('test-task-1');
    expect(legacyEntities[0].title).toBe('Implement Kernel Integration');
    expect(legacyEntities[0].priority).toBe(1);
    expect(legacyEntities[0].canonical_tags).toEqual(['architecture', 'kernel']);
  });

  it('enforces runtime immutability on projected entities (Object.freeze)', () => {
    useStore.getState().applyOperations([
      {
        type: 'create_entity',
        payload: {
          id: 'frozen-test-1',
          kind: EntityKind.NOTE,
          title: 'Immutable Legacy Projection',
        },
      },
    ]);

    const legacyEntities = selectLegacyEntities(useStore.getState());
    expect(legacyEntities.length).toBe(1);
    expect(Object.isFrozen(legacyEntities)).toBe(true);
    expect(Object.isFrozen(legacyEntities[0])).toBe(true);

    // Direct mutation of projected entity must throw
    expect(() => {
      (legacyEntities[0] as { title: string }).title = 'Direct Mutated Title';
    }).toThrow();
  });

  it('updates canonical kernelEntities when an entity is modified via update_entity', () => {
    useStore.getState().applyOperations([
      {
        type: 'create_entity',
        payload: {
          id: 'update-target',
          kind: EntityKind.TASK,
          title: 'Initial Title',
          priority: 3,
        },
      },
    ]);

    useStore.getState().applyOperations([
      {
        type: 'update_entity',
        payload: {
          id: 'update-target',
          fields: {
            title: 'Updated Title',
            priority: 1,
            status: EntityStatus.IN_PROGRESS,
          },
        },
      },
    ]);

    const kernel = selectKernelEntities(useStore.getState())['update-target'];
    expect(kernel.title).toBe('Updated Title');
    expect(kernel.attributes.priority).toBe(1);
    expect(kernel.lifecycle.status).toBe('in_progress');

    const projected = selectLegacyEntities(useStore.getState())[0];
    expect(projected.title).toBe('Updated Title');
    expect(projected.priority).toBe(1);
    expect(projected.status).toBe(EntityStatus.IN_PROGRESS);
  });

  it('marks lifecycle as deleted in kernelEntities when delete_entity is executed', () => {
    useStore.getState().applyOperations([
      {
        type: 'create_entity',
        payload: {
          id: 'delete-target',
          kind: EntityKind.EVENT,
          title: 'Temporary Meeting',
        },
      },
    ]);

    useStore.getState().applyOperations([
      {
        type: 'delete_entity',
        payload: { id: 'delete-target' },
      },
    ]);

    const kernel = selectKernelEntities(useStore.getState())['delete-target'];
    expect(kernel).toBeDefined();
    expect(kernel.lifecycle.status).toBe('deleted');
    expect(kernel.lifecycle.deleted_at).toBeTypeOf('string');
    expect(kernel.attributes.deleted).toBe(true);

    // Projected legacy entity is marked with metadata.deleted for sync compatibility
    const projected = selectLegacyEntities(useStore.getState()).find(e => e.id === 'delete-target');
    expect(projected).toBeDefined();
    expect(projected?.metadata?.deleted).toBe(true);
  });

  it('preserves and restores kernelEntities across undo and redo', () => {
    useStore.getState().applyOperations([
      {
        type: 'create_entity',
        payload: {
          id: 'history-item',
          kind: EntityKind.TASK,
          title: 'Initial Milestone',
        },
      },
    ]);

    expect(selectKernelEntities(useStore.getState())['history-item']).toBeDefined();

    // Mutate
    useStore.getState().applyOperations([
      {
        type: 'update_entity',
        payload: {
          id: 'history-item',
          fields: { title: 'Changed Milestone' },
        },
      },
    ]);
    expect(selectKernelEntities(useStore.getState())['history-item'].title).toBe('Changed Milestone');

    // Undo
    useStore.getState().undo();
    expect(selectKernelEntities(useStore.getState())['history-item'].title).toBe('Initial Milestone');
    expect(selectLegacyEntities(useStore.getState())[0].title).toBe('Initial Milestone');

    // Redo
    useStore.getState().redo();
    expect(selectKernelEntities(useStore.getState())['history-item'].title).toBe('Changed Milestone');
    expect(selectLegacyEntities(useStore.getState())[0].title).toBe('Changed Milestone');
  });

  it('auto-archives stale entities by updating kernelEntities lifecycle status', () => {
    const sixtyFiveDaysAgo = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString();
    useStore.getState().applyOperations([
      {
        type: 'create_entity',
        payload: {
          id: 'stale-evt',
          kind: EntityKind.EVENT,
          title: 'Old Conference',
          end_time: sixtyFiveDaysAgo,
        },
      },
    ]);

    const archivedCount = useStore.getState().autoArchiveStaleEntities();
    expect(archivedCount).toBe(1);

    const kernel = selectKernelEntities(useStore.getState())['stale-evt'];
    expect(kernel.lifecycle.status).toBe('archived');

    const projected = selectLegacyEntities(useStore.getState())[0];
    expect(projected.metadata?.archived).toBe(true);
  });
});

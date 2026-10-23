import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { projectKernelEntitiesToLegacy } from '../store/kernelProjection';
import { globalPendingMutationQueue, type ConflictDescriptor } from '../services/sync';
import type { KernelEntity } from '../services/kernel/types';

const entity = (title: string, version: number): KernelEntity => ({
  id: 'offline-conflict',
  schema_id: 'flowmate/task',
  version,
  title,
  attributes: {},
  lifecycle: {
    status: 'active',
    created_at: '2026-10-21T00:00:00.000Z',
    updated_at: '2026-10-21T00:00:00.000Z',
    deleted_at: null,
  },
  provenance: {
    source_type: 'user',
    observed_at: '2026-10-21T00:00:00.000Z',
    confidence: 1,
    is_inferred: false,
    user_confirmed: true,
  },
});

const conflict: ConflictDescriptor = {
  id: 'conflict-offline',
  entity_id: 'offline-conflict',
  conflict_type: 'concurrent_edit',
  local_revision: 2,
  remote_revision: 2,
  conflicting_fields: ['title'],
  message: 'Concurrent edits detected.',
  resolution_options: ['keep_remote', 'keep_local'],
  detected_at: '2026-10-21T00:00:00.000Z',
};

describe('store offline conflict resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    globalPendingMutationQueue.setStorageIdentity('legacy');
    useStore.setState({
      conflicts: [],
      kernelEntities: {},
      entities: [],
      isDemoMode: false,
    });
  });

  it('recovers the queued offline version when the user chooses to keep it', () => {
    const baseline = entity('Original', 1);
    const offline = entity('Edited while offline', 2);
    const remote = entity('Edited on another device', 2);
    globalPendingMutationQueue.setStorageIdentity('conflict-test-keep-local');
    globalPendingMutationQueue.clear();
    globalPendingMutationQueue.enqueue('mutation-offline', offline.id, 1, 'upsert_entity', offline, '2026-10-21T00:01:00.000Z', baseline);
    useStore.setState({
      isDemoMode: true,
      kernelEntities: { [remote.id]: remote },
      conflicts: [conflict],
    });

    useStore.getState().resolveConflict(conflict.id, 'keep_local');

    expect(useStore.getState().kernelEntities[offline.id].title).toBe('Edited while offline');
    expect(useStore.getState().kernelEntities[offline.id].version).toBe(3);
    const queuedResolution = globalPendingMutationQueue.getByEntityId(offline.id);
    expect(queuedResolution?.entity.title).toBe('Edited while offline');
    expect(queuedResolution?.base_entity?.title).toBe('Edited on another device');
    expect(useStore.getState().conflicts).toEqual([]);
  });

  it('removes the queued local edit when the user explicitly chooses the cloud version', () => {
    const offline = entity('Edited while offline', 2);
    const remote = entity('Edited on another device', 2);
    globalPendingMutationQueue.setStorageIdentity('conflict-test-keep-remote');
    globalPendingMutationQueue.clear();
    globalPendingMutationQueue.enqueue('mutation-offline', offline.id, 1, 'upsert_entity', offline);
    useStore.setState({
      kernelEntities: { [remote.id]: remote },
      conflicts: [conflict],
    });

    useStore.getState().resolveConflict(conflict.id, 'keep_remote');

    expect(useStore.getState().kernelEntities[remote.id].title).toBe('Edited on another device');
    expect(globalPendingMutationQueue.getByEntityId(remote.id)).toBeUndefined();
    expect(useStore.getState().conflicts).toEqual([]);
  });

  it('queues ordinary UI CRUD mutations while offline with their captured base', () => {
    const baseline = entity('Original', 1);
    globalPendingMutationQueue.setStorageIdentity('conflict-test-ui-offline');
    globalPendingMutationQueue.clear();
    vi.stubGlobal('navigator', { onLine: false });
    useStore.setState({
      isDemoMode: true,
      kernelEntities: { [baseline.id]: baseline },
      entities: projectKernelEntitiesToLegacy({ [baseline.id]: baseline }),
      conflicts: [],
    });

    useStore.getState().updateEntity(baseline.id, { title: 'Edited in offline UI' });

    const pending = globalPendingMutationQueue.getByEntityId(baseline.id);
    expect(pending?.entity.title).toBe('Edited in offline UI');
    expect(pending?.base_entity?.title).toBe('Original');
    expect(pending?.base_revision).toBe(1);
  });
});

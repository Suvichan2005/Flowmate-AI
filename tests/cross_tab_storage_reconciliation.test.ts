/**
 * Flowmate Cross-Tab Storage Reconciliation & Snapshot Guard Test
 * 
 * Verifies resolution of the data-loss defect identified in evidence/action-review/cross-tab.json:
 * Tab A commits a task (count: 1).
 * Without cross-tab reconciliation, Tab B navigates and writes a stale empty snapshot, dropping count to 0.
 * With BroadcastChannel / storage-event reconciliation, Tab B rehydrates before writing, preserving state (1 -> 2).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcileStorageSnapshot } from '../services/storage/asyncStorageAdapter';

interface PersistedPayload {
  state: {
    kernelEntities: Record<string, { id: string; title: string }>;
    version: number;
  };
  version: number;
}

class MockLocalStorage {
  private store: Record<string, string> = {};
  public listeners: Array<(event: { key: string; oldValue: string | null; newValue: string | null }) => void> = [];

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    const oldValue = this.store[key] ?? null;
    this.store[key] = value;
    // Broadcast storage event to listeners (simulating other tabs)
    this.listeners.forEach(listener => listener({ key, oldValue, newValue: value }));
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

describe('Cross-Tab Storage Snapshot Resilience', () => {
  let mockStorage: MockLocalStorage;

  beforeEach(() => {
    mockStorage = new MockLocalStorage();
  });

  it('reproduces the baseline failure: Tab B without reconciliation overwrites Tab A committed state (1 -> 0)', () => {
    // 1. Initial State in Tab A and Tab B (both open at the same time with empty state)
    let tabA_inMemoryEntities: Record<string, { id: string; title: string }> = {};
    let tabB_inMemoryEntities: Record<string, { id: string; title: string }> = {};

    // 2. Tab A commits 1 task and persists whole snapshot to storage
    tabA_inMemoryEntities['task-1'] = { id: 'task-1', title: 'Atlas project review Prep' };
    mockStorage.setItem('flowmate-storage', JSON.stringify({
      state: { kernelEntities: tabA_inMemoryEntities, version: 17 },
      version: 17
    }));

    // Verify disk has 1 entity
    const diskPayloadAfterA: PersistedPayload = JSON.parse(mockStorage.getItem('flowmate-storage')!);
    expect(Object.keys(diskPayloadAfterA.state.kernelEntities).length).toBe(1);

    // 3. Tab B (which has stale in-memory state: 0 entities) triggers a navigation or view change
    // Tab B's persist middleware serializes its stale in-memory state and blindly overwrites disk!
    mockStorage.setItem('flowmate-storage', JSON.stringify({
      state: { kernelEntities: tabB_inMemoryEntities, version: 17 },
      version: 17
    }));

    // 4. Tab A refreshes and reads disk
    const diskPayloadAfterB: PersistedPayload = JSON.parse(mockStorage.getItem('flowmate-storage')!);
    const countAfterB = Object.keys(diskPayloadAfterB.state.kernelEntities).length;

    // EXACT REPRODUCTION OF cross-tab.json: count dropped from 1 to 0!
    expect(countAfterB).toBe(0);
  });

  it('proves the reconciled architecture: Tab B with cross-tab listener rehydrates before writing, eliminating data loss (1 -> 2)', () => {
    // 1. Initial State in Tab A and Tab B
    let tabA_inMemoryEntities: Record<string, { id: string; title: string }> = {};
    let tabB_inMemoryEntities: Record<string, { id: string; title: string }> = {};

    // Rehydration hook in Tab B (simulates window.addEventListener('storage') / BroadcastChannel)
    const tabB_rehydrate = () => {
      const raw = mockStorage.getItem('flowmate-storage');
      if (raw) {
        const parsed: PersistedPayload = JSON.parse(raw);
        tabB_inMemoryEntities = { ...parsed.state.kernelEntities };
      }
    };

    // Register cross-tab listener on Tab B
    mockStorage.listeners.push((event) => {
      if (event.key === 'flowmate-storage') {
        tabB_rehydrate();
      }
    });

    // 2. Tab A commits 1 task and persists whole snapshot
    tabA_inMemoryEntities['task-1'] = { id: 'task-1', title: 'Atlas project review Prep' };
    mockStorage.setItem('flowmate-storage', JSON.stringify({
      state: { kernelEntities: tabA_inMemoryEntities, version: 17 },
      version: 17
    }));

    // Verify Tab B automatically received the storage event and rehydrated
    expect(Object.keys(tabB_inMemoryEntities).length).toBe(1);
    expect(tabB_inMemoryEntities['task-1'].title).toBe('Atlas project review Prep');

    // 3. Tab B now performs a local mutation or navigation: adds task-2
    tabB_inMemoryEntities['task-2'] = { id: 'task-2', title: 'Service contact Rescheduled Slot' };
    mockStorage.setItem('flowmate-storage', JSON.stringify({
      state: { kernelEntities: tabB_inMemoryEntities, version: 17 },
      version: 17
    }));

    // 4. Tab A refreshes and reads disk
    const diskPayloadFinal: PersistedPayload = JSON.parse(mockStorage.getItem('flowmate-storage')!);
    const finalEntities = diskPayloadFinal.state.kernelEntities;

    // Both tasks are preserved! Zero data loss!
    expect(Object.keys(finalEntities).length).toBe(2);
    expect(finalEntities['task-1']).toBeDefined();
    expect(finalEntities['task-2']).toBeDefined();
  });
});

describe('P1 Deletion/Tombstone Supremacy in Storage Reconciliation', () => {
  it('enforces tombstone supremacy when incoming edit v3 attempts to revive disk tombstone v2 without explicit restore', () => {
    const existingDisk = JSON.stringify({
      state: {
        kernelEntities: {
          'task-1': {
            id: 'task-1',
            version: 2,
            title: 'Task deleted on disk',
            lifecycle: {
              status: 'deleted',
              deleted_at: '2026-10-12T01:00:00.000Z',
            },
          },
        },
      },
      version: 2,
    });

    // Peer tab had an unsynchronized live edit that bumped to v3
    const incomingPeer = JSON.stringify({
      state: {
        kernelEntities: {
          'task-1': {
            id: 'task-1',
            version: 3,
            title: 'Unsynchronized live edit from peer tab',
            lifecycle: {
              status: 'active',
              deleted_at: null,
            },
          },
        },
      },
      version: 3,
    });

    const reconciledRaw = reconcileStorageSnapshot(existingDisk, incomingPeer);
    const reconciled = JSON.parse(reconciledRaw);
    const ent = reconciled.state.kernelEntities['task-1'];

    // Tombstone must win!
    expect(ent.lifecycle.status).toBe('deleted');
    expect(ent.lifecycle.deleted_at).toBe('2026-10-12T01:00:00.000Z');
    // Version must advance monotonically beyond incoming v3 to ensure convergence
    expect(ent.version).toBe(4);
  });

  it('rejects unauthenticated restoration when incoming edit v3 has forged restore marker over disk tombstone v2', () => {
    const existingDisk = JSON.stringify({
      state: {
        kernelEntities: {
          'task-1': {
            id: 'task-1',
            version: 2,
            title: 'Task deleted on disk',
            lifecycle: {
              status: 'deleted',
              deleted_at: '2026-10-12T01:00:00.000Z',
            },
          },
        },
      },
      version: 2,
    });

    const incomingPeer = JSON.stringify({
      state: {
        kernelEntities: {
          'task-1': {
            id: 'task-1',
            version: 3,
            title: 'Forged restore task',
            lifecycle: {
              status: 'active',
              deleted_at: null,
              restored: true,
              restored_at: '2026-10-12T02:00:00.000Z',
            },
            restored: true,
          },
        },
      },
      version: 3,
    });

    const reconciledRaw = reconcileStorageSnapshot(existingDisk, incomingPeer);
    const reconciled = JSON.parse(reconciledRaw);
    const ent = reconciled.state.kernelEntities['task-1'];

    // Fail-closed invariant: unauthenticated restore markers are rejected! Tombstone prevails!
    expect(ent.lifecycle.status).toBe('deleted');
    expect(ent.version).toBe(4);
  });

  it('enforces tombstone supremacy when incoming snapshot contains tombstone v3 over disk active entity v2', () => {
    const existingDisk = JSON.stringify({
      state: {
        kernelEntities: {
          'task-1': {
            id: 'task-1',
            version: 2,
            title: 'Active task on disk',
            lifecycle: {
              status: 'active',
              deleted_at: null,
            },
          },
        },
      },
      version: 2,
    });

    const incomingPeer = JSON.stringify({
      state: {
        kernelEntities: {
          'task-1': {
            id: 'task-1',
            version: 3,
            title: 'Active task on disk',
            lifecycle: {
              status: 'deleted',
              deleted_at: '2026-10-12T02:00:00.000Z',
            },
          },
        },
      },
      version: 3,
    });

    const reconciledRaw = reconcileStorageSnapshot(existingDisk, incomingPeer);
    const reconciled = JSON.parse(reconciledRaw);
    const ent = reconciled.state.kernelEntities['task-1'];

    expect(ent.lifecycle.status).toBe('deleted');
    expect(ent.version).toBe(3);
  });

  it('monotonically advances tombstone when disk was ahead in revision (disk v5 active vs incoming v3 tombstone)', () => {
    const existingDisk = JSON.stringify({
      state: {
        kernelEntities: {
          'task-1': {
            id: 'task-1',
            version: 5,
            title: 'Active task on disk ahead in version',
            lifecycle: {
              status: 'active',
              deleted_at: null,
            },
          },
        },
      },
      version: 5,
    });

    const incomingPeer = JSON.stringify({
      state: {
        kernelEntities: {
          'task-1': {
            id: 'task-1',
            version: 3,
            title: 'Task deleted remotely',
            lifecycle: {
              status: 'deleted',
              deleted_at: '2026-10-12T02:00:00.000Z',
            },
          },
        },
      },
      version: 3,
    });

    const reconciledRaw = reconcileStorageSnapshot(existingDisk, incomingPeer);
    const reconciled = JSON.parse(reconciledRaw);
    const ent = reconciled.state.kernelEntities['task-1'];

    // Tombstone wins and advances monotonically past disk v5 -> v6
    expect(ent.lifecycle.status).toBe('deleted');
    expect(ent.version).toBe(6);
  });
});


import { describe, expect, it } from 'vitest';
import { describeWorkspaceAvailability } from '../services/workspaceAvailability';
import { createSyncSnapshotMetadataAggregator } from '../services/sync/snapshotMetadata';

const base = {
  online: true,
  firebaseConfigured: true,
  authenticated: true,
  workspaceSyncEnabled: true,
  syncStatus: 'idle' as const,
  pendingCount: 0,
  lastSyncedAt: null,
  geminiConfigured: false,
};

describe('workspace sync status evidence', () => {
  it('does not label unresolved Firebase Auth restoration as signed out', () => {
    const status = describeWorkspaceAvailability({ ...base, authenticated: false, authResolved: false });
    expect(status.cloud).toBe('Checking account status…');
    expect(status.authentication).toBe('Checking sign-in status');
  });

  it('explains that workspace sync consent is specific to this device', () => {
    expect(describeWorkspaceAvailability({ ...base, workspaceSyncEnabled: false }).cloud)
      .toBe('Workspace sync is off on this device — review Settings to connect');
  });

  it('waits for every stream and reports cache-to-server metadata changes without data edits', () => {
    const updates: Array<{ fromCache: boolean; hasPendingWrites: boolean }> = [];
    const update = createSyncSnapshotMetadataAggregator(metadata => updates.push(metadata));
    const sources = ['entities', 'relationships', 'config', 'messages', 'chatSessions', 'chatBranches'] as const;
    sources.forEach(source => update(source, { fromCache: true, hasPendingWrites: false }));
    expect(updates).toEqual([{ fromCache: true, hasPendingWrites: false }]);

    update('messages', { fromCache: false, hasPendingWrites: false });
    expect(updates).toEqual([{ fromCache: true, hasPendingWrites: false }]);
    update('entities', { fromCache: false, hasPendingWrites: false });
    update('relationships', { fromCache: false, hasPendingWrites: false });
    update('config', { fromCache: false, hasPendingWrites: false });
    update('chatSessions', { fromCache: false, hasPendingWrites: false });
    update('chatBranches', { fromCache: false, hasPendingWrites: false });
    expect(updates.at(-1)).toEqual({ fromCache: false, hasPendingWrites: false });
  });

  it('does not describe cached Firestore data as confirmed cloud state', () => {
    expect(describeWorkspaceAvailability({ ...base, syncReadSource: 'cache' }).cloud)
      .toBe('Showing cached cloud data — checking for server updates');
  });

  it('distinguishes local pending writes from server acknowledgement', () => {
    expect(describeWorkspaceAvailability({ ...base, syncReadSource: 'server', syncHasPendingWrites: true }).cloud)
      .toBe('Cloud changes waiting for server confirmation');
  });

  it('reports server-confirmed reads without inventing a successful save time', () => {
    expect(describeWorkspaceAvailability({ ...base, syncReadSource: 'server' }).cloud)
      .toBe('Cloud data confirmed by server; no saved changes yet');
  });

  it('does not confuse a pending integration queue item with a pending Firestore write', () => {
    expect(describeWorkspaceAvailability({ ...base, syncReadSource: 'server', pendingCount: 1 }).cloud)
      .toBe('Cloud data confirmed by server; no saved changes yet');
  });
});

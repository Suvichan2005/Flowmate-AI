import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/firebase', async importOriginal => ({
  ...(await importOriginal<any>()),
  isFirebaseConfigured: () => true,
}));
vi.mock('../services/firestoreSync', () => Object.fromEntries([
  'saveUserData', 'loadUserData', 'subscribeToUserData', 'unsubscribeFromUserData',
  'mergeData', 'mergeMessages', 'mergeChatSessions', 'saveMessage', 'saveFoodLogs',
  'saveAttendanceData', 'saveChatSessions', 'deleteChannelMessages', 'syncEntities',
  'syncRelationships', 'saveUserConfig', 'saveChatBranches',
].map(name => [name, vi.fn()])));

import * as firestore from '../services/firestoreSync';
import {
  cleanupSync,
  forceSync,
  initializeSync,
  isWorkspaceCloudSyncActiveFor,
  loadInitialData,
  refreshWorkspaceFromCloud,
  replayPendingEntityMutations,
  setWorkspaceCloudSyncConsent,
  scheduleSync,
  setSyncConflictedEntityIds,
  startRealtimeSync,
  syncMessage,
  syncChatBranchesToCloud,
  syncWorkspaceNow,
} from '../services/syncManager';
import { globalPendingMutationQueue } from '../services/sync';

afterEach(() => {
  cleanupSync();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('workspace cloud sync consent gate', () => {
  it('blocks workspace reads, listeners and writes after sign-in without explicit consent', async () => {
    initializeSync('synthetic-uid', vi.fn(), vi.fn());

    expect(await loadInitialData()).toBeNull();
    expect(startRealtimeSync()).toBeNull();
    expect(await forceSync(() => ({ entities: [], relationships: [], universalTags: [] }))).toBe(false);
    expect(await syncWorkspaceNow({ entities: [], relationships: [], universalTags: [] })).toBe(false);
    expect(isWorkspaceCloudSyncActiveFor('synthetic-uid')).toBe(false);
    expect(await syncMessage({ id: 'm1' } as any)).toBe(false);
    expect(firestore.loadUserData).not.toHaveBeenCalled();
    expect(firestore.subscribeToUserData).not.toHaveBeenCalled();
    expect(firestore.saveMessage).not.toHaveBeenCalled();
    expect(firestore.saveUserData).not.toHaveBeenCalled();
  });

  it('routes explicit full-sync through consent and stops it after revocation', async () => {
    vi.mocked(firestore.loadUserData).mockResolvedValue({
      entities: [], relationships: [], universalTags: [], messages: [], chatSessions: [],
      foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null,
      syncMetadata: { fromCache: false, hasPendingWrites: false },
    } as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    vi.mocked(firestore.saveUserData).mockResolvedValue(true);
    const reportStatus = vi.fn();
    initializeSync('synthetic-uid', reportStatus, vi.fn());

    const workspace = { entities: [], relationships: [], universalTags: [], messages: [] };
    expect(await syncWorkspaceNow(workspace)).toBe(false);
    expect(firestore.saveUserData).not.toHaveBeenCalled();

    setWorkspaceCloudSyncConsent(true);
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1));
    expect(isWorkspaceCloudSyncActiveFor('synthetic-uid')).toBe(true);
    expect(await syncWorkspaceNow(workspace)).toBe(true);
    expect(firestore.saveUserData).toHaveBeenCalledWith('synthetic-uid', workspace);

    setWorkspaceCloudSyncConsent(false);
    expect(isWorkspaceCloudSyncActiveFor('synthetic-uid')).toBe(false);
    expect(await syncWorkspaceNow(workspace)).toBe(false);
    expect(firestore.saveUserData).toHaveBeenCalledTimes(1);
  });

  it('loads and subscribes only after explicit consent, then stops on revocation', async () => {
    const initialData = {
      entities: [], relationships: [], universalTags: [], messages: [], chatSessions: [],
      foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null,
      syncMetadata: { fromCache: false, hasPendingWrites: false },
    };
    vi.mocked(firestore.loadUserData).mockResolvedValue(initialData as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    const receive = vi.fn();
    const reportStatus = vi.fn();
    initializeSync('synthetic-uid', reportStatus, receive);

    setWorkspaceCloudSyncConsent(true);
    await vi.waitFor(() => expect(firestore.loadUserData).toHaveBeenCalledWith('synthetic-uid', 'server'));
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1));
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ isInitialLoad: true, entities: [] }));
    expect(reportStatus).toHaveBeenCalledWith('idle');

    setWorkspaceCloudSyncConsent(false);
    expect(await loadInitialData()).toBeNull();
    expect(await syncMessage({ id: 'm2' } as any)).toBe(false);
    expect(firestore.saveMessage).not.toHaveBeenCalled();
  });

  it('does not hand offline edits to Firestore’s last-write-wins queue', async () => {
    initializeSync('synthetic-uid', vi.fn(), vi.fn(), true);
    vi.stubGlobal('navigator', { onLine: false });
    scheduleSync(() => ({ entities: [{ id: 'offline-only' } as any], relationships: [], universalTags: [] }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(firestore.saveUserData).not.toHaveBeenCalled();
    expect(firestore.syncEntities).not.toHaveBeenCalled();
  });

  it('uses a server-only snapshot before replaying after reconnect', async () => {
    const initialData = {
      entities: [], relationships: [], universalTags: [], messages: [], chatSessions: [],
      foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null,
    };
    vi.mocked(firestore.loadUserData).mockResolvedValue(initialData as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    initializeSync('synthetic-uid', vi.fn(), vi.fn(), true);
    await vi.waitFor(() => expect(firestore.loadUserData).toHaveBeenCalledWith('synthetic-uid', 'server'));
    vi.mocked(firestore.loadUserData).mockClear();

    refreshWorkspaceFromCloud();
    await vi.waitFor(() => expect(firestore.loadUserData).toHaveBeenCalledWith('synthetic-uid', 'server'));
  });

  it('blocks saves during identity hydration until the authoritative cloud snapshot is reconciled', async () => {
    let finishRead: ((value: unknown) => void) | undefined;
    vi.mocked(firestore.loadUserData).mockImplementation(() => new Promise(resolve => { finishRead = resolve; }) as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    vi.mocked(firestore.saveUserData).mockResolvedValue(true);
    initializeSync('synthetic-uid', vi.fn(), vi.fn(), true);

    expect(await forceSync(() => ({ entities: [], relationships: [], universalTags: [] }))).toBe(false);
    expect(firestore.saveUserData).not.toHaveBeenCalled();

    finishRead?.({
      entities: [], relationships: [], universalTags: [], messages: [], chatSessions: [],
      foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null, syncMetadata: { fromCache: false, hasPendingWrites: false },
    });
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1));
    expect(await forceSync(() => ({ entities: [], relationships: [], universalTags: [] }))).toBe(true);
    expect(firestore.saveUserData).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite unchanged config during a no-op incremental sync', async () => {
    vi.mocked(firestore.loadUserData).mockResolvedValue({
      entities: [], relationships: [], universalTags: [{ id: 'tag-1', name: 'Focus' }],
      settings: { theme: 'dark' }, messages: [], chatSessions: [], foodLogs: [], subjects: [],
      classSchedule: [], holidays: [], attendanceLogs: [], lastSyncedAt: null,
      syncMetadata: { fromCache: false, hasPendingWrites: false },
    } as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    vi.mocked(firestore.saveUserData).mockResolvedValue(true);
    vi.mocked(firestore.saveUserConfig).mockResolvedValue(true);
    initializeSync('synthetic-uid', vi.fn(), vi.fn(), true);
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1));

    const unchanged = {
      entities: [], relationships: [], universalTags: [{ id: 'tag-1', name: 'Focus' }],
      settings: { theme: 'dark' },
    } as any;
    expect(await forceSync(() => unchanged)).toBe(true);
    expect(await forceSync(() => unchanged)).toBe(true);
    expect(firestore.saveUserConfig).not.toHaveBeenCalled();
    expect(firestore.syncEntities).not.toHaveBeenCalled();
    expect(firestore.syncRelationships).not.toHaveBeenCalled();

    const changed = { ...unchanged, settings: { theme: 'light' } };
    expect(await forceSync(() => changed)).toBe(true);
    expect(firestore.saveUserConfig).toHaveBeenCalledTimes(1);
    expect(firestore.saveUserConfig).toHaveBeenCalledWith('synthetic-uid', {
      universalTags: unchanged.universalTags,
      settings: changed.settings,
    });
  });

  it('retains a local save request whose debounce expires before the server baseline', async () => {
    let finishRead: ((value: unknown) => void) | undefined;
    vi.mocked(firestore.loadUserData).mockImplementation(() => new Promise(resolve => { finishRead = resolve; }) as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    vi.mocked(firestore.saveUserData).mockResolvedValue(true);
    initializeSync('synthetic-uid', vi.fn(), vi.fn(), true);

    const localSnapshot = { entities: [{ id: 'local-before-baseline' } as any], relationships: [], universalTags: [] };
    scheduleSync(() => localSnapshot);
    await new Promise(resolve => setTimeout(resolve, 2050));
    expect(firestore.saveUserData).not.toHaveBeenCalled();

    finishRead?.({
      entities: [], relationships: [], universalTags: [], messages: [], chatSessions: [],
      foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null, syncMetadata: { fromCache: false, hasPendingWrites: false },
    });
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(firestore.saveUserData).toHaveBeenCalledWith('synthetic-uid', localSnapshot), { timeout: 3000, interval: 25 });
  });

  it('retries a transient deferred-save failure a bounded time without another local edit', async () => {
    vi.mocked(firestore.loadUserData).mockResolvedValue({
      entities: [], relationships: [], universalTags: [], messages: [], chatSessions: [],
      foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null, syncMetadata: { fromCache: false, hasPendingWrites: false },
    } as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    vi.mocked(firestore.saveUserData).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const status = vi.fn();
    initializeSync('synthetic-retry-uid', status, vi.fn(), true);
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledOnce());

    vi.useFakeTimers();
    const localSnapshot = { entities: [{ id: 'retry-only-edit' } as any], relationships: [], universalTags: [] };
    scheduleSync(() => localSnapshot);
    await vi.advanceTimersByTimeAsync(2000);
    expect(firestore.saveUserData).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith('error', 'Sync failed');

    await vi.advanceTimersByTimeAsync(999);
    expect(firestore.saveUserData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(firestore.saveUserData).toHaveBeenCalledTimes(2);
    expect(firestore.saveUserData).toHaveBeenLastCalledWith('synthetic-retry-uid', expect.objectContaining({
      entities: localSnapshot.entities,
    }));
    expect(status).toHaveBeenLastCalledWith('idle');
  });

  it('retries a transient branch transaction failure while consent and account identity remain active', async () => {
    vi.mocked(firestore.loadUserData).mockResolvedValue({
      entities: [], relationships: [], universalTags: [], messages: [], chatSessions: [],
      foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null, syncMetadata: { fromCache: false, hasPendingWrites: false },
    } as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    vi.mocked(firestore.saveChatBranches).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    initializeSync('synthetic-branch-retry-uid', vi.fn(), vi.fn(), true);
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledOnce());

    vi.useFakeTimers();
    const branches = [{ id: 'branch-to-retry', conversation_id: 'chat-1' }] as any;
    const pending = syncChatBranchesToCloud(branches);
    expect(firestore.saveChatBranches).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBe(true);
    expect(firestore.saveChatBranches).toHaveBeenCalledTimes(2);
    expect(firestore.saveChatBranches).toHaveBeenLastCalledWith('synthetic-branch-retry-uid', branches);
  });

  it('stops a delayed branch retry after workspace consent is revoked', async () => {
    vi.mocked(firestore.loadUserData).mockResolvedValue({
      entities: [], relationships: [], universalTags: [], messages: [], chatSessions: [],
      foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null, syncMetadata: { fromCache: false, hasPendingWrites: false },
    } as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    vi.mocked(firestore.saveChatBranches).mockResolvedValue(false);
    initializeSync('synthetic-branch-consent-uid', vi.fn(), vi.fn(), true);
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledOnce());

    vi.useFakeTimers();
    const pending = syncChatBranchesToCloud([{ id: 'branch-no-replay', conversation_id: 'chat-1' }] as any);
    expect(firestore.saveChatBranches).toHaveBeenCalledTimes(1);
    setWorkspaceCloudSyncConsent(false);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBe(false);
    expect(firestore.saveChatBranches).toHaveBeenCalledTimes(1);
  });

  it('replays identity-scoped durable entity mutations after a fresh server baseline', async () => {
    const queueIdentity = `offline-replay-test-${Date.now()}`;
    globalPendingMutationQueue.setStorageIdentity(queueIdentity);
    globalPendingMutationQueue.clear();
    const uid = 'synthetic-offline-replay-uid';
    const entity = {
      id: 'offline-replay-entity', title: 'Recovered after tab restart',
      updated_at: '2020-01-01T00:00:00.000Z', created_at: '2020-01-01T00:00:00.000Z',
    } as any;
    globalPendingMutationQueue.enqueue(
      'offline-replay-mutation', entity.id, 0, 'upsert_entity',
      { id: entity.id, schema_id: 'system/task', version: 1, title: entity.title } as any,
      '2026-10-23T00:00:00.000Z',
    );
    vi.mocked(firestore.loadUserData).mockResolvedValue({
      entities: [], relationships: [], universalTags: [], messages: [], chatSessions: [],
      foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null, syncMetadata: { fromCache: false, hasPendingWrites: false },
    } as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    vi.mocked(firestore.saveUserData).mockResolvedValue(true);
    initializeSync(uid, vi.fn(), vi.fn(), true);

    try {
      await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1));
      vi.useFakeTimers();
      const recoveredWorkspace = { entities: [entity], relationships: [], universalTags: [] };
      replayPendingEntityMutations(() => recoveredWorkspace);
      await vi.advanceTimersByTimeAsync(2000);

      expect(firestore.saveUserData).toHaveBeenCalledWith(uid, expect.objectContaining({
        entities: [entity], relationships: [], universalTags: [],
      }));
      expect(globalPendingMutationQueue.getByEntityId(entity.id)).toBeDefined();
    } finally {
      vi.useRealTimers();
      globalPendingMutationQueue.clear();
      globalPendingMutationQueue.setStorageIdentity('legacy');
    }
  });

  it('replays queued entities incrementally even when their timestamp predates the last sync', async () => {
    const queueIdentity = `offline-replay-incremental-${Date.now()}`;
    globalPendingMutationQueue.setStorageIdentity(queueIdentity);
    globalPendingMutationQueue.clear();
    const uid = 'synthetic-offline-replay-incremental-uid';
    vi.mocked(firestore.loadUserData).mockResolvedValue({
      entities: [], relationships: [], universalTags: [], messages: [], chatSessions: [],
      foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null, syncMetadata: { fromCache: false, hasPendingWrites: false },
    } as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    vi.mocked(firestore.saveUserData).mockResolvedValue(true);
    vi.mocked(firestore.syncEntities).mockResolvedValue(true);
    initializeSync(uid, vi.fn(), vi.fn(), true);

    try {
      await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1));
      expect(await forceSync(() => ({ entities: [], relationships: [], universalTags: [] }))).toBe(true);
      const staleTimestampEntity = {
        id: 'offline-replay-stale-timestamp', title: 'Queue must outrank wall clock',
        updated_at: '2020-01-01T00:00:00.000Z', created_at: '2020-01-01T00:00:00.000Z',
      } as any;
      globalPendingMutationQueue.enqueue(
        'offline-replay-stale-timestamp-mutation', staleTimestampEntity.id, 0, 'upsert_entity',
        { id: staleTimestampEntity.id, schema_id: 'system/task', version: 1, title: staleTimestampEntity.title } as any,
        '2026-10-23T00:00:00.000Z',
      );
      vi.useFakeTimers();
      replayPendingEntityMutations(() => ({ entities: [staleTimestampEntity], relationships: [], universalTags: [] }));
      await vi.advanceTimersByTimeAsync(2000);

      expect(firestore.syncEntities).toHaveBeenCalledWith(uid, [staleTimestampEntity]);
    } finally {
      vi.useRealTimers();
      globalPendingMutationQueue.clear();
      globalPendingMutationQueue.setStorageIdentity('legacy');
    }
  });

  it('withholds unresolved conflicted entities from deferred whole-workspace saves', async () => {
    vi.mocked(firestore.loadUserData).mockResolvedValue({
      entities: [], relationships: [], universalTags: [], messages: [], chatSessions: [],
      foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null,
      syncMetadata: { fromCache: false, hasPendingWrites: false },
    } as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    vi.mocked(firestore.saveUserData).mockResolvedValue(true);
    initializeSync('synthetic-uid', vi.fn(), vi.fn(), true);
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1));

    const conflicted = { id: 'conflicted-entity', title: 'remote winner' } as any;
    const unrelated = { id: 'unrelated-entity', title: 'safe to save' } as any;
    setSyncConflictedEntityIds(['conflicted-entity']);
    scheduleSync(() => ({ entities: [conflicted, unrelated], relationships: [], universalTags: [] }));

    await vi.waitFor(() => expect(firestore.saveUserData).toHaveBeenCalledTimes(1), { timeout: 3000, interval: 25 });
    expect(firestore.saveUserData).toHaveBeenCalledWith('synthetic-uid', {
      entities: [unrelated], relationships: [], universalTags: [], settings: undefined,
    });
  });
});

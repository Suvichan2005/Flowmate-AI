import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/firebase', async importOriginal => ({
  ...(await importOriginal<any>()),
  isFirebaseConfigured: () => true,
}));
vi.mock('../services/firestoreSync', () => Object.fromEntries([
  'saveUserData', 'loadUserData', 'subscribeToUserData', 'unsubscribeFromUserData',
  'mergeData', 'mergeMessages', 'mergeChatSessions', 'saveMessage', 'saveFoodLogs',
  'saveAttendanceData', 'saveChatSessions', 'deleteChannelMessages', 'syncEntities',
  'syncRelationships', 'saveUserConfig',
].map(name => [name, vi.fn()])));

import * as firestore from '../services/firestoreSync';
import {
  cleanupSync,
  forceSync,
  initializeSync,
  isWorkspaceCloudSyncActiveFor,
  loadInitialData,
  setWorkspaceCloudSyncConsent,
  startRealtimeSync,
  syncMessage,
  syncWorkspaceNow,
} from '../services/syncManager';

afterEach(() => {
  cleanupSync();
  vi.clearAllMocks();
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
    vi.mocked(firestore.loadUserData).mockResolvedValue(null);
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
    };
    vi.mocked(firestore.loadUserData).mockResolvedValue(initialData as any);
    vi.mocked(firestore.subscribeToUserData).mockReturnValue(vi.fn());
    const receive = vi.fn();
    const reportStatus = vi.fn();
    initializeSync('synthetic-uid', reportStatus, receive);

    setWorkspaceCloudSyncConsent(true);
    await vi.waitFor(() => expect(firestore.loadUserData).toHaveBeenCalledWith('synthetic-uid'));
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1));
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ isInitialLoad: true, entities: [] }));
    expect(reportStatus).toHaveBeenCalledWith('idle');

    setWorkspaceCloudSyncConsent(false);
    expect(await loadInitialData()).toBeNull();
    expect(await syncMessage({ id: 'm2' } as any)).toBe(false);
    expect(firestore.saveMessage).not.toHaveBeenCalled();
  });
});

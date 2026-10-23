import { afterEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  ...Object.fromEntries([
    'saveUserData', 'loadUserData', 'subscribeToUserData', 'unsubscribeFromUserData',
    'mergeData', 'mergeMessages', 'mergeChatSessions', 'mergeCloudSettings', 'saveMessage',
    'saveFoodLogs', 'saveAttendanceData', 'saveChatSessions', 'deleteChannelMessages',
    'syncEntities', 'syncRelationships', 'saveUserConfig',
  ].map(name => [name, vi.fn()])),
  stripRemovedLocationSettings: (settings: unknown) => settings,
}));

vi.mock('../services/firebase', async importOriginal => ({
  ...(await importOriginal<any>()),
  isFirebaseConfigured: () => true,
}));
vi.mock('../services/firestoreSync', () => firestoreMocks);

import * as firestore from '../services/firestoreSync';
import { cleanupSync, initializeSync } from '../services/syncManager';
import { useStore } from '../store';

afterEach(() => {
  cleanupSync();
  useStore.setState({ currentUser: null, isDemoMode: false, toasts: [] } as any);
  window.localStorage.clear();
});

describe('manual workspace cloud actions', () => {
  it('keeps explicit sync and load actions local until this device opts in', async () => {
    useStore.setState({ currentUser: { uid: 'synthetic-unconsented' } as any, isDemoMode: false });

    await useStore.getState().syncToCloud();
    await useStore.getState().loadFromCloud();

    expect(firestore.saveUserData).not.toHaveBeenCalled();
    expect(firestore.loadUserData).not.toHaveBeenCalled();
  });

  it('does not describe a failed cloud read as an empty workspace', async () => {
    vi.mocked(firestore.loadUserData).mockResolvedValue(null);
    useStore.setState({ currentUser: { uid: 'synthetic-read-failure' } as any, isDemoMode: false });
    initializeSync('synthetic-read-failure', vi.fn(), vi.fn(), true);

    await useStore.getState().loadFromCloud();

    expect(useStore.getState().toasts.at(-1)?.message).toBe(
      'Could not load the cloud workspace. Your local data was left unchanged.',
    );
  });

  it('discards an in-flight account A read after switching to account B', async () => {
    let resolveRead!: (value: Awaited<ReturnType<typeof firestore.loadUserData>>) => void;
    const read = new Promise<Awaited<ReturnType<typeof firestore.loadUserData>>>(resolve => {
      resolveRead = resolve;
    });
    vi.mocked(firestore.loadUserData).mockImplementation(() => read);
    const originalMessages = [{
      id: 'local-B', role: 'user', text: 'B stays local', created_at: '2026-10-20T00:00:00.000Z',
    }];
    useStore.setState({
      currentUser: { uid: 'synthetic-A' } as any,
      isDemoMode: false,
      messages: originalMessages as any,
    });
    initializeSync('synthetic-A', vi.fn(), vi.fn(), true);

    const pendingLoad = useStore.getState().loadFromCloud();
    await vi.waitFor(() => expect(firestore.loadUserData).toHaveBeenCalledTimes(2));

    useStore.setState({ currentUser: { uid: 'synthetic-B' } as any });
    initializeSync('synthetic-B', vi.fn(), vi.fn(), false);
    resolveRead({
      entities: [], relationships: [], universalTags: [],
      messages: [{ id: 'private-A', role: 'assistant', text: 'A data', created_at: '2026-10-20T00:00:01.000Z' }],
      chatSessions: [], foodLogs: [], subjects: [], classSchedule: [], holidays: [], attendanceLogs: [],
      lastSyncedAt: null,
    });

    await pendingLoad;
    expect(useStore.getState().currentUser?.uid).toBe('synthetic-B');
    expect(useStore.getState().messages).toEqual(originalMessages);
  });
});

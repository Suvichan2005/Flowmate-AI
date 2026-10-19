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
import { cleanupSync } from '../services/syncManager';
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
});

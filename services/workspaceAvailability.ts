export interface AvailabilityInput {
  online: boolean; firebaseConfigured: boolean; authenticated: boolean; workspaceSyncEnabled: boolean;
  /** Firebase Auth's initial persistence lookup is still in progress. */
  authResolved?: boolean;
  syncStatus: 'idle' | 'syncing' | 'error';
  syncReadSource?: 'unknown' | 'cache' | 'server';
  syncHasPendingWrites?: boolean;
  /** Legacy queue count for other integrations (currently Calendar), not Firestore workspace writes. */
  pendingCount: number; lastSyncedAt: string | null; geminiConfigured: boolean;
}
export function describeWorkspaceAvailability(input: AvailabilityInput) {
  const authResolved = input.authResolved ?? true;
  const cloud = !input.firebaseConfigured ? 'Firebase not configured'
    : !authResolved ? 'Checking account status…'
    : !input.authenticated ? 'Cloud disconnected — sign in required'
    : !input.online ? 'Cloud disconnected — browser offline'
    : !input.workspaceSyncEnabled ? 'Workspace sync is off on this device — review Settings to connect'
    : input.syncStatus === 'error' ? 'Cloud sync error'
    : input.syncHasPendingWrites ? 'Cloud changes waiting for server confirmation'
    : input.syncReadSource === 'cache' ? 'Showing cached cloud data — checking for server updates'
    : input.syncStatus === 'syncing' ? 'Cloud sync in progress'
    : input.syncReadSource === 'server' && !input.lastSyncedAt ? 'Cloud data confirmed by server; no saved changes yet'
    : input.lastSyncedAt ? 'Cloud last synced ' + new Date(input.lastSyncedAt).toLocaleTimeString()
    : 'Cloud connection not yet verified';
  return { local: 'Local workspace', network: input.online ? 'Browser network available' : 'Browser offline', cloud,
    authentication: !authResolved ? 'Checking sign-in status' : input.authenticated ? 'Signed in' : 'Signed out',
    gemini: input.geminiConfigured ? 'Gemini configured — availability checked on request' : 'Gemini not configured' };
}

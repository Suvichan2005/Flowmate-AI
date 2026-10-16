export interface AvailabilityInput {
  online: boolean; firebaseConfigured: boolean; authenticated: boolean;
  syncStatus: 'idle' | 'syncing' | 'error';
  pendingCount: number; lastSyncedAt: string | null; geminiConfigured: boolean;
}
export function describeWorkspaceAvailability(input: AvailabilityInput) {
  const cloud = !input.firebaseConfigured ? 'Firebase not configured'
    : !input.authenticated ? 'Cloud disconnected — sign in required'
    : !input.online ? 'Cloud disconnected — browser offline'
    : input.syncStatus === 'error' ? 'Cloud sync error'
    : input.syncStatus === 'syncing' ? 'Cloud sync in progress'
    : input.pendingCount > 0 ? 'Cloud changes pending'
    : input.lastSyncedAt ? 'Cloud last synced ' + new Date(input.lastSyncedAt).toLocaleTimeString()
    : 'Cloud connection not yet verified';
  return { local: 'Local workspace', network: input.online ? 'Browser network available' : 'Browser offline', cloud,
    authentication: input.authenticated ? 'Signed in' : 'Signed out',
    gemini: input.geminiConfigured ? 'Gemini configured — availability checked on request' : 'Gemini not configured' };
}

import React, { useState, useEffect } from 'react';
import {
  globalSyncCoordinator,
  SyncStatusReport,
  SyncStorageBackend,
  getGoogleDriveAccessToken,
} from '../services/sync';

export const SyncSettings: React.FC = () => {
  const [report, setReport] = useState<SyncStatusReport>(() => globalSyncCoordinator.getStatusReport());
  const [isAuthorizingDrive, setIsAuthorizingDrive] = useState(false);
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  useEffect(() => {
    return globalSyncCoordinator.onStatusChange((nextReport) => {
      setReport(nextReport);
    });
  }, []);

  const handleSelectBackend = (backend: SyncStorageBackend) => {
    globalSyncCoordinator.setStorageBackend(backend);
  };

  const handleConnectDrive = async () => {
    setIsAuthorizingDrive(true);
    try {
      const ok = await globalSyncCoordinator.googleDriveProvider.authorize();
      if (ok) {
        globalSyncCoordinator.setStorageBackend('googledrive');
      }
    } finally {
      setIsAuthorizingDrive(false);
    }
  };

  const handleDisconnectDrive = async () => {
    await globalSyncCoordinator.googleDriveProvider.disconnect();
    globalSyncCoordinator.setStorageBackend('firestore');
  };

  const handleSyncNow = async () => {
    setIsManualSyncing(true);
    try {
      await globalSyncCoordinator.syncNow();
    } finally {
      setIsManualSyncing(false);
    }
  };

  const isDriveAuthorized = Boolean(getGoogleDriveAccessToken());

  return (
    <div className="space-y-6">
      {/* Real-time relay status pill */}
      <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            {report.relayState === 'connected' ? (
              <>
                <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping absolute opacity-75" />
                <span className="w-3 h-3 rounded-full bg-emerald-500 relative" />
              </>
            ) : report.relayState === 'connecting' ? (
              <span className="w-3 h-3 rounded-full bg-amber-400 relative animate-pulse" />
            ) : (
              <span className="w-3 h-3 rounded-full bg-zinc-500 relative" />
            )}
          </div>
          <div>
            <div className="text-sm font-medium text-white flex items-center gap-2">
              Cross-Device Real-Time Sync
              {report.relayState === 'connected' && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  {report.activePeersCount > 0 ? `${report.activePeersCount} peer${report.activePeersCount > 1 ? 's' : ''} connected` : 'Ready'}
                </span>
              )}
            </div>
            <div className="text-xs text-white/60">
              {report.relayState === 'connected'
                ? 'Bidirectional sub-50ms WebSocket relay active (bypasses ad-blockers)'
                : report.relayState === 'connecting'
                ? 'Connecting to secure live sync relay...'
                : 'Disconnected from realtime relay'}
            </div>
          </div>
        </div>

        <button
          onClick={handleSyncNow}
          disabled={isManualSyncing || report.storageBackend === 'local_vault'}
          className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 active:scale-95 disabled:opacity-50 transition-all text-white border border-white/10 flex items-center gap-2"
        >
          {isManualSyncing ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Syncing...
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Sync Now
            </>
          )}
        </button>
      </div>

      {/* Ad blocker notice if detected */}
      {report.isAdBlockerActive && (
        <div className="p-3.5 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-200 text-xs flex items-start gap-3">
          <span className="text-base">🛡️</span>
          <div>
            <div className="font-semibold text-amber-100">Ad-blocker or Brave Shield Active</div>
            <div className="mt-0.5 text-amber-300/80 leading-relaxed">
              Firebase WebChannel requests are being filtered by browser shields. Real-time updates remain active through the WebSocket Relay. For 100% unblockable cloud storage, select <strong>Google Drive (BYOS)</strong> below.
            </div>
          </div>
        </div>
      )}

      {/* Storage Backend Choices */}
      <div>
        <label className="block text-sm font-medium text-white mb-3">Storage & Sync Architecture</label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Option 1: Flowmate Cloud (Firebase) */}
          <div
            onClick={() => handleSelectBackend('firestore')}
            className={`cursor-pointer p-4 rounded-xl border transition-all ${
              report.storageBackend === 'firestore'
                ? 'border-indigo-500/50 bg-indigo-500/10 shadow-lg shadow-indigo-500/5'
                : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-lg">☁️</span>
              {report.storageBackend === 'firestore' && (
                <span className="w-2 h-2 rounded-full bg-indigo-400" />
              )}
            </div>
            <div className="font-medium text-sm text-white">Flowmate Cloud</div>
            <div className="text-xs text-white/60 mt-1 leading-relaxed">
              Google Cloud Firestore with WebSocket real-time live updates.
            </div>
          </div>

          {/* Option 2: Bring Your Own Storage (Google Drive) */}
          <div
            onClick={() => handleSelectBackend('googledrive')}
            className={`cursor-pointer p-4 rounded-xl border transition-all ${
              report.storageBackend === 'googledrive'
                ? 'border-emerald-500/50 bg-emerald-500/10 shadow-lg shadow-emerald-500/5'
                : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-lg">📁</span>
              {report.storageBackend === 'googledrive' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              )}
            </div>
            <div className="font-medium text-sm text-white">Google Drive (BYOS)</div>
            <div className="text-xs text-white/60 mt-1 leading-relaxed">
              Bring Your Own Storage: 100% private in your personal Google Drive.
            </div>
          </div>

          {/* Option 3: Local Vault */}
          <div
            onClick={() => handleSelectBackend('local_vault')}
            className={`cursor-pointer p-4 rounded-xl border transition-all ${
              report.storageBackend === 'local_vault'
                ? 'border-zinc-400/50 bg-zinc-500/10 shadow-lg shadow-zinc-500/5'
                : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-lg">🔒</span>
              {report.storageBackend === 'local_vault' && (
                <span className="w-2 h-2 rounded-full bg-zinc-400" />
              )}
            </div>
            <div className="font-medium text-sm text-white">Local Vault Only</div>
            <div className="text-xs text-white/60 mt-1 leading-relaxed">
              Air-gapped offline storage on this device only. Zero cloud sync.
            </div>
          </div>
        </div>
      </div>

      {/* Google Drive Configuration details if selected */}
      {report.storageBackend === 'googledrive' && (
        <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">Google Drive Authorization</div>
              <div className="text-xs text-white/60 mt-0.5">
                {isDriveAuthorized
                  ? 'Authenticated. Workspace data is synced to your private appDataFolder.'
                  : 'Connect your Google account to enable private workspace persistence.'}
              </div>
            </div>
            {isDriveAuthorized ? (
              <button
                onClick={handleDisconnectDrive}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all"
              >
                Disconnect Drive
              </button>
            ) : (
              <button
                onClick={handleConnectDrive}
                disabled={isAuthorizingDrive}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-sm flex items-center gap-2"
              >
                {isAuthorizingDrive ? 'Connecting...' : 'Connect Google Drive'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Diagnostics / Outbox summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-white/70">
        <div className="p-3 rounded-lg border border-white/5 bg-white/[0.01]">
          <div className="text-white/40 mb-1">Last Synced</div>
          <div className="font-mono text-white/90">
            {report.lastSyncedAt ? new Date(report.lastSyncedAt).toLocaleTimeString() : 'Never'}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-white/5 bg-white/[0.01]">
          <div className="text-white/40 mb-1">Outbox Queue</div>
          <div className="font-mono text-white/90">
            {report.pendingOutboxCount === 0 ? '0 changes' : `${report.pendingOutboxCount} pending`}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-white/5 bg-white/[0.01]">
          <div className="text-white/40 mb-1">Device ID</div>
          <div className="font-mono text-white/90 truncate" title={report.deviceId}>
            {report.deviceId.slice(0, 14)}...
          </div>
        </div>

        <div className="p-3 rounded-lg border border-white/5 bg-white/[0.01]">
          <div className="text-white/40 mb-1">Active Backend</div>
          <div className="font-medium text-white/90 capitalize">
            {report.storageBackend.replace('_', ' ')}
          </div>
        </div>
      </div>
    </div>
  );
};

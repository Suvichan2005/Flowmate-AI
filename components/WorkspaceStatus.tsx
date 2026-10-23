import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { isFirebaseConfigured } from '../services/firebase';
import { hasAiApiKey, subscribeToApiKeyStatus } from '../services/ai/client';
import { hasWorkspaceCloudSyncConsent } from '../services/workspaceSyncConsent';
import { describeWorkspaceAvailability } from '../services/workspaceAvailability';

export default function WorkspaceStatus({ detailed = false, authResolved = true }: { detailed?: boolean; authResolved?: boolean }) {
  const { currentUser, setView, syncStatus, syncReadSource, syncHasPendingWrites, syncQueue, lastSyncedAt } = useStore();
  const [online, setOnline] = useState(navigator.onLine);
  const [geminiConfigured, setGeminiConfigured] = useState(hasAiApiKey);
  useEffect(() => {
    const network = () => setOnline(navigator.onLine);
    const unsubscribeProvider = subscribeToApiKeyStatus(setGeminiConfigured);
    window.addEventListener('online', network); window.addEventListener('offline', network);
    return () => { window.removeEventListener('online', network); window.removeEventListener('offline', network); unsubscribeProvider(); };
  }, []);
  const workspaceSyncEnabled = hasWorkspaceCloudSyncConsent(currentUser?.uid);
  const status = describeWorkspaceAvailability({ online, geminiConfigured, firebaseConfigured: isFirebaseConfigured(),
    authenticated: !!currentUser, authResolved, workspaceSyncEnabled, syncStatus, syncReadSource, syncHasPendingWrites, lastSyncedAt,
    pendingCount: syncQueue.filter(q => q.status === 'pending' || q.status === 'in_progress').length });
  return <div aria-label="Workspace availability" className="text-xs text-slate-400 space-y-1">
    <p className="text-slate-200">{status.local}</p><p>{status.cloud}</p>
    {currentUser && !workspaceSyncEnabled && <button type="button" onClick={() => setView('settings')}
      className="text-left font-medium text-emerald-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
      aria-label="Review workspace sync settings">Review sync settings</button>}
    {detailed && <><p>{status.network}</p><p>{status.authentication}</p><p>{status.gemini}</p>
      <p>Configuration does not confirm a provider connection. Local rules are labeled separately from AI responses.</p></>}
  </div>;
}

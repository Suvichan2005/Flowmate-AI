import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { isFirebaseConfigured } from '../services/firebase';
import { hasAiApiKey, subscribeToApiKeyStatus } from '../services/ai/client';
import { describeWorkspaceAvailability } from '../services/workspaceAvailability';

export default function WorkspaceStatus({ detailed = false }: { detailed?: boolean }) {
  const { currentUser, syncStatus, syncQueue, lastSyncedAt } = useStore();
  const [online, setOnline] = useState(navigator.onLine);
  const [geminiConfigured, setGeminiConfigured] = useState(hasAiApiKey);
  useEffect(() => {
    const network = () => setOnline(navigator.onLine);
    const unsubscribeProvider = subscribeToApiKeyStatus(setGeminiConfigured);
    window.addEventListener('online', network); window.addEventListener('offline', network);
    return () => { window.removeEventListener('online', network); window.removeEventListener('offline', network); unsubscribeProvider(); };
  }, []);
  const status = describeWorkspaceAvailability({ online, geminiConfigured, firebaseConfigured: isFirebaseConfigured(),
    authenticated: !!currentUser, syncStatus, lastSyncedAt,
    pendingCount: syncQueue.filter(q => q.status === 'pending' || q.status === 'in_progress').length });
  return <div aria-label="Workspace availability" className="text-xs text-slate-400 space-y-1">
    <p className="text-slate-200">{status.local}</p><p>{status.cloud}</p>
    {detailed && <><p>{status.network}</p><p>{status.authentication}</p><p>{status.gemini}</p>
      <p>Configuration does not confirm a provider connection. Local rules are labeled separately from AI responses.</p></>}
  </div>;
}

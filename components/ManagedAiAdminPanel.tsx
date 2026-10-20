import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, getFirebaseAppCheckToken } from '../services/firebase';
import { getManagedAiEndpoint } from '../services/ai/managedClient';

type Overview = {
  enabled: boolean;
  liveEnabled: boolean;
  month: string;
  ordinary: { modelCalls: number; applicationLimit: number | null };
  budget: {
    enabled: boolean; currency: 'USD'; projectMonthlyLimitMicroUsd: number; userMonthlyLimitMicroUsd: number;
    maxTurnExposureMicroUsd: number; emergencyStop: boolean; month: string;
    projectReservedMicroUsd: number; projectSettledMicroUsd: number;
  };
  privileged: { accounts: number; noApplicationUsageCeiling: boolean };
  allowlist: Array<{ email: string; successfulTurns: number; modelCallsThisMonth: number; lastUsedAt: string | null }>;
  pendingInvitations: Array<{ email: string }>;
};

export default function ManagedAiAdminPanel() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [email, setEmail] = useState('');
  const [projectBudgetUsd, setProjectBudgetUsd] = useState('');
  const [userBudgetUsd, setUserBudgetUsd] = useState('');
  const [turnBudgetUsd, setTurnBudgetUsd] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const request = useCallback(async (method: 'GET' | 'POST', body?: Record<string, unknown>) => {
    const user = auth?.currentUser;
    const endpoint = getManagedAiEndpoint();
    if (!user || !endpoint) throw new Error('Admin access is unavailable in this session.');
    const [idToken, appCheckToken] = await Promise.all([user.getIdToken(), getFirebaseAppCheckToken()]);
    const response = await fetch(`${endpoint}/admin/access`, {
      method,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error?.code || 'Admin request failed.');
    return result;
  }, []);

  const refresh = useCallback(async () => {
    if (!auth?.currentUser) { setOverview(null); setMessage(''); return; }
    try {
      const next = await request('GET') as Overview;
      setOverview(next);
      if (next.budget.enabled) {
        setProjectBudgetUsd((next.budget.projectMonthlyLimitMicroUsd / 1_000_000).toFixed(2));
        setUserBudgetUsd((next.budget.userMonthlyLimitMicroUsd / 1_000_000).toFixed(2));
        setTurnBudgetUsd((next.budget.maxTurnExposureMicroUsd / 1_000_000).toFixed(2));
      }
      setMessage('');
    } catch (error) {
      setOverview(null);
      const code = (error as Error).message;
      setMessage(['ADMIN_REQUIRED', 'APP_CHECK_REQUIRED'].includes(code) ? '' : code);
    }
  }, [request]);

  useEffect(() => {
    if (!auth) return;
    void auth.authStateReady().then(refresh);
    return onAuthStateChanged(auth, () => { void refresh(); });
  }, [refresh]);

  const mutate = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMessage('');
    try {
      await request('POST', body);
      setEmail('');
      setMessage('AI access settings updated.');
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!overview && !message) return null;
  if (!overview) return message ? <p role="status" className="text-sm text-rose-300">Admin AI access could not be loaded: {message}</p> : null;

  return (
    <section aria-label="Admin AI access" className="rounded-xl border border-emerald-700/50 bg-slate-900 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Admin / AI Access</h2>
          <p className="mt-1 text-sm text-slate-400">Owner-only controls. All access decisions are checked by the server.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={overview.enabled} disabled={busy} onChange={event => {
            const enabled = event.target.checked;
            if (!enabled || window.confirm('Enable managed Gemini for eligible users? Requests will be billed to the configured Google AI project; this toggle does not set a model-call budget.')) {
              void mutate({ action: 'setEnabled', enabled });
            }
          }} />
          Managed AI enabled
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={overview.liveEnabled} disabled={busy || !overview.liveEnabled} onChange={event => {
            const enabled = event.target.checked;
            if (!enabled || window.confirm('Enable managed Live voice token issuance for eligible users? Audio use is provider-billed and is not covered by chat or briefing counters.')) {
              void mutate({ action: 'setLiveEnabled', enabled });
            }
          }} />
          Managed Live voice enabled (disable only)
        </label>
        <p className="text-xs text-slate-500 sm:col-span-2">Live remains separately gated: its direct browser-to-provider session has no server-enforced spend ceiling, so text budgets do not cover voice.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <p className="rounded-lg border border-slate-700 p-3">Managed call reservations · {overview.ordinary.modelCalls} this month ({overview.month}). This is operator telemetry, not a user allowance or a verified count of provider invocations.</p>
        <p className="rounded-lg border border-slate-700 p-3">Privileged accounts · no Flowmate usage ceiling.</p>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-700 p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Managed text spending guard</h3>
          <p className="mt-1 text-xs text-slate-400">
            {overview.budget.enabled
              ? `This month: $${(overview.budget.projectSettledMicroUsd / 1_000_000).toFixed(4)} estimated settled · $${(overview.budget.projectReservedMicroUsd / 1_000_000).toFixed(4)} reserved${overview.budget.emergencyStop ? ' · emergency stop is on' : ''}.`
              : 'Not configured. Managed text requests fail closed until an owner sets service and per-user budgets.'}
          </p>
        </div>
        {overview.budget.emergencyStop && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-700/70 bg-amber-950/30 p-3">
          <p className="text-xs text-amber-100">The emergency stop is active. Saving new ceilings will not clear it.</p>
          <button type="button" disabled={busy} onClick={() => {
            if (window.confirm('Clear the managed AI emergency stop after reviewing the provider usage and current pricing?')) {
              void mutate({ action: 'clearEmergencyStop' });
            }
          }} className="rounded-lg border border-amber-600 px-3 py-2 text-xs font-medium text-amber-100 disabled:opacity-50">Clear stop after review</button>
        </div>}
        <form className="grid gap-2 sm:grid-cols-4" onSubmit={event => {
          event.preventDefault();
          const toCents = (value: string) => {
            const amount = Number(value);
            return Number.isFinite(amount) && amount > 0 && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-7
              ? Math.round(amount * 100) : 0;
          };
          void mutate({
            action: 'setBudgetPolicy',
            projectMonthlyLimitCents: toCents(projectBudgetUsd),
            userMonthlyLimitCents: toCents(userBudgetUsd),
            maxTurnExposureCents: toCents(turnBudgetUsd),
          });
        }}>
          <label className="text-xs text-slate-400">Project / month (USD)
            <input required inputMode="decimal" type="number" min="0.01" step="0.01" value={projectBudgetUsd} onChange={event => setProjectBudgetUsd(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </label>
          <label className="text-xs text-slate-400">Per user / month (USD)
            <input required inputMode="decimal" type="number" min="0.01" step="0.01" value={userBudgetUsd} onChange={event => setUserBudgetUsd(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </label>
          <label className="text-xs text-slate-400">Per user turn (USD)
            <input required inputMode="decimal" type="number" min="0.01" step="0.01" value={turnBudgetUsd} onChange={event => setTurnBudgetUsd(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </label>
          <button disabled={busy} className="self-end rounded-lg border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-200 disabled:opacity-50">Save spending guard</button>
        </form>
        <p className="text-xs text-slate-500">Prices and holds are conservative USD estimates. Missing pricing, uncertain provider outcomes, or exhausted service budget retain exposure and stop further managed text requests.</p>
        <p className="text-xs text-slate-500">At today’s Gemini 3.8 Flash standard rate, 10k input + 2k output reserves about $0.019; a full 1M input + 8k output request reserves about $0.98. Live voice is separately gated because the browser’s direct provider session cannot enforce a strict server-side spend cap.</p>
      </div>

      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void mutate({ action: 'add', email }); }}>
        <label className="sr-only" htmlFor="managed-ai-allowlist-email">Email to allowlist</label>
        <input id="managed-ai-allowlist-email" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="Email address" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
        <button disabled={busy} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Add access</button>
      </form>
      <p className="text-xs text-slate-400">Unregistered or unverified email addresses remain pending until that exact Firebase email is verified.</p>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">Privileged accounts</h3>
        {overview.allowlist.length === 0 && overview.pendingInvitations.length === 0 && <p className="text-sm text-slate-400">No accounts are allowlisted.</p>}
        {overview.allowlist.map(entry => (
          <div key={entry.email} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 p-3">
            <div className="text-sm text-slate-200">
              <p>{entry.email}</p>
              <p className="mt-1 text-xs text-slate-400">{entry.successfulTurns} successful turns · {entry.modelCallsThisMonth} model calls this month{entry.lastUsedAt ? ` · last used ${new Date(entry.lastUsedAt).toLocaleString()}` : ''}</p>
            </div>
            <button disabled={busy} onClick={() => void mutate({ action: 'revoke', target: entry.email })} className="rounded-lg border border-rose-800 px-3 py-1.5 text-xs text-rose-200 disabled:opacity-50">Revoke</button>
          </div>
        ))}
        {overview.pendingInvitations.map(invitation => (
          <div key={invitation.email} className="flex items-center justify-between gap-2 rounded-lg border border-amber-800/60 p-3 text-sm">
            <span>{invitation.email} <span className="text-amber-300">· pending verification</span></span>
            <button disabled={busy} onClick={() => void mutate({ action: 'revoke', target: invitation.email })} className="rounded-lg border border-rose-800 px-3 py-1.5 text-xs text-rose-200 disabled:opacity-50">Revoke</button>
          </div>
        ))}
      </div>
      {message && <p role="status" className="text-sm text-emerald-300">{message}</p>}
    </section>
  );
}

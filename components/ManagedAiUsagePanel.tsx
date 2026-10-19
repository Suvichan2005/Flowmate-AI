import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { getManagedAiUsage, hasManagedAiIdentity, type ManagedAiUsage } from '../services/ai/managedClient';

const ManagedAiUsagePanel: React.FC = () => {
  const currentUser = useStore(state => state.currentUser);
  const [usage, setUsage] = useState<ManagedAiUsage | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    if (!hasManagedAiIdentity()) {
      setUsage(null);
      setUnavailable(false);
      return;
    }
    void getManagedAiUsage().then(value => {
      if (active) { setUsage(value); setUnavailable(false); }
    }).catch(() => {
      if (active) { setUsage(null); setUnavailable(true); }
    });
    return () => { active = false; };
  }, [currentUser?.uid]);

  if (!usage && !unavailable) return null;
  const resetAt = usage?.chat.resetAt
    ? new Date(usage.chat.resetAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
    : null;
  const tokenCount = (value: number) => value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
    : value >= 10_000 ? `${(value / 1_000).toFixed(0)}K` : value.toLocaleString('en-IN');
  return <section aria-label="Managed AI usage" className="mb-5 rounded-2xl border border-ideapad-border bg-ideapad-surface p-4 sm:p-5">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="font-semibold text-ideapad-text">Included AI use</h3>
      {usage && <span className="rounded-full border border-ideapad-border bg-ideapad-base px-2.5 py-1 text-[10px] uppercase tracking-wide text-ideapad-muted">{usage.tier}</span>}
    </div>
    {usage ? <>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-ideapad-base p-3"><div className="text-xs text-ideapad-muted">Chat turns this month</div><div className="mt-1 font-semibold text-ideapad-text">{usage.chat.monthlyLimit === null ? `${usage.chat.successfulTurns} used · unlimited` : `${Math.max(0, usage.chat.monthlyLimit - usage.chat.successfulTurns)} of ${usage.chat.monthlyLimit} left`}</div></div>
        <div className="rounded-xl bg-ideapad-base p-3"><div className="text-xs text-ideapad-muted">Briefings this month</div><div className="mt-1 font-semibold text-ideapad-text">{usage.briefings.monthlyLimit === null ? `${usage.briefings.successfulThisMonth} used · unlimited` : `${Math.max(0, usage.briefings.monthlyLimit - usage.briefings.successfulThisMonth)} of ${usage.briefings.monthlyLimit} left`}</div></div>
      </div>
      {resetAt && <p className="mt-2 text-[11px] text-ideapad-muted">Both allowances reset {resetAt} IST.</p>}
      <details className="mt-3 border-t border-ideapad-border pt-3 text-xs text-ideapad-muted">
        <summary className="cursor-pointer font-medium text-ideapad-text">Token usage</summary>
        {usage.tokens.usageCallsThisMonth > 0
          ? <p className="mt-2 leading-5">{tokenCount(usage.tokens.totalThisMonth)} tokens processed this month · {tokenCount(usage.tokens.inputThisMonth)} input · {tokenCount(usage.tokens.outputThisMonth)} generated{usage.tokens.thinkingThisMonth ? ` · ${tokenCount(usage.tokens.thinkingThisMonth)} thinking` : ''}. Token totals are informational, not an extra allowance; the selected model’s actual context and output limits apply.</p>
          : <p className="mt-2 leading-5">Token totals will appear here after a managed AI reply. The selected model’s actual context and output limits apply.</p>}
      </details>
    </> : <p role="status" className="text-sm text-amber-300">Usage is temporarily unavailable. Your current workspace is unchanged.</p>}
  </section>;
};

export default ManagedAiUsagePanel;

import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { getManagedAiUsage, hasManagedAiIdentity, type ManagedAiUsage } from '../services/ai/managedClient';

const tokenCount = (value: number) => value >= 1_000_000
  ? `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  : value >= 10_000 ? `${(value / 1_000).toFixed(0)}K` : value.toLocaleString('en-IN');

const resetLabel = (value: string) => new Date(value).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
});

const UsageMeter: React.FC<{
  label: string;
  period: string;
  used: number;
  limit: number | null;
  resetAt: string;
}> = ({ label, period, used, limit, resetAt }) => {
  const remaining = limit === null ? null : Math.max(0, limit - used);
  const progress = limit === null || limit === 0 ? 0 : Math.min(100, Math.max(0, used / limit * 100));
  return <div className="rounded-xl border border-ideapad-border/80 bg-ideapad-base p-3.5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-ideapad-text">{label}</p>
        <p className="mt-0.5 text-xs text-ideapad-muted">{period}</p>
      </div>
      <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-ideapad-text">
        {limit === null ? `${used.toLocaleString('en-IN')} used` : `${remaining} left`}
      </span>
    </div>
    {limit !== null && <div className="mt-3">
      <div role="progressbar" aria-label={`${label} used ${used} of ${limit}`} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)} className="h-1.5 overflow-hidden rounded-full bg-ideapad-surface">
        <div className="h-full rounded-full bg-ideapad-mint transition-[width] duration-300" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-ideapad-muted">
        <span>{used} of {limit} used</span>
        <span>Resets {resetLabel(resetAt)} IST</span>
      </div>
    </div>}
    {limit === null && <p className="mt-2 text-[11px] text-ideapad-muted">No Flowmate allowance limit</p>}
  </div>;
};

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
  return <section aria-label="Managed AI usage" className="mb-5 rounded-2xl border border-ideapad-border bg-ideapad-surface p-4 sm:p-5">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h3 className="font-semibold text-ideapad-text">AI usage</h3>
        <p className="mt-0.5 text-xs text-ideapad-muted">Your included limits and model usage</p>
      </div>
      {usage && <span className="rounded-full border border-ideapad-border bg-ideapad-base px-2.5 py-1 text-[10px] uppercase tracking-wide text-ideapad-muted">{usage.tier}</span>}
    </div>
    {usage ? <>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <UsageMeter label="Chat turns" period="Monthly" used={usage.chat.successfulTurns} limit={usage.chat.monthlyLimit} resetAt={usage.chat.resetAt} />
        <UsageMeter label="AI briefings" period="Today" used={usage.briefings.successfulToday} limit={usage.briefings.dailyLimit} resetAt={usage.briefings.resetAt} />
      </div>
      <div className="mt-3 rounded-xl border border-ideapad-border/80 bg-ideapad-base p-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-ideapad-text">Overall model usage this month</span>
          <span className="text-sm font-semibold tabular-nums text-ideapad-text">{tokenCount(usage.tokens.totalThisMonth)} tokens</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-ideapad-muted">
          Reported input, output and reasoning tokens across your managed AI use. This is a usage summary, not an extra token cap; full supported model context and output limits remain available.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ideapad-muted">
          <span>{tokenCount(usage.tokens.inputThisMonth)} input</span>
          <span>{tokenCount(usage.tokens.outputThisMonth)} generated</span>
          {usage.tokens.thinkingThisMonth > 0 && <span>{tokenCount(usage.tokens.thinkingThisMonth)} reasoning</span>}
        </div>
      </div>
    </> : <p role="status" className="text-sm text-amber-300">Usage is temporarily unavailable. Your current workspace is unchanged.</p>}
  </section>;
};

export default ManagedAiUsagePanel;

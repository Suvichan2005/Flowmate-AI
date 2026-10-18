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
  const briefingReset = usage?.briefings.date
    ? new Date(Date.parse(`${usage.briefings.date}T00:00:00+05:30`) + 24 * 60 * 60 * 1000)
        .toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
    : null;
  return <section aria-label="Managed AI usage" className="mb-5 rounded-2xl border border-ideapad-border bg-ideapad-surface p-4 sm:p-5">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="font-semibold text-ideapad-text">Included AI use</h3>
      {usage && <span className="rounded-full border border-ideapad-border bg-ideapad-base px-2.5 py-1 text-[10px] uppercase tracking-wide text-ideapad-muted">{usage.tier}</span>}
    </div>
    {usage ? <>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-ideapad-base p-3"><div className="text-xs text-ideapad-muted">Chat turns</div><div className="mt-1 font-semibold text-ideapad-text">{usage.chat.lifetimeLimit === null ? `${usage.chat.successfulTurns} used · uncapped` : `${Math.max(0, usage.chat.lifetimeLimit - usage.chat.successfulTurns)} of ${usage.chat.lifetimeLimit} left`}</div></div>
        <div className="rounded-xl bg-ideapad-base p-3"><div className="text-xs text-ideapad-muted">Briefings today</div><div className="mt-1 font-semibold text-ideapad-text">{usage.briefings.dailyLimit === null ? 'Uncapped' : `${Math.max(0, usage.briefings.dailyLimit - usage.briefings.successfulToday)} of ${usage.briefings.dailyLimit} left`}</div>{briefingReset && usage.briefings.dailyLimit !== null && <div className="mt-1 text-[11px] text-ideapad-muted">Resets {briefingReset} IST</div>}</div>
      </div>
      <details className="mt-3 border-t border-ideapad-border pt-3 text-xs text-ideapad-muted">
        <summary className="cursor-pointer font-medium text-ideapad-text">Usage details</summary>
        <p className="mt-2 leading-5">Chat turns and daily briefings have separate allowances. {usage.modelCalls.thisMonth} provider model calls are tracked this month but do not define a Flowmate allowance. Google AI Studio billing and provider limits are separate; their dashboards may be delayed. Failed requests count when a model call is submitted. Prompts and responses are not stored in this usage record.</p>
      </details>
    </> : <p role="status" className="text-sm text-amber-300">Usage is temporarily unavailable. Your current workspace is unchanged.</p>}
  </section>;
};

export default ManagedAiUsagePanel;

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
  return <section aria-label="Managed AI usage" className="mb-5 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="font-semibold text-slate-100">Flowmate AI usage</h3>
      {usage && <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">{usage.tier}</span>}
    </div>
    {usage ? <div className="grid gap-3 text-sm sm:grid-cols-3">
      <div><div className="text-slate-400">Chat allowance</div><div className="font-medium text-slate-100">{usage.chat.lifetimeLimit === null ? `${usage.chat.successfulTurns} successful turns · no Flowmate cap` : `${Math.max(0, usage.chat.lifetimeLimit - usage.chat.successfulTurns)} / ${usage.chat.lifetimeLimit} lifetime turns remaining`}</div></div>
      <div><div className="text-slate-400">Briefings available today</div><div className="font-medium text-slate-100">{usage.briefings.dailyLimit === null ? 'No Flowmate briefing cap' : `${Math.max(0, usage.briefings.dailyLimit - usage.briefings.successfulToday)} / ${usage.briefings.dailyLimit} available`}</div>{briefingReset && usage.briefings.dailyLimit !== null && <div className="mt-1 text-xs text-slate-500">Resets {briefingReset} IST</div>}</div>
      <div><div className="text-slate-400">Model calls this month</div><div className="font-medium text-slate-100">{usage.modelCalls.thisMonth} · usage tracked</div></div>
      <p className="text-xs text-slate-500 sm:col-span-3">Model calls are usage telemetry, not a Flowmate quota. Google AI Studio spending and provider quota settings are separate; verify project controls, which may be delayed and are not a guaranteed hard invoice ceiling. Briefings use a separate daily allowance and Gemini 3.8 Flash at Low reasoning. Failed provider attempts remain counted as model calls when submitted; prompts and responses are not stored in this usage record.</p>
    </div> : <p role="status" className="text-sm text-amber-300">Usage could not be read from the verified managed-AI service.</p>}
  </section>;
};

export default ManagedAiUsagePanel;

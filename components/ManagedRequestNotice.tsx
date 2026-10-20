import React from 'react';
import { AlertCircle, CircleHelp, Clock3, History, LogIn, Plus, Settings2, RotateCw } from 'lucide-react';
import { getManagedRequestGuidance } from '../services/ai/managedRequestGuidance';

interface ManagedRequestNoticeProps {
  code?: string;
  outcome?: 'not_sent' | 'uncertain';
  onNewChat: () => void;
  onRetryWithRecentContext: () => void;
  onSettings: () => void;
  onSignIn: () => void;
}

export const ManagedRequestNotice: React.FC<ManagedRequestNoticeProps> = ({ code = 'GENERATION_FAILED', outcome = 'uncertain', onNewChat, onRetryWithRecentContext, onSettings, onSignIn }) => {
  const guidance = getManagedRequestGuidance(code, outcome);
  return (
    <aside className={`mt-2 w-full rounded-lg border px-3 py-2.5 text-left ${guidance.outcome === 'uncertain' ? 'border-amber-700/50 bg-amber-950/20' : 'border-slate-700 bg-slate-900/70'}`} aria-label={guidance.outcome === 'uncertain' ? 'AI result not confirmed' : 'AI request was not sent'}>
      <div className="flex items-start gap-2">
        {guidance.outcome === 'uncertain' ? <CircleHelp size={15} className="mt-0.5 shrink-0 text-amber-300" /> : <AlertCircle size={15} className="mt-0.5 shrink-0 text-slate-300" />}
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-100">{guidance.title}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">Historical record · kept with this message · not sent in future prompts</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{guidance.description}</p>
        </div>
      </div>
      {guidance.actions.length > 0 && <div className="mt-2 flex flex-wrap gap-2 pl-5">
        {guidance.actions.includes('new_chat') && <button type="button" onClick={onNewChat} className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"><Plus size={12} /> New chat</button>}
        {guidance.actions.includes('recent_context') && <button type="button" onClick={onRetryWithRecentContext} className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"><History size={12} /> Retry with recent context</button>}
        {guidance.actions.includes('sign_in') && <button type="button" onClick={onSignIn} className="inline-flex items-center gap-1 rounded-md border border-emerald-700/70 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-950/40"><LogIn size={12} /> Sign in</button>}
        {guidance.actions.includes('reload') && <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"><RotateCw size={12} /> Reload Flowmate</button>}
        {guidance.actions.includes('settings') && <button type="button" onClick={onSettings} className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"><Settings2 size={12} /> Settings / own key</button>}
        {guidance.outcome === 'uncertain' && <span className="inline-flex items-center gap-1 self-center text-[10px] text-amber-200/80"><Clock3 size={11} /> Safety hold retained</span>}
      </div>}
    </aside>
  );
};

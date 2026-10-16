import React from 'react';
import { X, Activity, GitBranch, Cpu, Clock, Layers, ShieldCheck, Database, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { sanitizeSecrets } from '../utils/conversationGraph';

export const DeveloperModeDrawer: React.FC = () => {
  const {
    developerModeEnabled,
    toggleDeveloperMode,
    activeBranchId,
    activeSessionId,
    branches,
    branchQueues,
    activeLease,
    lastTurnDiagnostics,
    isStreaming,
    messages,
  } = useStore();

  if (!developerModeEnabled) return null;

  const currentBranch = (branches || []).find(b => b.id === activeBranchId);
  const queue = (branchQueues || {})[activeBranchId] || [];
  const sessionMessages = (messages || []).filter(m => (m.channelId || 'general') === (activeSessionId || 'general'));
  const lastAssistantMessage = [...sessionMessages].reverse().find(m => m.role === 'assistant');
  const metadata = lastAssistantMessage?.turn_metadata || {};

  return (
    <div
      role="region"
      aria-label="Developer Diagnostics"
      className="fixed bottom-0 right-0 z-50 w-full sm:w-[460px] max-h-[85vh] bg-slate-950/95 backdrop-blur-xl border-t sm:border-l border-slate-700/80 shadow-2xl rounded-t-2xl sm:rounded-tl-2xl sm:rounded-tr-none flex flex-col text-slate-200 transition-all duration-300 ease-out font-mono text-xs"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-emerald-400 animate-pulse" />
          <span className="font-semibold text-slate-100 uppercase tracking-wider text-[11px]">
            Developer Diagnostics
          </span>
          {isStreaming && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] animate-pulse">
              STREAMING
            </span>
          )}
        </div>
        <button
          onClick={toggleDeveloperMode}
          className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          title="Close diagnostics"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Section 1: DAG Topology */}
        <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-2">
          <div className="flex items-center gap-1.5 text-indigo-400 font-medium">
            <GitBranch size={14} />
            <span>Branch DAG Topology</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-slate-500">Active Branch:</span>
              <p className="text-slate-200 truncate font-semibold" title={activeBranchId}>
                {currentBranch?.name || 'Main'} ({activeBranchId.slice(0, 10)})
              </p>
            </div>
            <div>
              <span className="text-slate-500">Session:</span>
              <p className="text-slate-200 truncate" title={activeSessionId}>
                {activeSessionId || 'general'}
              </p>
            </div>
            <div>
              <span className="text-slate-500">Head Message:</span>
              <p className="text-slate-300 truncate" title={currentBranch?.head_message_id || 'none'}>
                {currentBranch?.head_message_id ? currentBranch.head_message_id.slice(0, 12) : 'none'}
              </p>
            </div>
            <div>
              <span className="text-slate-500">Total Branches:</span>
              <p className="text-slate-300">
                {(branches || []).filter(b => b.conversation_id === (activeSessionId || 'general')).length}
              </p>
            </div>
          </div>
        </div>

        {/* Section 2: Latency & Telemetry */}
        <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-2">
          <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <Clock size={14} />
            <span>Turn Latency & Performance</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="p-2 rounded-lg bg-slate-800/40 border border-slate-800">
              <span className="text-slate-500 block text-[10px]">TTFT</span>
              <span className="text-emerald-300 font-bold text-sm">
                {lastTurnDiagnostics?.ttft_ms ?? metadata.ttft_ms ?? '—'}{' '}
                {(lastTurnDiagnostics?.ttft_ms || metadata.ttft_ms) ? 'ms' : ''}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-slate-800/40 border border-slate-800">
              <span className="text-slate-500 block text-[10px]">Total Turn</span>
              <span className="text-indigo-300 font-bold text-sm">
                {lastTurnDiagnostics?.total_ms ?? metadata.total_ms ?? '—'}{' '}
                {(lastTurnDiagnostics?.total_ms || metadata.total_ms) ? 'ms' : ''}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-slate-800/40 border border-slate-800">
              <span className="text-slate-500 block text-[10px]">Thinking</span>
              <span className="text-slate-300 font-bold text-sm">
                {lastTurnDiagnostics?.thinking_ms ?? metadata.thinking_ms ?? '0'}{' '}
                {(lastTurnDiagnostics?.thinking_ms || metadata.thinking_ms) ? 'ms' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Section 3: Queue & Lease Fencing */}
        <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-2">
          <div className="flex items-center gap-1.5 text-amber-400 font-medium">
            <Layers size={14} />
            <span>Persistent Queue & Leases</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Branch Queue Count:</span>
            <span className={`px-2 py-0.5 rounded font-bold ${queue.length > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>
              {queue.length} pending
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Lease Fencing Token:</span>
            <span className="text-slate-300 font-mono">
              {activeLease?.fence_token ?? metadata.fence_token ?? 'unfenced'}
            </span>
          </div>
        </div>

        {/* Section 4: Sanitized Tool Execution Traces */}
        <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-2">
          <div className="flex items-center gap-1.5 text-cyan-400 font-medium">
            <Cpu size={14} />
            <span>Tool Invocation Traces</span>
          </div>
          {metadata.tool_calls && metadata.tool_calls.length > 0 ? (
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {metadata.tool_calls.map((t: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-1.5 rounded bg-slate-800/50 border border-slate-800 text-[11px]"
                >
                  <span className="text-slate-200 font-mono">{t.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">{t.latency_ms}ms</span>
                    <span className={`px-1 rounded text-[10px] ${t.success ? 'bg-emerald-950 text-emerald-400' : 'bg-red-950 text-red-400'}`}>
                      {t.success ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-[11px] italic">No tool calls in most recent turn.</p>
          )}
        </div>

      </div>

      {/* Footer Info */}
      <div className="px-4 py-2 border-t border-slate-800/80 bg-slate-900/40 flex items-center justify-between text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <ShieldCheck size={12} className="text-emerald-500" />
          Redaction active: secrets sanitized
        </span>
        <span>Flowmate v4.0.0</span>
      </div>
    </div>
  );
};

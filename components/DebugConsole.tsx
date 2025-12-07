import React, { useState } from 'react';
import { useStore } from '../store';
import { Terminal, X, Trash2, ChevronDown, ChevronRight, Copy, Check, Maximize2, Minimize2, Wand2 } from 'lucide-react';

type DetailTab = 'all' | 'system' | 'context' | 'history' | 'response';

interface DebugConsoleProps {
  onOpenGraphFixer?: () => void;
}

const DebugConsole: React.FC<DebugConsoleProps> = ({ onOpenGraphFixer }) => {
  const { settings, debugLogs, clearDebugLogs } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('all');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!settings?.debug_mode) return null;

  const logs = debugLogs || [];

  const copyToClipboard = async (text: string, fieldId: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const renderDetailSection = (log: any, tab: DetailTab) => {
    const details = log.details || {};

    // Helper to render a section with copy button
    const Section = ({ title, content, fieldId }: { title: string; content: any; fieldId: string }) => {
      const textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      return (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-indigo-400 font-semibold text-xs uppercase">{title}</span>
            <button
              onClick={() => copyToClipboard(textContent, fieldId)}
              className="p-1 hover:bg-slate-700 rounded text-slate-500 hover:text-emerald-400"
              title="Copy to clipboard"
            >
              {copiedField === fieldId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            </button>
          </div>
          <pre className="bg-slate-950 p-2 rounded border border-slate-800 overflow-x-auto text-[11px] whitespace-pre-wrap max-h-48 overflow-y-auto">
            {textContent}
          </pre>
        </div>
      );
    };

    if (tab === 'all') {
      return <pre className="overflow-x-auto text-[11px]">{JSON.stringify(details, null, 2)}</pre>;
    }

    if (tab === 'system' && details.systemInstruction) {
      return <Section title="System Instruction" content={details.systemInstruction} fieldId={`${log.id}-system`} />;
    }

    if (tab === 'context' && details.contextPrompt) {
      return (
        <>
          <Section title="Context Prompt" content={details.contextPrompt} fieldId={`${log.id}-context`} />
          <Section title="User Message" content={details.userMessage || 'N/A'} fieldId={`${log.id}-user`} />
        </>
      );
    }

    if (tab === 'history' && details.history) {
      return <Section title={`Conversation History (${details.historyLength} messages)`} content={details.history} fieldId={`${log.id}-history`} />;
    }

    if (tab === 'response') {
      if (details.functionCalls) {
        return (
          <>
            {details.textPreview && <Section title="Text Response" content={details.textPreview} fieldId={`${log.id}-text`} />}
            <Section title="Function Calls" content={details.functionCalls} fieldId={`${log.id}-calls`} />
            {details.rawCandidates && <Section title="Raw Candidates" content={details.rawCandidates} fieldId={`${log.id}-candidates`} />}
          </>
        );
      }
      return <div className="text-slate-600 italic">No response data in this log entry</div>;
    }

    return <div className="text-slate-600 italic">No data available for this tab</div>;
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-slate-900 border border-slate-700 text-indigo-400 p-2 rounded-full shadow-lg hover:bg-slate-800 transition-colors z-50 flex items-center gap-2"
        title="Open Debug Console"
      >
        <Terminal size={18} />
        {logs.length > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 rounded-full absolute -top-1 -right-1">
            {logs.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={`fixed bottom-0 left-0 right-0 ${isExpanded ? 'h-[80vh]' : 'h-80'} bg-slate-900 border-t border-slate-700 shadow-2xl z-50 flex flex-col font-mono text-sm transition-all duration-200`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2 text-indigo-400 font-semibold">
          <Terminal size={16} />
          <span>Flowmate Debug Console</span>
          <span className="text-slate-600 text-xs">({logs.length} logs)</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 transition-colors"
            title={isExpanded ? "Minimize" : "Maximize"}
          >
            {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          {onOpenGraphFixer && (
            <button
              onClick={onOpenGraphFixer}
              className="p-1.5 hover:bg-slate-800 rounded text-violet-400 hover:text-violet-300 transition-colors"
              title="AI Graph Fixer"
            >
              <Wand2 size={14} />
            </button>
          )}
          <button
            onClick={clearDebugLogs}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-500 hover:text-red-400 transition-colors"
            title="Clear Logs"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Logs List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-900">
        {logs.length === 0 ? (
          <div className="text-slate-600 italic text-center mt-8">No logs captured yet. Interaction with the app will appear here.</div>
        ) : (
          logs.map(log => (
            <div key={log.id} className="border border-slate-800 rounded bg-slate-950/50">
              <div
                className="flex items-center gap-3 p-2 cursor-pointer hover:bg-slate-800/50"
                onClick={() => {
                  setExpandedLogId(expandedLogId === log.id ? null : log.id);
                  setActiveTab('all');
                }}
              >
                <span className="text-slate-500 text-[10px] w-14 shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${log.type === 'orchestrator' ? 'bg-indigo-500/20 text-indigo-400' :
                  log.type === 'sync' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'
                  }`}>
                  {log.type}
                </span>
                <span className="text-slate-300 truncate flex-1 text-xs">{log.summary}</span>
                {expandedLogId === log.id ? <ChevronDown size={14} className="text-slate-600" /> : <ChevronRight size={14} className="text-slate-600" />}
              </div>

              {expandedLogId === log.id && (
                <div className="border-t border-slate-800 bg-slate-950">
                  {/* Tabs for LLM logs */}
                  {log.summary.includes('LLM') && (
                    <div className="flex gap-1 px-2 pt-2 border-b border-slate-800 pb-2">
                      {(['all', 'system', 'context', 'history', 'response'] as DetailTab[]).map(tab => (
                        <button
                          key={tab}
                          onClick={() => setActiveTab(tab)}
                          className={`px-2 py-1 text-[10px] rounded font-medium transition-colors ${activeTab === tab
                            ? 'bg-indigo-500/30 text-indigo-300'
                            : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                            }`}
                        >
                          {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="p-3 text-xs text-slate-400 overflow-x-auto max-h-64 overflow-y-auto">
                    {log.summary.includes('LLM')
                      ? renderDetailSection(log, activeTab)
                      : <pre>{JSON.stringify(log.details, null, 2)}</pre>
                    }
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default DebugConsole;
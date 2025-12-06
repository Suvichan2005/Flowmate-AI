import React, { useState } from 'react';
import { useStore } from '../store';
import { Terminal, X, Trash2, ChevronDown, ChevronRight } from 'lucide-react';

const DebugConsole: React.FC = () => {
  const { settings, debugLogs, clearDebugLogs } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  if (!settings?.debug_mode) return null;

  const logs = debugLogs || [];

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
    <div className="fixed bottom-0 left-0 right-0 h-72 bg-slate-900 border-t border-slate-700 shadow-2xl z-50 flex flex-col font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center gap-2 text-indigo-400 font-semibold">
          <Terminal size={16} />
          <span>Flowmate Debug Console</span>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={clearDebugLogs}
            className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-red-400 transition-colors"
            title="Clear Logs"
          >
            <Trash2 size={16} />
          </button>
          <button 
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Logs List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-900">
        {logs.length === 0 ? (
          <div className="text-slate-600 italic text-center mt-8">No logs captured yet. Interaction with the app will appear here.</div>
        ) : (
          logs.map(log => (
            <div key={log.id} className="border border-slate-800 rounded bg-slate-950/50">
              <div 
                className="flex items-center gap-3 p-2 cursor-pointer hover:bg-slate-800/50"
                onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
              >
                <span className="text-slate-500 text-[10px] w-16 shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className={`text-xs font-bold uppercase w-20 shrink-0 ${
                  log.type === 'orchestrator' ? 'text-indigo-400' :
                  log.type === 'sync' ? 'text-emerald-400' : 'text-slate-400'
                }`}>
                  [{log.type}]
                </span>
                <span className="text-slate-300 truncate flex-1">{log.summary}</span>
                {expandedLogId === log.id ? <ChevronDown size={14} className="text-slate-600" /> : <ChevronRight size={14} className="text-slate-600" />}
              </div>
              
              {expandedLogId === log.id && (
                <div className="p-2 border-t border-slate-800 bg-slate-950 text-xs text-slate-400 overflow-x-auto">
                   <pre>{JSON.stringify(log.details, null, 2)}</pre>
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
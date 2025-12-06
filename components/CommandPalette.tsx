
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { EntityKind, ViewType } from '../types';
import { Search, Command, ArrowRight, Target, LayoutDashboard, Calendar, BookOpen, Network, CheckSquare, Sparkles } from 'lucide-react';
import { orchestrateMessage } from '../services/geminiService';

const CommandPalette: React.FC = () => {
  const { entities, selectEntity, setView, addMessage, setPendingOps, getSnapshot, messages } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  // Global Key Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus Input on Open
  useEffect(() => {
    if (isOpen) {
        setQuery('');
        setSelectedIndex(0);
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const filteredItems = useMemo(() => {
    if (!query) return [];
    
    const q = query.toLowerCase();
    
    // 1. Navigation Commands
    const navCommands = [
        { id: 'nav-dash', title: 'Go to Dashboard', subtitle: 'View', icon: <LayoutDashboard size={14} />, type: 'COMMAND', action: () => setView('dashboard') },
        { id: 'nav-graph', title: 'Go to Graph', subtitle: 'View', icon: <Network size={14} />, type: 'COMMAND', action: () => setView('chat_graph') },
        { id: 'nav-goals', title: 'Go to Goals', subtitle: 'View', icon: <Target size={14} />, type: 'COMMAND', action: () => setView('goals') },
        { id: 'nav-proj', title: 'Go to Projects', subtitle: 'View', icon: <BookOpen size={14} />, type: 'COMMAND', action: () => setView('projects') },
        { id: 'nav-cal', title: 'Go to Calendar', subtitle: 'View', icon: <Calendar size={14} />, type: 'COMMAND', action: () => setView('calendar') },
    ].filter(item => item.title.toLowerCase().includes(q));

    // 2. Entity Search
    const entityResults = entities
        .filter(e => e.title.toLowerCase().includes(q) || e.kind.toLowerCase().includes(q))
        .slice(0, 10)
        .map(e => ({
            id: e.id,
            title: e.title,
            subtitle: e.kind,
            icon: <CheckSquare size={14} />,
            type: 'ENTITY',
            action: () => {
                selectEntity(e.id);
            }
        }));

    return [...navCommands, ...entityResults];
  }, [query, entities, setView, selectEntity]);

  const handleSelect = async (index: number) => {
      const item = filteredItems[index];
      if (item) {
          item.action();
          setIsOpen(false);
      } else if (query.trim()) {
          // Fallback: Ask AI
          await handleAskAI();
      }
  };

  const handleAskAI = async () => {
      setLoading(true);
      const userText = query;
      setQuery(''); // Clear visual feedback
      setIsOpen(false);

      // Save history before adding
      const history = messages;

      // Add to chat history
      const msgId = addMessage('user', userText);

      try {
          // Trigger Orchestrator
          const snapshot = getSnapshot();
          const toon = await orchestrateMessage(history, userText, snapshot);

          if (toon.ops && toon.ops.length > 0) {
              setPendingOps(toon.ops, msgId);
              addMessage('assistant', toon.assistant.message || "I've proposed some changes.", toon.ops);
          } else {
              addMessage('assistant', toon.assistant.message || "Done.");
          }
      } catch (err) {
          console.error(err);
      } finally {
          setLoading(false);
      }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
          e.preventDefault();
          // Allow going one past the last item to select the "Ask AI" fallback implicitly if desired, 
          // but for now let's keep it simple: if list is empty, enter triggers Ask AI.
          if (filteredItems.length > 0) {
              setSelectedIndex(prev => (prev + 1) % filteredItems.length);
          }
      } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (filteredItems.length > 0) {
              setSelectedIndex(prev => (prev - 1 + filteredItems.length) % filteredItems.length);
          }
      } else if (e.key === 'Enter') {
          e.preventDefault();
          handleSelect(selectedIndex);
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] bg-black/60 backdrop-blur-sm px-4">
        <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-3 p-4 border-b border-slate-800">
                <Search className="text-slate-500 w-5 h-5" />
                <input 
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a command, search, or ask AI..."
                    className="flex-1 bg-transparent text-slate-100 text-lg outline-none placeholder:text-slate-600"
                />
                <div className="text-xs text-slate-500 border border-slate-700 px-1.5 py-0.5 rounded">ESC</div>
            </div>
            
            <div className="max-h-[300px] overflow-y-auto p-2">
                {filteredItems.length === 0 && query ? (
                    <div 
                        onClick={handleAskAI}
                        className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors bg-indigo-600/20 text-indigo-100"
                    >
                         <div className="p-2 rounded bg-indigo-600 text-white">
                            <Sparkles size={14} />
                         </div>
                         <div className="flex-1">
                            <div className="text-sm font-medium">Ask AI to "{query}"</div>
                            <div className="text-[10px] opacity-70">Create tasks, log activity, or query graph</div>
                         </div>
                         <ArrowRight size={14} className="opacity-50" />
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 text-sm">Type to search or run commands.</div>
                ) : (
                    filteredItems.map((item, idx) => (
                        <div 
                            key={item.id}
                            onClick={() => handleSelect(idx)}
                            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                                idx === selectedIndex ? 'bg-indigo-600/20 text-indigo-100' : 'text-slate-400 hover:bg-slate-800'
                            }`}
                        >
                            <div className={`p-2 rounded ${idx === selectedIndex ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                                {item.icon}
                            </div>
                            <div className="flex-1">
                                <div className="text-sm font-medium">{item.title}</div>
                                {item.type === 'ENTITY' && (
                                    <div className="text-[10px] opacity-70 font-mono">{item.subtitle}</div>
                                )}
                            </div>
                            {idx === selectedIndex && <ArrowRight size={14} className="opacity-50" />}
                        </div>
                    ))
                )}
            </div>
            
            <div className="p-2 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-600 flex justify-end gap-3 px-4">
                <span><strong className="text-slate-500">↑↓</strong> to navigate</span>
                <span><strong className="text-slate-500">↵</strong> to select</span>
            </div>
        </div>
        
        {/* Backdrop click to close */}
        <div className="absolute inset-0 -z-10" onClick={() => setIsOpen(false)}></div>
    </div>
  );
};

export default CommandPalette;

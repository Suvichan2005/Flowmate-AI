import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { EntityKind, ViewType, Entity } from '../types';
import {
  Search,
  Command,
  ArrowRight,
  Target,
  LayoutDashboard,
  Calendar,
  BookOpen,
  Network,
  CheckSquare,
  Sparkles,
  BarChart3,
  Clock,
  Library,
  UtensilsCrossed,
  GraduationCap,
  CalendarDays,
  Settings,
  X,
  Lock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Flame,
  ShieldCheck,
  Brain
} from 'lucide-react';

import { inferIntentFromQuery, InferredIntent } from '../utils/intentParser';
import { extractMemoryItem } from '../services/context/resolver';
import { findCalendarConflicts, evaluateCandidateSlot, CalendarConflict, CandidateSlotEvaluation } from '../utils/calendarConflicts';

export const CommandPalette: React.FC<{ onSendToChat: (text: string) => void }> = ({ onSendToChat }) => {
  const {
    entities,
    selectEntity,
    setView,
    addMessage,
    setPendingOps,
    getSnapshot,
    messages,
    kernelEntities,
  } = useStore();

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  // Global Key Listener for Cmd+K / Ctrl+K and Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
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

  useEffect(() => {
    const open = () => setIsOpen(true);
    window.addEventListener('flowmate:commands-open', open);
    return () => window.removeEventListener('flowmate:commands-open', open);
  }, []);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery(''); setSelectedIndex(0);
    inputRef.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]') || []).filter(e => e.getClientRects().length > 0);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, [isOpen]);
  useEffect(() => setSelectedIndex(0), [query]);

  // Real-time zero-latency Intent Parser (Model Delta)
  const inferredIntent: InferredIntent | null = useMemo(() => {
    // Navigation, questions and unresolved updates are never silently turned into tasks.
    const parsed = inferIntentFromQuery(query);
    const explicitCreate = /^(?:(?:add|create)\s+(?:a\s+)?(?:task|goal|habit|event|commitment)\b|study\b)/i.test(query.trim());
    const timedEvent = parsed?.kind === 'EVENT' && /\b(?:at|from)\s+\d/i.test(query);
    return (explicitCreate || timedEvent) && parsed?.operations.every(op => op.type === 'create_entity') ? parsed : null;
  }, [query]);

  // Read-only Calendar Conflict Grounding (Workflow 2)
  const slotEvaluation: CandidateSlotEvaluation | null = useMemo(() => {
    if (!inferredIntent) return null;
    if (inferredIntent.kind !== 'EVENT' && inferredIntent.kind !== 'RESCHEDULE') return null;
    if (!inferredIntent.startTimeIso || !inferredIntent.endTimeIso) return null;

    return evaluateCandidateSlot(
      {
        startTimeIso: inferredIntent.startTimeIso,
        endTimeIso: inferredIntent.endTimeIso,
      },
      entities
    );
  }, [inferredIntent, entities]);

  const calendarConflicts: CalendarConflict[] = useMemo(() => {
    return slotEvaluation?.conflicts || [];
  }, [slotEvaluation]);

  // Filtered Navigation & Entity search items
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
      { id: 'nav-analytics', title: 'Go to Analytics', subtitle: 'View', icon: <BarChart3 size={14} />, type: 'COMMAND', action: () => setView('analytics') },
      { id: 'nav-timeline', title: 'Go to Timeline', subtitle: 'View', icon: <Clock size={14} />, type: 'COMMAND', action: () => setView('timeline') },
      { id: 'nav-knowledge', title: 'Go to Knowledge Base', subtitle: 'View', icon: <Library size={14} />, type: 'COMMAND', action: () => setView('knowledge') },
      { id: 'nav-settings', title: 'Go to Settings', subtitle: 'View', icon: <Settings size={14} />, type: 'COMMAND', action: () => setView('settings') },
    ].filter(item => item.title.toLowerCase().includes(q));

    // 2. Entity Search
    const entityResults = entities
      .filter(e => !e.metadata?.deleted && !(e as any).deleted && (e.title.toLowerCase().includes(q) || e.kind.toLowerCase().includes(q)))
      .slice(0, 10)
      .map(e => ({
        id: e.id,
        title: e.title,
        subtitle: `${e.kind} ${e.status ? `• ${e.status}` : ''}`,
        icon: <CheckSquare size={14} />,
        type: 'ENTITY',
        action: () => {
          selectEntity(e.id);
        }
      }));

    // 3. Memory & Preference Items (Workflow 4)
    const memoryResults = Object.values(kernelEntities || {})
      .filter(k => k.schema_id === 'system/memory_item' && !k.lifecycle?.deleted_at)
      .map(k => ({ entity: k, mem: extractMemoryItem(k) }))
      .filter(({ entity: k, mem }) => {
        const text = `${k.title || ''} ${mem.content || ''} ${mem.category || ''} ${(mem.tags || []).join(' ')}`.toLowerCase();
        return text.includes(q);
      })
      .slice(0, 8)
      .map(({ entity: k, mem }) => {
        const isSuperseded = mem.status === 'superseded' || Boolean(mem.superseded_by);
        const isUserStated =
          mem.speaker === 'user' ||
          mem.source_type === 'user_explicit' ||
          mem.source_type === 'user_confirmed' ||
          mem.epistemic_status === 'user_decision';
        const badge = isSuperseded ? 'SUPERSEDED' : isUserStated ? 'USER DECISION' : 'PROPOSAL';

        return {
          id: k.id,
          title: mem.content.length > 50 ? mem.content.slice(0, 48) + '...' : mem.content,
          subtitle: `BELIEF • ${mem.category.toUpperCase()} • ${badge}`,
          icon: (
            <Brain
              size={14}
              className={
                isSuperseded ? 'text-amber-400' : isUserStated ? 'text-emerald-400' : 'text-indigo-400'
              }
            />
          ),
          type: 'MEMORY',
          action: () => {
            selectEntity(k.id);
          }
        };
      });

    return [...navCommands, ...entityResults, ...memoryResults];
  }, [query, entities, kernelEntities, setView, selectEntity]);

  // Stage Parsed Intent into Two-Phase Confirmation
  const handleStageIntent = (intent: InferredIntent) => {
    setPendingOps(intent.operations, undefined);
    setIsOpen(false);
  };

  const handleSelect = async (index: number) => {
    const item = filteredItems[index];
    if (item) {
      item.action();
      setIsOpen(false);
    } else if (inferredIntent) {
      handleStageIntent(inferredIntent);
    } else if (query.trim()) {
      await handleAskAI();
    }
  };

  const handleAskAI = async () => {
    const draft = query.trim();
    if (!draft) return;
    setIsOpen(false);
    onSendToChat(draft);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
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
      if (filteredItems[selectedIndex]) handleSelect(selectedIndex);
      else if (inferredIntent) handleStageIntent(inferredIntent);
      else void handleAskAI();
    }
  };

  return (
    <>
      {/* 2. Omni-Command Palette Modal (Desktop centered / Mobile bottom sheet) */}
      {isOpen && (
        <div
          className={`fixed inset-0 z-[100] flex ${
            isMobile ? 'items-end' : 'items-start justify-center pt-[15vh]'
          } bg-black/70 backdrop-blur-sm px-0 sm:px-4 animate-fade-in`}
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette and intent capture"
          data-testid="omni-command-palette-modal"
        >
          <div
            className={`w-full sm:max-w-xl bg-slate-900 border-t sm:border border-slate-700 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh] sm:max-h-[80vh] animate-in fade-in zoom-in-95 duration-150`}
          >
            {/* Input Bar */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-800">
              <Search className="text-indigo-400 w-5 h-5 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Type an intention (e.g. 'Study DSA at 16:00 for 90m') or search..."
                className="flex-1 bg-transparent text-slate-100 text-base sm:text-lg outline-none placeholder:text-slate-500"
                aria-label="Intention and search input"
              />
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                aria-label="Close command palette"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable Results Stream */}
            <div className="max-h-[460px] overflow-y-auto p-3 space-y-3">
              {/* Model Delta Instant Intent Card (Zero-Latency Local Extraction) */}
              {inferredIntent && (
                <div
                  className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/40 shadow-lg space-y-2.5 animate-in fade-in duration-150"
                  data-testid="inferred-intent-card"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold tracking-wider uppercase">
                        INTENT • {inferredIntent.kind}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                        {inferredIntent.priorityLabel}
                      </span>
                    </div>

                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-100">{inferredIntent.title}</h4>
                    <p className="text-xs text-indigo-200/80 mt-0.5 font-mono">{inferredIntent.diffSummary}</p>
                  </div>

                  {/* Read-only Calendar Conflict Grounding Alert */}
                  {(inferredIntent.kind === 'EVENT' || inferredIntent.kind === 'RESCHEDULE') && slotEvaluation && (
                    <div className="pt-2 border-t border-indigo-500/20" data-testid="calendar-grounding-section">
                      {slotEvaluation.status === 'invalid_interval' ? (
                        <div
                          className="px-2.5 py-1.5 rounded-lg bg-amber-950/30 border border-amber-500/30 flex items-center gap-2 text-[11px] text-amber-300"
                          data-testid="calendar-invalid-interval-badge"
                        >
                          <AlertCircle size={13} className="text-amber-400 shrink-0" />
                          <span>Invalid Time Interval ({slotEvaluation.validationError || 'End must be after start'}) • Verification Unavailable</span>
                        </div>
                      ) : calendarConflicts.length > 0 ? (
                        <div
                          className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/40 space-y-2 text-xs"
                          data-testid="calendar-conflict-alert"
                        >
                          <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                            <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                            <span>
                              Schedule Conflict Detected ({calendarConflicts.length} collision{calendarConflicts.length > 1 ? 's' : ''})
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {calendarConflicts.map(c => (
                              <div
                                key={c.collidingEventId}
                                className="p-1.5 rounded bg-slate-900/80 border border-amber-500/20 text-[11px] flex flex-col gap-0.5"
                                data-testid={`conflict-item-${c.collidingEventId}`}
                              >
                                <div className="flex items-center justify-between text-slate-200">
                                  <span className="font-medium truncate max-w-[240px]">
                                    {c.collidingEventTitle}
                                  </span>
                                  <span className="text-amber-400 font-mono text-[10px] shrink-0">
                                    {c.overlapMinutes}m overlap
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 flex-wrap">
                                  <span>{c.formattedTimeSpan}</span>
                                  <span>•</span>
                                  <span className="text-indigo-300 font-mono">Src: {c.sourceAttribution}</span>
                                  {c.freshnessStatus === 'stale_historical' && (
                                    <span className="text-amber-400/90 bg-amber-950/70 border border-amber-600/30 px-1 py-0.2 rounded text-[9px]">
                                      Past / Historical
                                    </span>
                                  )}
                                  {c.freshnessStatus === 'estimated_duration' && (
                                    <span className="text-slate-300 bg-slate-800 px-1 py-0.2 rounded text-[9px]">
                                      Estimated duration
                                    </span>
                                  )}
                                  {c.freshnessStatus === 'tentative' && (
                                    <span className="text-cyan-300 bg-cyan-950/70 border border-cyan-500/30 px-1 py-0.2 rounded text-[9px]">
                                      Tentative Hold
                                    </span>
                                  )}
                                  {c.syncFreshness === 'stale' && (
                                    <span className="text-amber-300 bg-amber-950/70 border border-amber-500/30 px-1 py-0.2 rounded text-[9px]">
                                      Stale Sync
                                    </span>
                                  )}
                                  {c.syncFreshness === 'unverified' && (
                                    <span className="text-rose-300 bg-rose-950/70 border border-rose-500/30 px-1 py-0.2 rounded text-[9px]">
                                      Unverified Sync
                                    </span>
                                  )}
                                  {c.isAllDay && (
                                    <span className="text-purple-300 bg-purple-950/70 px-1 py-0.2 rounded text-[9px]">
                                      All-Day
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-amber-300/70 italic">
                            Read-only conflict awareness. Existing schedule remains untouched.
                          </p>
                        </div>
                      ) : (
                        <div
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 flex items-center gap-2 text-[11px] text-emerald-300"
                          data-testid="calendar-no-conflict-badge"
                        >
                          <ShieldCheck size={13} className="text-emerald-400 shrink-0" />
                          <span>No Schedule Conflicts • Slot is Clear in Local Graph</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-between gap-2 border-t border-indigo-500/20">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Lock size={12} className="text-cyan-400" />
                      <span>Preview only — review before applying</span>
                    </div>
                    <button
                      onClick={() => handleStageIntent(inferredIntent)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 shadow-md shadow-indigo-900/40 transition-colors cursor-pointer"
                    >
                      <CheckCircle2 size={13} />
                      <span>Review &amp; Stage (↵)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Entity Results & Commands */}
              {filteredItems.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-2 py-1">
                    Matching Items ({filteredItems.length})
                  </div>
                  {filteredItems.map((item, idx) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => handleSelect(idx)}
                      className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${
                        idx === selectedIndex
                          ? 'bg-indigo-600/20 text-indigo-100 border border-indigo-500/30'
                          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                      }`}
                    >
                      <div
                        className={`p-2 rounded-lg ${
                          idx === selectedIndex ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-200 truncate">{item.title}</div>
                        <div className="text-[10px] text-slate-500 truncate">{item.subtitle}</div>
                      </div>
                      {idx === selectedIndex && <ArrowRight size={14} className="text-indigo-400 shrink-0" />}
                    </button>
                  ))}
                </div>
              )}

              {/* Ask AI Fallback Option */}
              {query && !inferredIntent && filteredItems.length === 0 && (
                <button
                  type="button"
                  onClick={handleAskAI}
                  className="flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-colors bg-indigo-600/15 border border-indigo-500/30 text-indigo-100 hover:bg-indigo-600/25"
                >
                  <div className="p-2 rounded-lg bg-indigo-600 text-white">
                    <Sparkles size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">Send to Chat: &quot;{query}&quot;</div>
                    <div className="text-xs text-indigo-300/70 mt-0.5">
                      Copy into the existing chat draft; review before sending
                    </div>
                  </div>
                  <ArrowRight size={16} className="text-indigo-400 shrink-0" />
                </button>
              )}

              {/* Empty Query Prompt */}
              {!query && (
                <div className="p-6 text-center text-slate-500 text-xs space-y-2">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 mx-auto flex items-center justify-center text-slate-400">
                    <Command size={18} />
                  </div>
                  <p className="font-medium text-slate-300">Fast Intention Capture &amp; Navigation</p>
                  <p className="max-w-xs mx-auto text-slate-500">
                    Type a commitment like <span className="text-indigo-300">&quot;Study DSA at 16:00 for 90m&quot;</span> or search your graph.
                  </p>
                </div>
              )}
            </div>

            {/* Footer Bar */}
            <div className="p-2.5 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <span>
                  <strong className="text-slate-400">↑↓</strong> Navigate
                </span>
                <span>
                  <strong className="text-slate-400">↵</strong> Select / Stage
                </span>
                <span>
                  <strong className="text-slate-400">ESC</strong> Close
                </span>
              </div>
              <span className="font-mono text-slate-600">Search and commands</span>
            </div>
          </div>

          {/* Backdrop click to close */}
          <div className="absolute inset-0 -z-10" onClick={() => setIsOpen(false)} />
        </div>
      )}
    </>
  );
};

export default CommandPalette;

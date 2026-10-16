import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus, Entity, ToonOperation } from '../types';
import {
  CalendarClock,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Calendar,
  ArrowRight,
  Check,
  X,
  ShieldCheck,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface ScheduleCollision {
  eventA: Entity;
  eventB: Entity;
  timeSlot: string;
}

export const InterruptedDayRecovery: React.FC = () => {
  const {
    entities: rawEntities,
    applyOperations,
    addToast,
    selectEntity,
    setPendingOrchestration,
    setView
  } = useStore();

  const [activeTab, setActiveTab] = useState<'all' | 'tasks' | 'events' | 'conflicts'>('all');
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Active entities
  const entities = useMemo(() => {
    return rawEntities.filter(e => !e.metadata?.deleted && !(e as any).deleted && e.status !== EntityStatus.ARCHIVED);
  }, [rawEntities]);

  const now = useMemo(() => new Date(), []);

  // 1. Overdue Tasks: Active tasks whose deadline is in the past
  const overdueTasks = useMemo(() => {
    const currentTime = Date.now();
    return entities
      .filter(e => {
        if (e.kind !== EntityKind.TASK) return false;
        if (e.status === EntityStatus.COMPLETED || e.status === EntityStatus.ARCHIVED) return false;
        if (!e.deadline) return false;
        const deadlineTime = new Date(e.deadline).getTime();
        return !isNaN(deadlineTime) && deadlineTime < currentTime;
      })
      .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime());
  }, [entities]);

  // 2. Unconfirmed Past Events: Events from past 48h that ended without confirmation
  const unconfirmedPastEvents = useMemo(() => {
    const currentTime = Date.now();
    const fortyEightHoursAgo = currentTime - 48 * 60 * 60 * 1000;

    return entities
      .filter(e => {
        if (e.kind !== EntityKind.EVENT) return false;
        const eventTime = e.end_time || e.start_time;
        if (!eventTime) return false;
        const timeMs = new Date(eventTime).getTime();
        if (isNaN(timeMs)) return false;
        // Event is in the past, within 48 hours, not yet confirmed
        const isPast = timeMs < currentTime && timeMs > fortyEightHoursAgo;
        const isUnconfirmed = !e.metadata?.confirmation_status;
        return isPast && isUnconfirmed;
      })
      .sort((a, b) => new Date(b.start_time || b.end_time!).getTime() - new Date(a.start_time || a.end_time!).getTime());
  }, [entities]);

  // 3. Schedule Conflicts: Events occurring today that overlap
  const scheduleConflicts = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayEvents = entities.filter(e => {
      if (e.kind !== EntityKind.EVENT || !e.start_time) return false;
      return e.start_time.startsWith(todayStr);
    });

    const conflicts: ScheduleCollision[] = [];
    for (let i = 0; i < todayEvents.length; i++) {
      for (let j = i + 1; j < todayEvents.length; j++) {
        const a = todayEvents[i];
        const b = todayEvents[j];
        const aStart = new Date(a.start_time!).getTime();
        const aEnd = new Date(a.end_time || a.start_time!).getTime() + (a.end_time ? 0 : 3600000);
        const bStart = new Date(b.start_time!).getTime();
        const bEnd = new Date(b.end_time || b.start_time!).getTime() + (b.end_time ? 0 : 3600000);

        // Overlap condition
        if (aStart < bEnd && bStart < aEnd) {
          conflicts.push({
            eventA: a,
            eventB: b,
            timeSlot: `${new Date(Math.max(aStart, bStart)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          });
        }
      }
    }
    return conflicts;
  }, [entities]);

  const totalIssuesCount = overdueTasks.length + unconfirmedPastEvents.length + scheduleConflicts.length;

  // Date helper targets for 1-click recovery
  const getTodayEod = () => {
    const d = new Date();
    d.setHours(18, 0, 0, 0);
    return d.toISOString();
  };

  const getTomorrowMorning = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d.toISOString();
  };

  // --- 1-Click Batch Recovery Actions ---
  const handleBatchRescheduleToToday = () => {
    if (overdueTasks.length === 0) return;
    const todayEod = getTodayEod();
    const ops: ToonOperation[] = overdueTasks.map(task => ({
      type: 'update_entity',
      payload: {
        id: task.id,
        fields: {
          deadline: todayEod
        }
      }
    }));
    applyOperations(ops);
    addToast(`✅ Rescheduled ${overdueTasks.length} overdue task(s) to today 18:00`, 'success');
  };

  const handleBatchDeferToTomorrow = () => {
    if (overdueTasks.length === 0) return;
    const tomorrowMorning = getTomorrowMorning();
    const ops: ToonOperation[] = overdueTasks.map(task => ({
      type: 'update_entity',
      payload: {
        id: task.id,
        fields: {
          deadline: tomorrowMorning
        }
      }
    }));
    applyOperations(ops);
    addToast(`📅 Deferred ${overdueTasks.length} task(s) to tomorrow 10:00`, 'info');
  };

  const handleBatchConfirmPastEvents = () => {
    if (unconfirmedPastEvents.length === 0) return;
    const ops: ToonOperation[] = unconfirmedPastEvents.map(event => ({
      type: 'update_entity',
      payload: {
        id: event.id,
        fields: {
          metadata: {
            ...event.metadata,
            confirmation_status: 'confirmed'
          }
        }
      }
    }));
    applyOperations(ops);
    addToast(`✅ Confirmed ${unconfirmedPastEvents.length} past event(s) as completed`, 'success');
  };

  const handleAutoReconcileAI = () => {
    const taskTitles = overdueTasks.slice(0, 4).map(t => `"${t.title}"`).join(', ');
    const eventTitles = unconfirmedPastEvents.slice(0, 3).map(e => `"${e.title}"`).join(', ');
    const prompt = `I had an interrupted day. Please rebalance my schedule. Overdue tasks: ${taskTitles || 'None'}. Missed events: ${eventTitles || 'None'}. Provide a calm, realistic plan for today.`;
    setPendingOrchestration(prompt);
    setView('chat');
    addToast('Asking AI to auto-reconcile interrupted day...', 'info');
  };

  // --- Inline Single Item Actions ---
  const handleTaskReschedule = (taskId: string, newDeadline: string, label: string) => {
    applyOperations([{
      type: 'update_entity',
      payload: {
        id: taskId,
        fields: { deadline: newDeadline }
      }
    }]);
    addToast(`Rescheduled to ${label}`, 'success');
  };

  const handleTaskMarkDone = (taskId: string) => {
    applyOperations([{
      type: 'update_entity',
      payload: {
        id: taskId,
        fields: { status: EntityStatus.COMPLETED }
      }
    }]);
    addToast('✅ Task marked as completed', 'success');
  };

  const handleTaskDismiss = (taskId: string) => {
    applyOperations([{
      type: 'update_entity',
      payload: {
        id: taskId,
        fields: { status: EntityStatus.ARCHIVED }
      }
    }]);
    addToast('Task archived', 'info');
  };

  const handleEventConfirmStatus = (eventId: string, status: 'confirmed' | 'skipped' | 'rescheduled') => {
    applyOperations([{
      type: 'update_entity',
      payload: {
        id: eventId,
        fields: {
          metadata: { confirmation_status: status }
        }
      }
    }]);
    addToast(`Marked event as ${status}`, 'info');
  };

  // Format relative deadline string
  const formatOverdueTime = (deadline: string) => {
    const diffMs = Date.now() - new Date(deadline).getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 24) {
      return `Overdue by ${diffHours <= 0 ? 'less than an hour' : `${diffHours}h`}`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return `Overdue by ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
  };

  // When zero issues detected: Calm, reassuring horizon state
  if (totalIssuesCount === 0) {
    return (
      <div
        className="mb-6 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex items-center justify-between transition-all"
        role="region"
        aria-label="Interrupted day recovery status"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
              Horizon in Flow
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                Clean State
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Zero overdue tasks or missed events. Your commitments are up to date.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Interrupted Day Active State
  return (
    <div
      className="mb-8 bg-slate-900 border border-amber-500/30 rounded-2xl p-5 md:p-6 shadow-xl relative overflow-hidden transition-all"
      role="region"
      aria-label="Interrupted day recovery"
      data-testid="interrupted-day-recovery"
    >
      {/* Decorative calm ambient glow */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10 mb-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0 mt-0.5">
            <CalendarClock size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                Interrupted Day Recovery
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-semibold">
                {totalIssuesCount} {totalIssuesCount === 1 ? 'Item Needs' : 'Items Need'} Triage
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-100 mt-0.5">
              Pick up where you left off without a planning marathon
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {overdueTasks.length > 0 && `${overdueTasks.length} task${overdueTasks.length > 1 ? 's' : ''} overdue. `}
              {unconfirmedPastEvents.length > 0 && `${unconfirmedPastEvents.length} past event${unconfirmedPastEvents.length > 1 ? 's' : ''} unconfirmed. `}
              {scheduleConflicts.length > 0 && `${scheduleConflicts.length} schedule collision${scheduleConflicts.length > 1 ? 's' : ''} today.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title={isCollapsed ? 'Expand recovery panel' : 'Collapse recovery panel'}
            aria-label={isCollapsed ? 'Expand recovery panel' : 'Collapse recovery panel'}
          >
            {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="relative z-10 space-y-4">
          {/* Quick Batch Actions Toolbar (Action Before Exposition) */}
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-wrap items-center gap-2 justify-between">
            <div className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <RotateCcw size={14} className="text-amber-400" />
              <span>1-Click Fast Triage:</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {overdueTasks.length > 0 && (
                <>
                  <button
                    onClick={handleBatchRescheduleToToday}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 transition-colors flex items-center gap-1.5 cursor-pointer"
                    aria-label="Reschedule all overdue tasks to today at 18:00"
                  >
                    <Clock size={13} />
                    <span>Reschedule Overdue to Today (18:00)</span>
                  </button>

                  <button
                    onClick={handleBatchDeferToTomorrow}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                    aria-label="Defer all overdue tasks to tomorrow at 10:00"
                  >
                    <Calendar size={13} />
                    <span>Defer to Tomorrow (10:00)</span>
                  </button>
                </>
              )}

              {unconfirmedPastEvents.length > 0 && (
                <button
                  onClick={handleBatchConfirmPastEvents}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 transition-colors flex items-center gap-1.5 cursor-pointer"
                  aria-label="Confirm all past events as done"
                >
                  <CheckCircle2 size={13} />
                  <span>Confirm Past Events as Done</span>
                </button>
              )}

              <button
                onClick={handleAutoReconcileAI}
                className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-900/40 transition-colors flex items-center gap-1.5 cursor-pointer"
                aria-label="Auto-reconcile interrupted day with AI"
              >
                <Sparkles size={13} />
                <span>Auto-Reconcile Day with AI</span>
              </button>
            </div>
          </div>

          {/* Granular Triage Filter Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2 text-xs">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              All Items ({totalIssuesCount})
            </button>
            {overdueTasks.length > 0 && (
              <button
                onClick={() => setActiveTab('tasks')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  activeTab === 'tasks'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                Overdue Tasks ({overdueTasks.length})
              </button>
            )}
            {unconfirmedPastEvents.length > 0 && (
              <button
                onClick={() => setActiveTab('events')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  activeTab === 'events'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                Missed Events ({unconfirmedPastEvents.length})
              </button>
            )}
            {scheduleConflicts.length > 0 && (
              <button
                onClick={() => setActiveTab('conflicts')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  activeTab === 'conflicts'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                Schedule Collisions ({scheduleConflicts.length})
              </button>
            )}
          </div>

          {/* Granular Triage Items Stream */}
          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            {/* Overdue Tasks Stream */}
            {(activeTab === 'all' || activeTab === 'tasks') &&
              overdueTasks.map(task => (
                <div
                  key={task.id}
                  className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-amber-500/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  data-testid={`overdue-task-card-${task.id}`}
                >
                  <div
                    className="min-w-0 cursor-pointer flex-1"
                    onClick={() => selectEntity(task.id)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-medium">
                        TASK
                      </span>
                      {task.priority && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
                          P{task.priority}
                        </span>
                      )}
                      <span className="text-xs text-rose-400 font-mono">
                        {formatOverdueTime(task.deadline!)}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-slate-100 truncate">
                      {task.title}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Original deadline: {new Date(task.deadline!).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>

                  {/* Inline 1-Click Action Buttons for Mobile & Desktop */}
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <button
                      onClick={() => handleTaskReschedule(task.id, getTodayEod(), 'Today 18:00')}
                      className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors"
                      title="Move deadline to today at 18:00"
                    >
                      Today 18:00
                    </button>
                    <button
                      onClick={() => handleTaskReschedule(task.id, getTomorrowMorning(), 'Tomorrow 10:00')}
                      className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                      title="Move deadline to tomorrow at 10:00"
                    >
                      Tomorrow
                    </button>
                    <button
                      onClick={() => handleTaskMarkDone(task.id)}
                      className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-colors flex items-center gap-1"
                      title="Mark task as complete"
                      aria-label={`Mark ${task.title} as completed`}
                    >
                      <Check size={13} />
                      <span>Done</span>
                    </button>
                    <button
                      onClick={() => handleTaskDismiss(task.id)}
                      className="min-h-[36px] p-2 rounded-lg text-xs text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                      title="Archive task"
                      aria-label={`Archive ${task.title}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}

            {/* Unconfirmed Past Events Stream */}
            {(activeTab === 'all' || activeTab === 'events') &&
              unconfirmedPastEvents.map(event => (
                <div
                  key={event.id}
                  className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-amber-500/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  data-testid={`past-event-card-${event.id}`}
                >
                  <div
                    className="min-w-0 cursor-pointer flex-1"
                    onClick={() => selectEntity(event.id)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-medium">
                        PAST EVENT
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        {new Date(event.start_time!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {event.end_time && ` — ${new Date(event.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-slate-100 truncate">
                      {event.title}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Ended: {new Date(event.end_time || event.start_time!).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <button
                      onClick={() => handleEventConfirmStatus(event.id, 'confirmed')}
                      className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-colors flex items-center gap-1"
                      title="Mark event as attended/completed"
                    >
                      <Check size={13} />
                      <span>Attended</span>
                    </button>
                    <button
                      onClick={() => handleEventConfirmStatus(event.id, 'skipped')}
                      className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                      title="Mark event as missed/skipped"
                    >
                      Skipped
                    </button>
                    <button
                      onClick={() => handleEventConfirmStatus(event.id, 'rescheduled')}
                      className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 transition-colors"
                      title="Mark event to reschedule"
                    >
                      Reschedule
                    </button>
                  </div>
                </div>
              ))}

            {/* Schedule Collisions Stream */}
            {(activeTab === 'all' || activeTab === 'conflicts') &&
              scheduleConflicts.map((collision, idx) => (
                <div
                  key={`collision-${idx}`}
                  className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  data-testid={`collision-card-${idx}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-bold">
                        COLLISION
                      </span>
                      <span className="text-xs text-rose-300 font-mono">
                        Around {collision.timeSlot}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-rose-100">
                      &quot;{collision.eventA.title}&quot; clashes with &quot;{collision.eventB.title}&quot;
                    </div>
                    <div className="text-[10px] text-rose-300/70 mt-0.5">
                      Both events occupy overlapping time slots today.
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => selectEntity(collision.eventB.id)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 transition-colors flex items-center gap-1"
                    >
                      <span>Adjust {collision.eventB.title.slice(0, 16)}...</span>
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default InterruptedDayRecovery;

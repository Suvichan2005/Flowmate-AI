import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { Play, Pause, X, CheckCircle2, Timer, AlertTriangle } from 'lucide-react';
import { checkFocusSessionConflicts } from '../utils/calendarConflicts';

const FocusTimer: React.FC = () => {
  const { focusSession, endFocusSession, entities, applyOperations, addMessage, selectEntity } = useStore();
  const [timeLeft, setTimeLeft] = useState(() => {
    if (!focusSession) return 0;
    const now = new Date();
    const startTime = new Date(focusSession.startTime);
    const elapsedSeconds = Math.floor((now.getTime() - startTime.getTime()) / 1000);
    const totalSeconds = focusSession.durationMinutes * 60;
    return Math.max(0, totalSeconds - elapsedSeconds);
  });
  const [isPaused, setIsPaused] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [completed, setCompleted] = useState(false);
  const hadPositiveTimeRef = useRef(false);

  const conflictWarning = useMemo(() => {
    if (!focusSession || timeLeft <= 0) return null;
    const remainingMinutes = Math.max(1, Math.ceil(timeLeft / 60));
    return checkFocusSessionConflicts(remainingMinutes, entities, Date.now());
  }, [focusSession, timeLeft, entities]);

  // Sync timer when focusSession changes
  useEffect(() => {
    if (focusSession) {
      const now = new Date();
      const startTime = new Date(focusSession.startTime);
      const elapsedSeconds = Math.floor((now.getTime() - startTime.getTime()) / 1000);
      const totalSeconds = focusSession.durationMinutes * 60;
      const initial = Math.max(0, totalSeconds - elapsedSeconds);
      setTimeLeft(initial);
      if (initial > 0) {
        hadPositiveTimeRef.current = true;
      }
      setIsPaused(false);
      setCompleted(false);
    } else {
      hadPositiveTimeRef.current = false;
    }
  }, [focusSession?.startTime, focusSession?.durationMinutes]);

  // Track positive time
  useEffect(() => {
    if (timeLeft > 0) {
      hadPositiveTimeRef.current = true;
    }
  }, [timeLeft]);

  // Tick
  useEffect(() => {
    if (!focusSession || isPaused || timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [focusSession, isPaused, timeLeft]);

  // Auto-complete only after timer has run down to 0 from a positive time
  useEffect(() => {
    if (focusSession && hadPositiveTimeRef.current && timeLeft === 0 && !completed) {
      setCompleted(true);
      handleComplete();
    }
  }, [timeLeft, focusSession, completed]);

  if (!focusSession) return null;

  const entity = entities.find(e => e.id === focusSession.entityId);
  if (!entity) return null;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleComplete = () => {
    const elapsedMinutes = Math.round((focusSession.durationMinutes * 60 - timeLeft) / 60);
    
    // Log Activity
    applyOperations([{
        type: 'log_activity',
        payload: {
            title: `Focused on ${entity.title}`,
            duration_minutes: elapsedMinutes,
            linked_entity_id: entity.id,
            notes: 'Completed via Focus Timer'
        }
    }]);

    // Optional: Ask user if they want to mark task complete? 
    // For now, just logging activity is safer.
    addMessage('assistant', `Great job focusing on "${entity.title}" for ${elapsedMinutes} minutes! I've logged this activity.`);

    endFocusSession();
  };

  const handleCancel = () => {
      if (confirmingCancel) {
          endFocusSession();
      } else {
          setConfirmingCancel(true);
          setTimeout(() => setConfirmingCancel(false), 3000);
      }
  };

  const progress = 1 - (timeLeft / (focusSession.durationMinutes * 60));

  return (
    <div className="fixed bottom-6 right-6 z-[60] animate-in slide-in-from-bottom-10 fade-in duration-300">
        <div className="bg-slate-900 border border-indigo-500/50 rounded-2xl shadow-2xl p-4 w-72 relative overflow-hidden">
            {/* Progress Background */}
            <div 
                className="absolute bottom-0 left-0 h-1 bg-indigo-500 transition-all duration-1000"
                style={{ width: `${progress * 100}%` }}
            />

            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2 text-indigo-400 font-bold">
                    <Timer className="animate-pulse" size={18} />
                    <span>Focus Mode</span>
                </div>
                <button onClick={handleCancel} className={`text-sm px-2 py-1 rounded-lg transition-all ${confirmingCancel ? 'bg-red-500/20 text-red-400 font-medium' : 'text-slate-500 hover:text-slate-300'}`}>
                    {confirmingCancel ? 'Confirm?' : <X size={16} />}
                </button>
            </div>

            <div className="mb-3">
                <h3 className="text-sm font-medium text-slate-200 truncate">{entity.title}</h3>
                <p className="text-xs text-slate-500">{entity.kind}</p>
            </div>

            {/* Live Calendar Collision Warning */}
            {conflictWarning?.hasConflict && conflictWarning.collidingEvent && (
                <div
                    onClick={() => conflictWarning.collidingEvent && selectEntity(conflictWarning.collidingEvent.collidingEventId)}
                    className="mb-3 p-2 rounded-xl bg-amber-950/60 border border-amber-500/40 hover:border-amber-400 transition-colors cursor-pointer group flex items-start gap-2 text-xs"
                    data-testid="focus-timer-calendar-collision"
                    title="Click to view colliding event"
                >
                    <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-amber-300 truncate group-hover:text-amber-200">
                            {conflictWarning.isEventOngoing ? 'Event in progress' : `Starts in ${conflictWarning.minutesUntilNextEvent ?? 0}m`}: {conflictWarning.collidingEvent.collidingEventTitle}
                        </div>
                        <div className="text-[10px] text-amber-400/70 truncate">
                            {conflictWarning.collidingEvent.formattedTimeSpan} · {conflictWarning.collidingEvent.sourceAttribution}
                        </div>
                    </div>
                </div>
            )}

            <div className="text-4xl font-mono font-bold text-center text-white mb-4 tracking-wider">
                {formatTime(timeLeft)}
            </div>

            <div className="flex justify-center gap-3">
                <button 
                    onClick={() => setIsPaused(!isPaused)}
                    className="p-2 rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                >
                    {isPaused ? <Play size={20} /> : <Pause size={20} />}
                </button>
                <button 
                    onClick={handleComplete}
                    className="px-4 py-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm flex items-center gap-2 shadow-lg shadow-indigo-500/20"
                >
                    <CheckCircle2 size={16} /> Finish
                </button>
            </div>
        </div>
    </div>
  );
};

export default FocusTimer;
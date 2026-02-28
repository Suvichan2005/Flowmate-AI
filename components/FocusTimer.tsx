import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Play, Pause, X, CheckCircle2, Timer } from 'lucide-react';

const FocusTimer: React.FC = () => {
  const { focusSession, endFocusSession, entities, applyOperations, addMessage } = useStore();
  const [timeLeft, setTimeLeft] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Initialize timer
  useEffect(() => {
    if (focusSession) {
      const now = new Date();
      const startTime = new Date(focusSession.startTime);
      const elapsedSeconds = Math.floor((now.getTime() - startTime.getTime()) / 1000);
      const totalSeconds = focusSession.durationMinutes * 60;
      setTimeLeft(Math.max(0, totalSeconds - elapsedSeconds));
    }
  }, [focusSession]);

  // Tick
  useEffect(() => {
    if (!focusSession || isPaused || timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [focusSession, isPaused, timeLeft]);

  // Auto-complete when timer reaches 0
  useEffect(() => {
    if (focusSession && timeLeft === 0 && !completed) {
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

            <div className="mb-4">
                <h3 className="text-sm font-medium text-slate-200 truncate">{entity.title}</h3>
                <p className="text-xs text-slate-500">{entity.kind}</p>
            </div>

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
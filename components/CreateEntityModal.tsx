import React, { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus, RecurrenceType } from '../types';
import { X, Plus, Type, FileText, Calendar, Repeat, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';
import {
    evaluateCandidateSlot,
    findEarliestFreeSlot,
    formatLocalTimeSpan,
    CandidateSlot
} from '../utils/calendarConflicts';

interface CreateEntityModalProps {
    onClose: () => void;
    initialDate?: string | null;
    initialKind?: EntityKind;
    initialTime?: string;
}

const CreateEntityModal: React.FC<CreateEntityModalProps> = ({ onClose, initialDate, initialKind, initialTime }) => {
    const { applyOperations, entities } = useStore();

    const [title, setTitle] = useState('');
    const [kind, setKind] = useState<EntityKind>(initialKind || EntityKind.TASK);
    const [description, setDescription] = useState('');
    const [date, setDate] = useState<string>(() => {
        if (initialDate) {
            const d = new Date(initialDate);
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            let iso = d.toISOString().slice(0, 16);
            if (initialTime) {
                iso = iso.split('T')[0] + 'T' + initialTime;
            }
            return iso;
        }
        return '';
    });
    const [isAllDay, setIsAllDay] = useState(false);
    const [recurrence, setRecurrence] = useState<RecurrenceType>(null);

    // Habit-specific fields
    const [habitType, setHabitType] = useState<'GOOD' | 'BAD'>('GOOD');
    const [frequencyGoal, setFrequencyGoal] = useState<'DAILY' | 'WEEKLY'>('DAILY');

    // Real-Time Calendar Conflict Grounding (Priority D)
    const candidateSlot: CandidateSlot | null = useMemo(() => {
        if (kind !== EntityKind.EVENT || !date) return null;
        try {
            if (isAllDay) {
                const start = new Date(date + 'T00:00:00');
                const end = new Date(date + 'T23:59:59.999');
                if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
                return {
                    startTimeIso: start.toISOString(),
                    endTimeIso: end.toISOString(),
                    isAllDay: true
                };
            } else {
                const start = new Date(date);
                if (isNaN(start.getTime())) return null;
                const end = new Date(start.getTime() + 60 * 60 * 1000);
                return {
                    startTimeIso: start.toISOString(),
                    endTimeIso: end.toISOString(),
                    isAllDay: false
                };
            }
        } catch {
            return null;
        }
    }, [kind, date, isAllDay]);

    const candidateEvaluation = useMemo(() => {
        if (!candidateSlot) return null;
        return evaluateCandidateSlot(candidateSlot, entities);
    }, [candidateSlot, entities]);

    const conflicts = candidateEvaluation?.conflicts || [];
    const hasConflict = candidateEvaluation?.status === 'conflict';
    const isSlotClear = candidateEvaluation?.status === 'clear';

    const suggestedFreeSlot = useMemo(() => {
        if (!hasConflict || !candidateSlot || isAllDay) return null;
        return findEarliestFreeSlot(candidateSlot, entities);
    }, [hasConflict, candidateSlot, entities, isAllDay]);

    const handleApplySuggestedSlot = () => {
        if (!suggestedFreeSlot) return;
        const slotStart = new Date(suggestedFreeSlot.startTimeIso);
        slotStart.setMinutes(slotStart.getMinutes() - slotStart.getTimezoneOffset());
        const newDateStr = isAllDay ? slotStart.toISOString().slice(0, 10) : slotStart.toISOString().slice(0, 16);
        setDate(newDateStr);
    };

    useEffect(() => {
        if (!date) return;
        if (isAllDay && date.includes('T')) {
            setDate(date.split('T')[0]);
        } else if (!isAllDay && !date.includes('T')) {
            setDate(date + 'T09:00');
        }
    }, [isAllDay]);

    useEffect(() => {
        if (initialKind) setKind(initialKind);
        if (initialDate) {
            const d = new Date(initialDate);
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            let iso = d.toISOString().slice(0, 16);
            if (initialTime) {
                iso = iso.split('T')[0] + 'T' + initialTime;
            }
            setDate(iso);
        }
    }, [initialDate, initialKind, initialTime]);

    // Accessible Escape key listener to dismiss modal
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;

        const payload: any = {
            title,
            kind,
            description,
            recurrence,
            status: EntityStatus.ACTIVE
        };

        if (date) {
            let isoDate;
            if (isAllDay) {
                isoDate = new Date(date + 'T00:00:00').toISOString();
                if (kind === EntityKind.EVENT) {
                    payload.metadata = { ...(payload.metadata || {}), is_all_day: true };
                }
            } else {
                isoDate = new Date(date).toISOString();
            }

            if (kind === EntityKind.EVENT) {
                payload.start_time = isoDate;
                if (isAllDay) {
                    payload.end_time = new Date(date + 'T23:59:59.999').toISOString();
                } else {
                    const sd = new Date(isoDate);
                    sd.setMinutes(sd.getMinutes() + 60);
                    payload.end_time = sd.toISOString();
                    payload.duration_minutes = 60;
                }
            } else {
                payload.deadline = isoDate;
            }
        }

        // Add habit metadata if HABIT kind
        if (kind === EntityKind.HABIT) {
            payload.metadata = {
                ...payload.metadata,
                habit_type: habitType,
                frequency_goal: frequencyGoal,
                total_completions: 0,
                current_streak: 0,
                best_streak: 0
            };
        }

        applyOperations([{
            type: 'create_entity',
            payload
        }]);

        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-entity-modal-title"
        >
            <div
                className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full flex flex-col animate-in fade-in zoom-in duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                    <h2 id="create-entity-modal-title" className="text-xl font-bold text-slate-100 flex items-center gap-2">
                        <Plus className="w-5 h-5 text-indigo-400" />
                        Create New Entity
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800"
                        aria-label="Close dialog"
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Title</label>
                        <div className="relative">
                            <Type className="absolute left-3 top-2.5 text-slate-600 w-4 h-4" />
                            <input
                                type="text"
                                value={title}
                                aria-label="Title"
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g., Complete Project X"
                                className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg py-2 pl-9 pr-4 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                autoFocus
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Type</label>
                        <div className="grid grid-cols-4 gap-2">
                            {[EntityKind.TASK, EntityKind.PROJECT, EntityKind.GOAL, EntityKind.EVENT, EntityKind.NOTE, EntityKind.CONTEXT, EntityKind.HABIT].map(k => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => setKind(k)}
                                    className={`text-[10px] py-2 px-1 rounded border transition-colors truncate ${kind === k
                                        ? 'bg-indigo-600 border-indigo-500 text-white'
                                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                        }`}
                                >
                                    {k}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Habit-specific settings */}
                    {kind === EntityKind.HABIT && (
                        <div className="grid grid-cols-2 gap-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Habit Type</label>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setHabitType('GOOD')}
                                        className={`flex-1 flex items-center justify-center gap-1 py-2 rounded border transition-colors text-xs ${habitType === 'GOOD'
                                                ? 'bg-emerald-600 border-emerald-500 text-white'
                                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                            }`}
                                    >
                                        <TrendingUp size={12} />
                                        Good
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setHabitType('BAD')}
                                        className={`flex-1 flex items-center justify-center gap-1 py-2 rounded border transition-colors text-xs ${habitType === 'BAD'
                                                ? 'bg-red-600 border-red-500 text-white'
                                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                            }`}
                                    >
                                        <TrendingDown size={12} />
                                        Bad
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Frequency</label>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setFrequencyGoal('DAILY')}
                                        className={`flex-1 py-2 rounded border transition-colors text-xs ${frequencyGoal === 'DAILY'
                                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                            }`}
                                    >
                                        Daily
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFrequencyGoal('WEEKLY')}
                                        className={`flex-1 py-2 rounded border transition-colors text-xs ${frequencyGoal === 'WEEKLY'
                                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                            }`}
                                    >
                                        Weekly
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <div className="flex items-center gap-2">
                                    <label className="block text-xs font-semibold text-slate-500 uppercase">Date</label>
                                    {kind === EntityKind.EVENT && date && isSlotClear && (
                                        <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1" data-testid="create-modal-slot-clear">
                                            <CheckCircle2 className="w-3 h-3" />
                                            Slot clear
                                        </span>
                                    )}
                                </div>
                                {kind === EntityKind.EVENT && (
                                    <label className="flex items-center gap-1 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={isAllDay}
                                            onChange={(e) => setIsAllDay(e.target.checked)}
                                            className="w-3 h-3 rounded border-slate-700 bg-slate-900 text-indigo-500 focus:ring-0"
                                        />
                                        <span className="text-[10px] text-slate-400">All Day</span>
                                    </label>
                                )}
                            </div>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-2.5 text-slate-600 w-4 h-4" />
                                <input
                                    type={isAllDay ? "date" : "datetime-local"}
                                    aria-label="Date"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg py-2 pl-9 pr-2 focus:ring-2 focus:ring-indigo-500/50 outline-none text-xs"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Recurrence</label>
                            <div className="relative">
                                <Repeat className="absolute left-3 top-2.5 text-slate-600 w-4 h-4" />
                                <select
                                    value={recurrence || ''}
                                    onChange={(e) => setRecurrence(e.target.value ? e.target.value as RecurrenceType : null)}
                                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg py-2 pl-9 pr-2 focus:ring-2 focus:ring-indigo-500/50 outline-none appearance-none text-xs"
                                >
                                    <option value="">None</option>
                                    <option value="DAILY">Daily</option>
                                    <option value="WEEKLY">Weekly</option>
                                    <option value="MONTHLY">Monthly</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Real-time calendar conflict banner & alternative slot recommendation */}
                    {kind === EntityKind.EVENT && hasConflict && (
                        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs space-y-2.5 animate-in fade-in duration-150" data-testid="create-modal-conflict-banner">
                            <div className="flex items-start gap-2 text-amber-300">
                                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-amber-200">
                                        Schedule Conflict Detected
                                    </div>
                                    <p className="text-amber-300/80 text-[11px] mt-0.5">
                                        Overlaps with {conflicts.length} scheduled event{conflicts.length > 1 ? 's' : ''}:
                                    </p>
                                    <div className="mt-1.5 space-y-1">
                                        {conflicts.slice(0, 3).map((c) => (
                                            <div key={c.collidingEventId} className="flex items-center justify-between text-[11px] bg-slate-900/80 px-2.5 py-1 rounded border border-amber-500/20">
                                                <span className="font-medium text-slate-200 truncate pr-2">{c.collidingEventTitle}</span>
                                                <span className="text-amber-300 shrink-0 font-mono text-[10px]">{c.formattedTimeSpan}</span>
                                            </div>
                                        ))}
                                        {conflicts.length > 3 && (
                                            <div className="text-[10px] text-amber-400/80 pl-1">
                                                +{conflicts.length - 3} more conflict{conflicts.length - 3 > 1 ? 's' : ''}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {suggestedFreeSlot && (
                                <div className="pt-2 border-t border-amber-500/20 flex items-center justify-between gap-2">
                                    <div className="text-[11px] text-amber-100 flex items-center gap-1.5 min-w-0">
                                        <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                        <span className="text-slate-400">Earliest free:</span>
                                        <span className="font-medium text-emerald-300 font-mono truncate">
                                            {formatLocalTimeSpan(new Date(suggestedFreeSlot.startTimeIso), new Date(suggestedFreeSlot.endTimeIso), isAllDay)}
                                        </span>
                                        <span className="text-slate-500 text-[10px] shrink-0">(+{suggestedFreeSlot.displacementMinutes}m)</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleApplySuggestedSlot}
                                        className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded text-[11px] font-medium transition-colors shrink-0"
                                        data-testid="apply-suggested-slot-btn"
                                    >
                                        Use Suggested Slot
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Description</label>
                        <div className="relative">
                            <FileText className="absolute left-3 top-3 text-slate-600 w-4 h-4" />
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Optional details..."
                                className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg py-2 pl-9 pr-4 min-h-[80px] focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={!title.trim()}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                    >
                        Create {kind}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default CreateEntityModal;

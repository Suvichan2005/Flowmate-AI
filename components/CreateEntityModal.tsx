import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus, RecurrenceType } from '../types';
import { X, Plus, Type, FileText, Calendar, Repeat } from 'lucide-react';

interface CreateEntityModalProps {
    onClose: () => void;
    initialDate?: string | null; // ISO Date string
    initialKind?: EntityKind;
    initialTime?: string; // HH:MM string
}

const CreateEntityModal: React.FC<CreateEntityModalProps> = ({ onClose, initialDate, initialKind, initialTime }) => {
    const { applyOperations } = useStore();

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

    // Toggle date format when switching modes
    useEffect(() => {
        if (!date) return;

        if (isAllDay && date.includes('T')) {
            // Strip time
            setDate(date.split('T')[0]);
        } else if (!isAllDay && !date.includes('T')) {
            // Add default time (current time or 9AM)
            setDate(date + 'T09:00');
        }
    }, [isAllDay]);

    // Reset if props change (though usually this component is mounted fresh)
    useEffect(() => {
        if (initialKind) setKind(initialKind);
        if (initialDate) {
            // Adjust ISO string to local time for input
            const d = new Date(initialDate);
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            let iso = d.toISOString().slice(0, 16);
            if (initialTime) {
                iso = iso.split('T')[0] + 'T' + initialTime;
            }
            setDate(iso);
        }
    }, [initialDate, initialKind, initialTime]);

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
                // For all-day, use local midnight
                isoDate = new Date(date + 'T00:00:00').toISOString();
                if (kind === EntityKind.EVENT) {
                    payload.metadata = { is_all_day: true };
                }
            } else {
                // datetime-local gives "YYYY-MM-DDTHH:mm"
                isoDate = new Date(date).toISOString();
            }

            if (kind === EntityKind.EVENT) {
                payload.start_time = isoDate;
                if (isAllDay) {
                    // Default 1 day duration for all-day events
                    // End time same day implies 1 day duration in Flowmate logic usually, 
                    // but for storage let's be explicit: end of day
                    const sd = new Date(isoDate);
                    sd.setHours(23, 59, 59, 999);
                    payload.end_time = sd.toISOString();
                }
            } else {
                payload.deadline = isoDate;
            }
        }

        applyOperations([{
            type: 'create_entity',
            payload
        }]);

        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full flex flex-col animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                        <Plus className="w-5 h-5 text-indigo-400" />
                        Create New Entity
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
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
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g., Complete Project X"
                                className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg py-2 pl-9 pr-4 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                autoFocus
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Type</label>
                        <div className="grid grid-cols-3 gap-2">
                            {Object.values(EntityKind).filter(k => [EntityKind.TASK, EntityKind.PROJECT, EntityKind.GOAL, EntityKind.EVENT, EntityKind.NOTE, EntityKind.CONTEXT].includes(k)).map(k => (
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

                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="block text-xs font-semibold text-slate-500 uppercase">Date (Optional)</label>
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
                                        value={date}
                                        onChange={(e) => setDate(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg py-2 pl-9 pr-2 focus:ring-2 focus:ring-indigo-500/50 outline-none"
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
                                        className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg py-2 pl-9 pr-2 focus:ring-2 focus:ring-indigo-500/50 outline-none appearance-none"
                                    >
                                        <option value="">None</option>
                                        <option value="DAILY">Daily</option>
                                        <option value="WEEKLY">Weekly</option>
                                        <option value="MONTHLY">Monthly</option>
                                        <option value="YEARLY">Yearly</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Description</label>
                            <div className="relative">
                                <FileText className="absolute left-3 top-3 text-slate-600 w-4 h-4" />
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Optional details..."
                                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg py-2 pl-9 pr-4 min-h-[100px] focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={!title.trim()}
                            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            Create Entity
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateEntityModal;

import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Flame, Plus, Check, Edit2, X, Calendar, Hash, Save } from 'lucide-react';
import { EntityKind } from '../types';

// Google Calendar color options (internal only - no export to avoid HMR issues)
const CALENDAR_COLORS = [
    { id: '1', name: 'Lavender', hex: '#7986cb' },
    { id: '2', name: 'Sage', hex: '#33b679' },
    { id: '3', name: 'Grape', hex: '#8e24aa' },
    { id: '4', name: 'Flamingo', hex: '#e67c73' },
    { id: '5', name: 'Banana', hex: '#f6bf26' },
    { id: '6', name: 'Tangerine', hex: '#f4511e' },
    { id: '7', name: 'Peacock', hex: '#039be5' },
    { id: '8', name: 'Graphite', hex: '#616161' },
    { id: '9', name: 'Blueberry', hex: '#3f51b5' },
    { id: '10', name: 'Basil', hex: '#0b8043' },
    { id: '11', name: 'Tomato', hex: '#d50000' },
];

const QuickStreaks: React.FC = () => {
    const { entities, applyOperations, addToast } = useStore();
    const [isEditMode, setIsEditMode] = useState(false);
    const [editingStreak, setEditingStreak] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [editDate, setEditDate] = useState('');

    const miniStreaks = useMemo(() => {
        return entities.filter(e => e.kind === EntityKind.MINI_STREAK && e.status !== 'ARCHIVED');
    }, [entities]);

    const handleIncrement = (streak: typeof miniStreaks[0]) => {
        if (isEditMode) {
            setEditingStreak(streak.id);
            setEditValue(String(streak.metadata?.current_streak || 0));
            setEditDate(streak.metadata?.last_date || new Date().toISOString().split('T')[0]);
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const lastDate = streak.metadata?.last_date;

        if (lastDate === today) {
            addToast('Already logged today!', 'info');
            return;
        }

        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const isConsecutive = lastDate === yesterday;
        const newStreak = isConsecutive ? (streak.metadata?.current_streak || 0) + 1 : 1;

        // FIXED: Use fields wrapper for update_entity
        applyOperations([{
            type: 'update_entity',
            payload: {
                id: streak.id,
                fields: {
                    metadata: {
                        ...streak.metadata,
                        current_streak: newStreak,
                        best_streak: Math.max(newStreak, streak.metadata?.best_streak || 0),
                        last_date: today,
                        total_days: (streak.metadata?.total_days || 0) + 1
                    }
                }
            }
        }]);

        addToast(`${streak.title}: ${newStreak} day streak! 🔥`, 'success');
    };

    const saveEdit = (streak: typeof miniStreaks[0]) => {
        const newStreak = parseInt(editValue) || 0;

        // FIXED: Use fields wrapper for update_entity
        applyOperations([{
            type: 'update_entity',
            payload: {
                id: streak.id,
                fields: {
                    metadata: {
                        ...streak.metadata,
                        current_streak: newStreak,
                        best_streak: Math.max(newStreak, streak.metadata?.best_streak || 0),
                        last_date: editDate
                    }
                }
            }
        }]);

        addToast(`${streak.title} updated to ${newStreak} days!`, 'success');
        setEditingStreak(null);
    };

    const handleDelete = (streak: typeof miniStreaks[0]) => {
        if (confirm(`Delete ${streak.title} streak?`)) {
            // FIXED: Use fields wrapper for update_entity
            applyOperations([{
                type: 'update_entity',
                payload: { id: streak.id, fields: { status: 'ARCHIVED' } }
            }]);
            addToast(`${streak.title} deleted`, 'info');
        }
    };

    const handleCreateNew = () => {
        const name = prompt('Streak name (e.g., Duolingo, Snapchat):');
        if (!name) return;

        const icon = prompt('Emoji icon:', '🔥');
        const startingStreak = prompt('Current streak count (or 0 if starting fresh):', '0');

        applyOperations([{
            type: 'create_entity',
            payload: {
                kind: EntityKind.MINI_STREAK,
                title: name,
                status: 'ACTIVE',
                metadata: {
                    icon: icon || '🔥',
                    current_streak: parseInt(startingStreak || '0'),
                    best_streak: parseInt(startingStreak || '0'),
                    last_date: new Date().toISOString().split('T')[0],
                    total_days: parseInt(startingStreak || '0'),
                    color: CALENDAR_COLORS[Math.floor(Math.random() * CALENDAR_COLORS.length)].hex
                }
            }
        }]);

        addToast(`${name} streak created!`, 'success');
    };

    if (miniStreaks.length === 0) {
        return (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Flame size={18} className="text-orange-400" />
                        <h3 className="text-sm font-medium text-slate-300">Quick Streaks</h3>
                    </div>
                </div>
                <button
                    onClick={handleCreateNew}
                    className="w-full py-3 border-2 border-dashed border-slate-600 rounded-lg text-slate-400 hover:border-orange-500/50 hover:text-orange-400 transition-colors flex items-center justify-center gap-2"
                >
                    <Plus size={16} />
                    Add streak (Duolingo, Snapchat, etc.)
                </button>
            </div>
        );
    }

    return (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Flame size={18} className="text-orange-400" />
                    <h3 className="text-sm font-medium text-slate-300">Quick Streaks</h3>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setIsEditMode(!isEditMode)}
                        className={`p-1.5 rounded-lg transition-colors ${isEditMode
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-indigo-400 hover:bg-slate-700'
                            }`}
                        title={isEditMode ? 'Done editing' : 'Edit streaks'}
                    >
                        {isEditMode ? <Check size={16} /> : <Edit2 size={16} />}
                    </button>
                    <button
                        onClick={handleCreateNew}
                        className="p-1.5 text-slate-400 hover:text-orange-400 hover:bg-slate-700 rounded-lg transition-colors"
                        title="Add new streak"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </div>

            {isEditMode && (
                <div className="mb-3 text-xs text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded">
                    Tap a streak to edit count/date. Tap ✓ when done.
                </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {miniStreaks.map(streak => {
                    const today = new Date().toISOString().split('T')[0];
                    const isDoneToday = streak.metadata?.last_date === today;
                    const currentStreak = streak.metadata?.current_streak || 0;
                    const isEditing = editingStreak === streak.id;

                    if (isEditing) {
                        return (
                            <div key={streak.id} className="p-3 rounded-xl bg-slate-800 border border-indigo-500/50">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-lg">{streak.metadata?.icon || '🔥'}</span>
                                    <button onClick={() => setEditingStreak(null)} className="text-slate-400 hover:text-white">
                                        <X size={14} />
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1">
                                        <Hash size={12} className="text-slate-500 shrink-0" />
                                        <input
                                            type="number"
                                            value={editValue}
                                            onChange={e => setEditValue(e.target.value)}
                                            className="w-full bg-slate-700 border-none rounded px-2 py-1 text-sm text-white"
                                            placeholder="Count"
                                        />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Calendar size={12} className="text-slate-500 shrink-0" />
                                        <input
                                            type="date"
                                            value={editDate}
                                            onChange={e => setEditDate(e.target.value)}
                                            className="w-full bg-slate-700 border-none rounded px-2 py-1 text-sm text-white"
                                        />
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => saveEdit(streak)}
                                            className="flex-1 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded flex items-center justify-center gap-1"
                                        >
                                            <Save size={12} /> Save
                                        </button>
                                        <button
                                            onClick={() => handleDelete(streak)}
                                            className="px-2 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    return (
                        <button
                            key={streak.id}
                            onClick={() => handleIncrement(streak)}
                            disabled={isDoneToday && !isEditMode}
                            className={`relative p-3 rounded-xl border transition-all ${isEditMode
                                ? 'bg-slate-800 border-indigo-500/30 hover:border-indigo-500'
                                : isDoneToday
                                    ? 'bg-green-500/20 border-green-500/30 cursor-default'
                                    : 'bg-slate-800 border-slate-700 hover:border-orange-500/50 hover:bg-slate-700/50'
                                }`}
                            style={{ borderColor: (!isEditMode && !isDoneToday) ? streak.metadata?.color : undefined }}
                        >
                            <div className="text-2xl mb-1">{streak.metadata?.icon || '🔥'}</div>
                            <div className="text-xs text-slate-300 truncate">{streak.title}</div>
                            <div className="text-lg font-bold text-white flex items-center justify-center gap-1">
                                {currentStreak}
                                <Flame size={14} className="text-orange-400" />
                            </div>
                            {isDoneToday && !isEditMode && (
                                <div className="absolute top-1 right-1">
                                    <Check size={14} className="text-green-400" />
                                </div>
                            )}
                            {isEditMode && (
                                <div className="absolute top-1 right-1">
                                    <Edit2 size={12} className="text-indigo-400" />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default QuickStreaks;

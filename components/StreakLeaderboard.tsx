import React, { useMemo } from 'react';
import { Entity, EntityKind, HabitMetadata } from '../types';
import { Flame, Medal } from 'lucide-react';

interface StreakLeaderboardProps {
    entities: Entity[];
}

const StreakLeaderboard: React.FC<StreakLeaderboardProps> = ({ entities }) => {
    const rankedHabits = useMemo(() => {
        return entities
            .filter(e => e.kind === EntityKind.HABIT && e.status !== 'ARCHIVED')
            .map(e => {
                const meta = e.metadata as HabitMetadata;
                return {
                    title: e.title,
                    streak: meta.streak_current || 0,
                    best: meta.streak_best || 0,
                    type: meta.habit_type || 'GOOD'
                };
            })
            .sort((a, b) => b.streak - a.streak)
            .slice(0, 5);
    }, [entities]);

    if (rankedHabits.length === 0) {
        return null;
    }

    const medalColors = ['text-yellow-400', 'text-gray-400', 'text-orange-400'];

    return (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-4">
                <Flame size={18} className="text-orange-400" />
                <h3 className="text-sm font-medium text-gray-300">Streak Leaderboard</h3>
            </div>

            <div className="space-y-2">
                {rankedHabits.map((habit, i) => (
                    <div
                        key={i}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 ${i === 0 ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-gray-900/50'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            {i < 3 ? (
                                <Medal size={16} className={medalColors[i]} />
                            ) : (
                                <span className="text-gray-500 text-sm w-4 text-center">{i + 1}</span>
                            )}
                            <span className={`font-medium ${habit.type === 'GOOD' ? 'text-gray-200' : 'text-red-300'}`}>
                                {habit.title}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 text-orange-400">
                                <Flame size={14} fill="currentColor" />
                                <span className="font-bold">{habit.streak}</span>
                            </div>
                            <span className="text-xs text-gray-500">
                                (best: {habit.best})
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default StreakLeaderboard;

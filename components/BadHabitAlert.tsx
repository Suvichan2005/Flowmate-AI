import React, { useMemo } from 'react';
import { Entity, EntityKind, HabitMetadata } from '../types';
import { AlertTriangle, Clock } from 'lucide-react';

interface BadHabitAlertProps {
    entities: Entity[];
}

const BadHabitAlert: React.FC<BadHabitAlertProps> = ({ entities }) => {
    const badHabitsOverLimit = useMemo(() => {
        return entities
            .filter(e => e.kind === EntityKind.HABIT)
            .map(e => {
                const meta = e.metadata as HabitMetadata;
                if (meta.habit_type !== 'BAD') return null;

                const spent = meta.time_spent_minutes || 0;
                const limit = meta.limit_minutes || 0;

                if (limit > 0 && spent > limit) {
                    return {
                        title: e.title,
                        spent,
                        limit,
                        overage: spent - limit
                    };
                }
                return null;
            })
            .filter(Boolean) as { title: string; spent: number; limit: number; overage: number }[];
    }, [entities]);

    if (badHabitsOverLimit.length === 0) return null;

    return (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 text-red-400 mb-3">
                <AlertTriangle size={18} />
                <h3 className="font-medium">Limit Exceeded</h3>
            </div>

            <div className="space-y-2">
                {badHabitsOverLimit.map((habit, i) => (
                    <div key={i} className="flex items-center justify-between bg-red-500/5 rounded-lg px-3 py-2">
                        <span className="text-gray-200 font-medium">{habit.title}</span>
                        <div className="flex items-center gap-2 text-sm">
                            <Clock size={14} className="text-red-400" />
                            <span className="text-red-400 font-mono">
                                {Math.round(habit.spent)}m / {habit.limit}m
                            </span>
                            <span className="text-red-300 text-xs">
                                (+{habit.overage}m over)
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default BadHabitAlert;

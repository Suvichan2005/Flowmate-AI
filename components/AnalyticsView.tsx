import React, { useMemo } from 'react';
import { useStore } from '../store';
import { EntityKind } from '../types';
import HabitCard from './HabitCard';
import { Brain, TrendingUp } from 'lucide-react';

const AnalyticsView: React.FC = () => {
    const { entities, relationships } = useStore();

    const habits = useMemo(() => {
        return entities.filter(e => e.kind === EntityKind.HABIT && e.status !== 'ARCHIVED');
    }, [entities]);

    // Overall Stats Calculation could go here
    const activeHabitsCount = habits.length;
    // Calculate total completions across all habits for a fun stat
    const totalCompletions = habits.reduce((acc, h) => acc + (h.metadata.total_completions || 0), 0);

    return (
        <div className="h-full flex flex-col bg-gray-900 text-gray-100 overflow-y-auto p-8">

            {/* Header Section */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent flex items-center gap-3">
                        <Brain className="text-teal-400" size={32} />
                        Progress Intelligence
                    </h1>
                    <p className="text-gray-400 mt-2">
                        Tracking <span className="text-white font-medium">{activeHabitsCount}</span> active habits with <span className="text-white font-medium">{totalCompletions}</span> total wins.
                    </p>
                </div>

                {/* Potentially a "Last 14 Days" selector here later */}
            </div>

            {/* Habits Grid */}
            {habits.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {habits.map(habit => (
                        <HabitCard
                            key={habit.id}
                            habit={habit}
                            relationships={relationships}
                            allEntities={entities} // Pass all entities to lookup activity details
                        />
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500 border-2 border-dashed border-gray-800 rounded-2xl">
                    <TrendingUp size={48} className="mb-4 opacity-50" />
                    <p className="text-lg">No habits tracked yet.</p>
                    <p className="text-sm mt-2">Ask the AI: "Track my daily gym habit"</p>
                </div>
            )}

            {/* Future: Activity Heatmap or other advanced charts below */}

        </div>
    );
};

export default AnalyticsView;

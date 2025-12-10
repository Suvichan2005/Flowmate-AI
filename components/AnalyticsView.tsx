import React, { useMemo } from 'react';
import { useStore } from '../store';
import { EntityKind } from '../types';
import HabitCard from './HabitCard';
import ContributionHeatmap from './ContributionHeatmap';
import WeeklySummary from './WeeklySummary';
import BadHabitAlert from './BadHabitAlert';
import StreakLeaderboard from './StreakLeaderboard';
import GoalProgressChart from './GoalProgressChart';
import ProductivityChart from './ProductivityChart';
import { Brain, TrendingUp } from 'lucide-react';

const AnalyticsView: React.FC = () => {
    const { entities, relationships } = useStore();

    const habits = useMemo(() => {
        return entities.filter(e => e.kind === EntityKind.HABIT && e.status !== 'ARCHIVED');
    }, [entities]);

    const activeHabitsCount = habits.length;
    const totalCompletions = habits.reduce((acc, h) => acc + (h.metadata.total_completions || 0), 0);

    return (
        <div className="h-full flex flex-col bg-gray-900 text-gray-100 overflow-y-auto p-6 md:p-8">

            {/* Header Section */}
            <div className="flex items-center justify-between mb-6 pl-4 md:pl-14">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent flex items-center gap-3">
                        <Brain className="text-teal-400" size={28} />
                        Progress Intelligence
                    </h1>
                    <p className="text-gray-400 mt-1 text-sm">
                        Tracking <span className="text-white font-medium">{activeHabitsCount}</span> habits • <span className="text-white font-medium">{totalCompletions}</span> total wins
                    </p>
                </div>
            </div>

            {/* Bad Habit Alerts (if any) */}
            <BadHabitAlert entities={entities} />

            {/* Productivity Breakdown & Weekly Summary Grid */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <WeeklySummary entities={entities} relationships={relationships} />
                <ProductivityChart entities={entities} />
            </div>

            {/* Goal Progress */}

            {/* Goal Progress */}
            <div className="mt-4">
                <GoalProgressChart entities={entities} />
            </div>

            {/* Contribution Heatmap */}
            <div className="mt-4">
                <ContributionHeatmap entities={entities} />
            </div>

            {/* Two-Column Layout: Habits + Leaderboard */}
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Habits Grid (2/3 width) */}
                <div className="lg:col-span-2">
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Your Habits</h3>
                    {habits.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {habits.map(habit => (
                                <HabitCard
                                    key={habit.id}
                                    habit={habit}
                                    relationships={relationships}
                                    allEntities={entities}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-48 text-gray-500 border-2 border-dashed border-gray-800 rounded-xl">
                            <TrendingUp size={36} className="mb-3 opacity-50" />
                            <p className="text-sm">No habits tracked yet.</p>
                            <p className="text-xs mt-1 text-gray-600">Ask the AI: "Track my daily gym habit"</p>
                        </div>
                    )}
                </div>

                {/* Streak Leaderboard (1/3 width) */}
                <div className="lg:col-span-1">
                    <StreakLeaderboard entities={entities} />
                </div>
            </div>
        </div>
    );
};

export default AnalyticsView;

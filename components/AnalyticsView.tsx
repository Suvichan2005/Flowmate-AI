import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { getActiveEntities } from '../store/helpers';
import { EntityKind } from '../types';
import HabitCard from './HabitCard';
import ContributionHeatmap from './ContributionHeatmap';
import WeeklySummary from './WeeklySummary';
import BadHabitAlert from './BadHabitAlert';
import StreakLeaderboard from './StreakLeaderboard';
import GoalProgressChart from './GoalProgressChart';
import ProductivityChart from './ProductivityChart';
import WeeklyInsights from './WeeklyInsights';
import { Brain, TrendingUp } from 'lucide-react';
import { SkeletonDashboard } from './Skeleton';
import EmptyState from './EmptyState';

const AnalyticsView: React.FC = () => {
    const { entities: rawEntities, relationships, isHydrated, selectEntity } = useStore();
    const entities = useMemo(() => getActiveEntities(rawEntities), [rawEntities]);
    const layoutRef = useRef<HTMLDivElement>(null);
    const [layoutWidth, setLayoutWidth] = useState(0);

    useEffect(() => {
        const element = layoutRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setLayoutWidth(element.clientWidth));
        setLayoutWidth(element.clientWidth);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // The analytics route can render beside the chat panel. Viewport breakpoints
    // misread that available width, so choose columns from the route's own size.
    const compactLayout = layoutWidth < 1120;

    // Show skeleton while loading
    if (!isHydrated) {
        return <SkeletonDashboard />;
    }

    const habits = useMemo(() => {
        return entities.filter(e => e.kind === EntityKind.HABIT && e.status !== 'ARCHIVED');
    }, [entities]);

    const activeHabitsCount = habits.length;
    const totalCompletions = habits.reduce((acc, h) => acc + (h.metadata.total_completions || 0), 0);

    return (
        <div ref={layoutRef} data-testid="analytics-layout" className="h-full min-w-0 flex flex-col bg-gray-900 text-gray-100 overflow-y-auto p-6 md:p-8">

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
            <div data-testid="analytics-summary-grid" className={`mt-6 grid gap-6 ${compactLayout ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <WeeklySummary entities={entities} relationships={relationships} />
                <ProductivityChart entities={entities} />
            </div>

            {/* Weekly Insights - NEW */}
            <div className="mt-4">
                <WeeklyInsights entities={entities} />
            </div>

            {/* Goal Progress */}

            {/* Goal Progress */}
            <div className="mt-4">
                <GoalProgressChart entities={entities} onSelectGoal={selectEntity} />
            </div>

            {/* Contribution Heatmap */}
            <div className="mt-4">
                <ContributionHeatmap entities={entities} />
            </div>

            {/* Two-Column Layout: Habits + Leaderboard */}
            <div className={`mt-6 grid gap-6 ${compactLayout ? 'grid-cols-1' : 'grid-cols-3'}`}>
                {/* Habits Grid (2/3 width) */}
                <div className={compactLayout ? '' : 'col-span-2'}>
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Your Habits</h3>
                    {habits.length > 0 ? (
                        <div className={`grid gap-4 ${compactLayout ? 'grid-cols-1' : 'grid-cols-2'}`}>
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

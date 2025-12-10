import React, { useMemo } from 'react';
import { Entity, EntityKind, EntityStatus } from '../types';
import { getStreakInfo, getActivitySummary, getActivityEntities } from '../utils/streakCalculation';
import { Flame, Trophy, Calendar, Clock } from 'lucide-react';

interface ContributionHeatmapProps {
    entities: Entity[];
    showStats?: boolean; // Show streak statistics
}

const ContributionHeatmap: React.FC<ContributionHeatmapProps> = ({ entities, showStats = true }) => {
    // Calculate streak info using utilities
    const streakInfo = useMemo(() => getStreakInfo(entities), [entities]);
    const summary = useMemo(() => getActivitySummary(entities), [entities]);

    // Generate last 365 days of data
    const { grid, maxCount, monthLabels, totalActivities } = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Count activities per day - use getActivityEntities which includes metadata.activity_log
        const counts: Record<string, number> = {};
        let total = 0;

        // Get all activities (legacy ACTIVITY entities + metadata.activity_log entries)
        const allActivities = getActivityEntities(entities);

        // Also count completed tasks and habits
        const completedItems = entities.filter(e =>
            e.status === EntityStatus.COMPLETED &&
            (e.kind === EntityKind.TASK || e.kind === EntityKind.HABIT)
        );

        // Count activities
        allActivities.forEach(e => {
            const dateStr = (e.start_time || e.updated_at || e.created_at).split('T')[0];
            counts[dateStr] = (counts[dateStr] || 0) + 1;
            total++;
        });

        // Count completed tasks/habits
        completedItems.forEach(e => {
            const dateStr = (e.start_time || e.updated_at || e.created_at).split('T')[0];
            counts[dateStr] = (counts[dateStr] || 0) + 1;
            total++;
        });

        // Build grid (52 weeks x 7 days)
        const weeks: { date: Date; count: number; dateStr: string }[][] = [];
        const monthLabelPositions: { label: string; weekIndex: number }[] = [];

        // Start from 364 days ago
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 364);

        // Align to Sunday
        const dayOfWeek = startDate.getDay();
        startDate.setDate(startDate.getDate() - dayOfWeek);

        let currentMonth = -1;
        let maxVal = 0;

        for (let week = 0; week < 53; week++) {
            const weekData: { date: Date; count: number; dateStr: string }[] = [];

            for (let day = 0; day < 7; day++) {
                const date = new Date(startDate);
                date.setDate(date.getDate() + week * 7 + day);
                const dateStr = date.toISOString().split('T')[0];
                const count = counts[dateStr] || 0;

                if (count > maxVal) maxVal = count;

                // Track month labels
                if (date.getMonth() !== currentMonth && day === 0) {
                    currentMonth = date.getMonth();
                    monthLabelPositions.push({
                        label: date.toLocaleDateString('en-US', { month: 'short' }),
                        weekIndex: week
                    });
                }

                weekData.push({ date, count, dateStr });
            }

            weeks.push(weekData);
        }

        return { grid: weeks, maxCount: maxVal, monthLabels: monthLabelPositions, totalActivities: total };
    }, [entities]);

    // Color scale (5 levels)
    const getColor = (count: number): string => {
        if (count === 0) return 'bg-gray-800';
        if (maxCount === 0) return 'bg-gray-800';

        const ratio = count / maxCount;
        if (ratio <= 0.25) return 'bg-green-900';
        if (ratio <= 0.5) return 'bg-green-700';
        if (ratio <= 0.75) return 'bg-green-500';
        return 'bg-green-400';
    };

    const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

    // Format minutes to hours and minutes
    const formatDuration = (minutes: number) => {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    };

    return (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-4">
            {/* Header with title and stats */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h3 className="text-sm font-medium text-gray-300">Activity Over The Last Year</h3>

                {showStats && (
                    <div className="flex items-center gap-4 text-xs">
                        {/* Current Streak */}
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                            <Flame className={`w-3.5 h-3.5 ${streakInfo.current > 0 ? 'text-orange-400' : 'text-gray-500'}`} />
                            <span className={streakInfo.current > 0 ? 'text-orange-300' : 'text-gray-400'}>
                                {streakInfo.current} day{streakInfo.current !== 1 ? 's' : ''}
                            </span>
                        </div>

                        {/* Best Streak */}
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                            <Trophy className="w-3.5 h-3.5 text-purple-400" />
                            <span className="text-purple-300">Best: {streakInfo.longest}</span>
                        </div>

                        {/* This Week */}
                        <div className="hidden md:flex items-center gap-1.5 px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                            <Calendar className="w-3.5 h-3.5 text-blue-400" />
                            <span className="text-blue-300">{summary.thisWeekCount} this week</span>
                        </div>

                        {/* Total Time */}
                        <div className="hidden lg:flex items-center gap-1.5 px-2 py-1 bg-green-500/10 border border-green-500/20 rounded-lg">
                            <Clock className="w-3.5 h-3.5 text-green-400" />
                            <span className="text-green-300">{formatDuration(summary.totalMinutes)}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Month Labels and Grid Container */}
            <div className="overflow-x-auto pb-2">
                <div className="min-w-[600px]">
                    {/* Month Labels */}
                    <div className="flex mb-1 ml-8">
                        {monthLabels.map((m, i) => (
                            <div
                                key={i}
                                className="text-[10px] text-gray-500"
                                style={{ marginLeft: i === 0 ? 0 : `${(m.weekIndex - (monthLabels[i - 1]?.weekIndex || 0)) * 12 - 20}px` }}
                            >
                                {m.label}
                            </div>
                        ))}
                    </div>

                    <div className="flex">
                        {/* Day Labels */}
                        <div className="flex flex-col mr-2 mt-0.5">
                            {dayLabels.map((label, i) => (
                                <div key={i} className="text-[10px] text-gray-500 h-[11px] leading-[11px]">
                                    {label}
                                </div>
                            ))}
                        </div>

                        {/* Grid */}
                        <div className="flex gap-[3px]">
                            {grid.map((week, weekIndex) => (
                                <div key={weekIndex} className="flex flex-col gap-[3px]">
                                    {week.map((day, dayIndex) => (
                                        <div
                                            key={dayIndex}
                                            className={`w-[10px] h-[10px] rounded-sm ${getColor(day.count)} hover:ring-1 hover:ring-white/50 transition-all cursor-pointer`}
                                            title={`${day.dateStr}: ${day.count} ${day.count === 1 ? 'activity' : 'activities'}`}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Legend and total */}
            <div className="flex items-center justify-between mt-3">
                <span className="text-[10px] text-gray-500">{totalActivities} activities in the last year</span>
                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                    <span>Less</span>
                    <div className="w-[10px] h-[10px] rounded-sm bg-gray-800" />
                    <div className="w-[10px] h-[10px] rounded-sm bg-green-900" />
                    <div className="w-[10px] h-[10px] rounded-sm bg-green-700" />
                    <div className="w-[10px] h-[10px] rounded-sm bg-green-500" />
                    <div className="w-[10px] h-[10px] rounded-sm bg-green-400" />
                    <span>More</span>
                </div>
            </div>
        </div>
    );
};

export default ContributionHeatmap;


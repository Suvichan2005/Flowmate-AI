import React, { useMemo } from 'react';
import { Entity, EntityKind } from '../types';

interface ContributionHeatmapProps {
    entities: Entity[];
}

const ContributionHeatmap: React.FC<ContributionHeatmapProps> = ({ entities }) => {
    // Generate last 365 days of data
    const { grid, maxCount, monthLabels } = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Count activities per day
        const counts: Record<string, number> = {};

        entities.forEach(e => {
            // Count completed tasks, activities, and logged work
            if (e.kind === EntityKind.ACTIVITY ||
                (e.status === 'COMPLETED' && (e.kind === EntityKind.TASK || e.kind === EntityKind.HABIT))) {
                const dateStr = (e.start_time || e.updated_at || e.created_at).split('T')[0];
                counts[dateStr] = (counts[dateStr] || 0) + 1;
            }
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

        return { grid: weeks, maxCount: maxVal, monthLabels: monthLabelPositions };
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

    return (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-4">Activity Over The Last Year</h3>

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
                                            title={`${day.dateStr}: ${day.count} activities`}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-end gap-1 mt-3 text-[10px] text-gray-500">
                <span>Less</span>
                <div className="w-[10px] h-[10px] rounded-sm bg-gray-800" />
                <div className="w-[10px] h-[10px] rounded-sm bg-green-900" />
                <div className="w-[10px] h-[10px] rounded-sm bg-green-700" />
                <div className="w-[10px] h-[10px] rounded-sm bg-green-500" />
                <div className="w-[10px] h-[10px] rounded-sm bg-green-400" />
                <span>More</span>
            </div>
        </div>
    );
};

export default ContributionHeatmap;

import React, { useMemo } from 'react';
import { Entity, EntityKind } from '../types';
import { Clock } from 'lucide-react';

interface MomentumHeatmapProps {
    entities: Entity[];
}

/**
 * MomentumHeatmap - Shows TIME SPENT per day (not occurrences)
 * Uses duration_minutes from ACTIVITY entities
 */
const MomentumHeatmap: React.FC<MomentumHeatmapProps> = ({ entities }) => {
    const { grid, maxMinutes, monthLabels } = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Sum time spent per day (in minutes)
        const timeByDay: Record<string, number> = {};

        entities.forEach(e => {
            // Only count activities with duration
            if (e.kind === EntityKind.ACTIVITY && e.duration_minutes) {
                const dateStr = (e.start_time || e.updated_at || e.created_at).split('T')[0];
                timeByDay[dateStr] = (timeByDay[dateStr] || 0) + e.duration_minutes;
            }
        });

        // Build grid (52 weeks x 7 days)
        const weeks: { date: Date; minutes: number; dateStr: string }[][] = [];
        const monthLabelPositions: { label: string; weekIndex: number }[] = [];

        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 364);
        const dayOfWeek = startDate.getDay();
        startDate.setDate(startDate.getDate() - dayOfWeek);

        let currentMonth = -1;
        let maxVal = 0;

        for (let week = 0; week < 53; week++) {
            const weekData: { date: Date; minutes: number; dateStr: string }[] = [];

            for (let day = 0; day < 7; day++) {
                const date = new Date(startDate);
                date.setDate(date.getDate() + week * 7 + day);
                const dateStr = date.toISOString().split('T')[0];
                const minutes = timeByDay[dateStr] || 0;

                if (minutes > maxVal) maxVal = minutes;

                if (date.getMonth() !== currentMonth && day === 0) {
                    currentMonth = date.getMonth();
                    monthLabelPositions.push({
                        label: date.toLocaleDateString('en-US', { month: 'short' }),
                        weekIndex: week
                    });
                }

                weekData.push({ date, minutes, dateStr });
            }

            weeks.push(weekData);
        }

        return { grid: weeks, maxMinutes: maxVal, monthLabels: monthLabelPositions };
    }, [entities]);

    // Color scale based on time (blue gradient for time)
    const getColor = (minutes: number): string => {
        if (minutes === 0) return 'bg-slate-800';
        if (maxMinutes === 0) return 'bg-slate-800';

        const ratio = minutes / maxMinutes;
        if (ratio <= 0.25) return 'bg-blue-900';
        if (ratio <= 0.5) return 'bg-blue-700';
        if (ratio <= 0.75) return 'bg-blue-500';
        return 'bg-blue-400';
    };

    const formatTime = (minutes: number): string => {
        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
        }
        return `${minutes}m`;
    };

    const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

    return (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-4">
                <Clock size={18} className="text-blue-400" />
                <h3 className="text-sm font-medium text-slate-300">Momentum (Time Spent)</h3>
            </div>

            {/* Month Labels */}
            <div className="flex mb-1 ml-8">
                {monthLabels.map((m, i) => (
                    <div
                        key={i}
                        className="text-[10px] text-slate-500"
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
                        <div key={i} className="text-[10px] text-slate-500 h-[11px] leading-[11px]">
                            {label}
                        </div>
                    ))}
                </div>

                {/* Grid */}
                <div className="flex gap-[3px] overflow-x-auto">
                    {grid.map((week, weekIndex) => (
                        <div key={weekIndex} className="flex flex-col gap-[3px]">
                            {week.map((day, dayIndex) => (
                                <div
                                    key={dayIndex}
                                    className={`w-[10px] h-[10px] rounded-sm ${getColor(day.minutes)} hover:ring-1 hover:ring-white/50 transition-all cursor-pointer`}
                                    title={`${day.dateStr}: ${formatTime(day.minutes)}`}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-end gap-1 mt-3 text-[10px] text-slate-500">
                <span>Less time</span>
                <div className="w-[10px] h-[10px] rounded-sm bg-slate-800" />
                <div className="w-[10px] h-[10px] rounded-sm bg-blue-900" />
                <div className="w-[10px] h-[10px] rounded-sm bg-blue-700" />
                <div className="w-[10px] h-[10px] rounded-sm bg-blue-500" />
                <div className="w-[10px] h-[10px] rounded-sm bg-blue-400" />
                <span>More time</span>
            </div>
        </div>
    );
};

export default MomentumHeatmap;

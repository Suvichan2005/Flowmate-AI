import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus } from '../types';
import { ChevronLeft, ChevronRight, Activity } from 'lucide-react';

const ActivityHeatmap: React.FC = () => {
    const { entities } = useStore();
    const [yearOffset, setYearOffset] = useState(0);

    const { weeks, months, maxCount, year } = useMemo(() => {
        const now = new Date();
        const targetYear = now.getFullYear() + yearOffset;

        // Count activities per day
        const counts: Record<string, number> = {};

        (entities || []).forEach(e => {
            if (e.kind === EntityKind.ACTIVITY && e.created_at) {
                const date = e.created_at.split('T')[0];
                if (date.startsWith(String(targetYear))) {
                    counts[date] = (counts[date] || 0) + 1;
                }
            }
            if (e.kind === EntityKind.TASK && e.status === EntityStatus.COMPLETED && e.updated_at) {
                const date = e.updated_at.split('T')[0];
                if (date.startsWith(String(targetYear))) {
                    counts[date] = (counts[date] || 0) + 1;
                }
            }
        });

        // Start from Jan 1 of target year, align to Sunday
        const jan1 = new Date(targetYear, 0, 1);
        const startDate = new Date(jan1);
        startDate.setDate(jan1.getDate() - jan1.getDay()); // Go back to Sunday

        const weeksData: { date: string; count: number; day: number }[][] = [];
        const monthsData: { name: string; week: number }[] = [];

        let lastMonth = -1;
        let maxVal = 0;
        const current = new Date(startDate);

        // Generate 53 weeks
        for (let w = 0; w < 53; w++) {
            const week: { date: string; count: number; day: number }[] = [];

            for (let d = 0; d < 7; d++) {
                const dateStr = current.toISOString().split('T')[0];
                const count = counts[dateStr] || 0;
                const isInYear = current.getFullYear() === targetYear;

                if (count > maxVal) maxVal = count;

                // Track month changes
                if (d === 0 && current.getMonth() !== lastMonth && isInYear) {
                    lastMonth = current.getMonth();
                    monthsData.push({
                        name: current.toLocaleDateString('en-US', { month: 'short' }),
                        week: w
                    });
                }

                week.push({
                    date: dateStr,
                    count: isInYear ? count : -1, // -1 = outside year
                    day: d
                });

                current.setDate(current.getDate() + 1);
            }

            weeksData.push(week);
        }

        return { weeks: weeksData, months: monthsData, maxCount: maxVal, year: targetYear };
    }, [entities, yearOffset]);

    const getColor = (count: number): string => {
        if (count < 0) return 'bg-transparent'; // Outside year
        if (count === 0) return 'bg-slate-800';
        if (maxCount === 0) return 'bg-slate-800';
        const ratio = count / maxCount;
        if (ratio <= 0.25) return 'bg-emerald-900';
        if (ratio <= 0.5) return 'bg-emerald-700';
        if (ratio <= 0.75) return 'bg-emerald-500';
        return 'bg-emerald-400';
    };

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Activity size={16} className="text-emerald-400" />
                    <h3 className="text-sm font-medium text-slate-300">Activity</h3>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setYearOffset(y => y - 1)}
                        className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <span className="text-xs font-medium text-slate-400 w-10 text-center">{year}</span>
                    <button
                        onClick={() => setYearOffset(y => Math.min(0, y + 1))}
                        disabled={yearOffset >= 0}
                        className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded disabled:opacity-30"
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>

            {/* Month labels */}
            <div className="flex text-[9px] text-slate-500 mb-1 ml-6">
                {months.map((m, i) => (
                    <div key={i} style={{ width: `${(months[i + 1]?.week ?? 53) - m.week}0px`, minWidth: '30px' }}>
                        {m.name}
                    </div>
                ))}
            </div>

            {/* Grid with day labels */}
            <div className="flex">
                {/* Day labels */}
                <div className="flex flex-col text-[9px] text-slate-500 mr-1 shrink-0">
                    <div className="h-[10px]"></div>
                    <div className="h-[10px] leading-[10px]">Mon</div>
                    <div className="h-[10px]"></div>
                    <div className="h-[10px] leading-[10px]">Wed</div>
                    <div className="h-[10px]"></div>
                    <div className="h-[10px] leading-[10px]">Fri</div>
                    <div className="h-[10px]"></div>
                </div>

                {/* Heatmap grid */}
                <div className="flex gap-[2px] overflow-x-auto">
                    {weeks.map((week, wIdx) => (
                        <div key={wIdx} className="flex flex-col gap-[2px]">
                            {week.map((day, dIdx) => (
                                <div
                                    key={dIdx}
                                    className={`w-[10px] h-[10px] rounded-sm ${getColor(day.count)} ${day.count >= 0 ? 'hover:ring-1 hover:ring-white/40 cursor-pointer' : ''}`}
                                    title={day.count >= 0 ? `${day.date}: ${day.count} activities` : ''}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-end gap-1 mt-2 text-[9px] text-slate-500">
                <span>Less</span>
                <div className="flex gap-[2px]">
                    <div className="w-[8px] h-[8px] rounded-sm bg-slate-800" />
                    <div className="w-[8px] h-[8px] rounded-sm bg-emerald-900" />
                    <div className="w-[8px] h-[8px] rounded-sm bg-emerald-700" />
                    <div className="w-[8px] h-[8px] rounded-sm bg-emerald-500" />
                    <div className="w-[8px] h-[8px] rounded-sm bg-emerald-400" />
                </div>
                <span>More</span>
            </div>
        </div>
    );
};

export default ActivityHeatmap;
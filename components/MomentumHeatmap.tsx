import React, { useMemo, useState } from 'react';
import { EntityKind } from '../types';
import { useStore } from '../store';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';

const MomentumHeatmap: React.FC = () => {
    const entities = useStore(state => state.entities) || [];
    const [yearOffset, setYearOffset] = useState(0);

    const { weeks, months, maxMinutes, year } = useMemo(() => {
        const now = new Date();
        const targetYear = now.getFullYear() + yearOffset;

        // Sum time spent per day
        const timeByDay: Record<string, number> = {};

        entities.forEach(e => {
            if (e.kind === EntityKind.ACTIVITY && e.duration_minutes) {
                const dateStr = (e.start_time || e.updated_at || e.created_at).split('T')[0];
                if (dateStr.startsWith(String(targetYear))) {
                    timeByDay[dateStr] = (timeByDay[dateStr] || 0) + e.duration_minutes;
                }
            }
        });

        // Start from Jan 1 of target year, align to Sunday
        const jan1 = new Date(targetYear, 0, 1);
        const startDate = new Date(jan1);
        startDate.setDate(jan1.getDate() - jan1.getDay());

        const weeksData: { date: string; minutes: number; day: number }[][] = [];
        const monthsData: { name: string; week: number }[] = [];

        let lastMonth = -1;
        let maxVal = 0;
        const current = new Date(startDate);

        for (let w = 0; w < 53; w++) {
            const week: { date: string; minutes: number; day: number }[] = [];

            for (let d = 0; d < 7; d++) {
                const dateStr = current.toISOString().split('T')[0];
                const minutes = timeByDay[dateStr] || 0;
                const isInYear = current.getFullYear() === targetYear;

                if (minutes > maxVal) maxVal = minutes;

                if (d === 0 && current.getMonth() !== lastMonth && isInYear) {
                    lastMonth = current.getMonth();
                    monthsData.push({
                        name: current.toLocaleDateString('en-US', { month: 'short' }),
                        week: w
                    });
                }

                week.push({
                    date: dateStr,
                    minutes: isInYear ? minutes : -1,
                    day: d
                });

                current.setDate(current.getDate() + 1);
            }

            weeksData.push(week);
        }

        return { weeks: weeksData, months: monthsData, maxMinutes: maxVal, year: targetYear };
    }, [entities, yearOffset]);

    const getColor = (minutes: number): string => {
        if (minutes < 0) return 'bg-transparent';
        if (minutes === 0) return 'bg-slate-800';
        if (maxMinutes === 0) return 'bg-slate-800';
        const ratio = minutes / maxMinutes;
        if (ratio <= 0.25) return 'bg-blue-900';
        if (ratio <= 0.5) return 'bg-blue-700';
        if (ratio <= 0.75) return 'bg-blue-500';
        return 'bg-blue-400';
    };

    const formatTime = (m: number): string => {
        if (m < 0) return '';
        if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
        return `${m}m`;
    };

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Clock size={16} className="text-blue-400" />
                    <h3 className="text-sm font-medium text-slate-300">Momentum (Time)</h3>
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
                                    className={`w-[10px] h-[10px] rounded-sm ${getColor(day.minutes)} ${day.minutes >= 0 ? 'hover:ring-1 hover:ring-white/40 cursor-pointer' : ''}`}
                                    title={day.minutes >= 0 ? `${day.date}: ${formatTime(day.minutes)}` : ''}
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
                    <div className="w-[8px] h-[8px] rounded-sm bg-blue-900" />
                    <div className="w-[8px] h-[8px] rounded-sm bg-blue-700" />
                    <div className="w-[8px] h-[8px] rounded-sm bg-blue-500" />
                    <div className="w-[8px] h-[8px] rounded-sm bg-blue-400" />
                </div>
                <span>More</span>
            </div>
        </div>
    );
};

export default MomentumHeatmap;

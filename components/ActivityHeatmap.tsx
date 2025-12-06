import React, { useMemo } from 'react';
import { useStore } from '../store';
import { EntityKind, EntityStatus } from '../types';

const ActivityHeatmap: React.FC = () => {
  const { entities } = useStore();

  const heatmapData = useMemo(() => {
    // 1. Generate map of date -> count
    const counts: Record<string, number> = {};
    
    entities.forEach(e => {
        // Count Activities
        if (e.kind === EntityKind.ACTIVITY && e.created_at) {
            const date = e.created_at.split('T')[0];
            counts[date] = (counts[date] || 0) + 1;
        }
        // Count Completed Tasks (using updated_at as proxy for completion time if not explicit)
        if (e.kind === EntityKind.TASK && e.status === EntityStatus.COMPLETED && e.updated_at) {
            const date = e.updated_at.split('T')[0];
            counts[date] = (counts[date] || 0) + 1;
        }
    });

    // 2. Generate last ~24 weeks (approx 6 months)
    const today = new Date();
    const weeks = 26; // Half a year
    const days = weeks * 7;
    const data = [];

    // Align to start of week (Sunday)
    const endDate = new Date(today);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days + (7 - today.getDay())); 

    for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        data.push({
            date: dateStr,
            count: counts[dateStr] || 0,
            dayOfWeek: d.getDay(),
            monthName: d.getDate() === 1 ? d.toLocaleString('default', { month: 'short' }) : null
        });
    }

    return data;
  }, [entities]);

  const getColor = (count: number) => {
      if (count === 0) return 'bg-slate-800/40 hover:bg-slate-700/50';
      if (count <= 2) return 'bg-indigo-900/60 hover:bg-indigo-900/80';
      if (count <= 4) return 'bg-indigo-600/60 hover:bg-indigo-600/80';
      return 'bg-emerald-500 hover:bg-emerald-400';
  };

  // Group by weeks for vertical column rendering
  const weeksData: typeof heatmapData[] = [];
  for (let i = 0; i < heatmapData.length; i += 7) {
      weeksData.push(heatmapData.slice(i, i + 7));
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-8 overflow-x-auto scrollbar-hide">
        <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-200">Momentum</h2>
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <span>Less</span>
                <div className="flex gap-1">
                    <div className="w-2.5 h-2.5 rounded-sm bg-slate-800/40"></div>
                    <div className="w-2.5 h-2.5 rounded-sm bg-indigo-900/60"></div>
                    <div className="w-2.5 h-2.5 rounded-sm bg-indigo-600/60"></div>
                    <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500"></div>
                </div>
                <span>More</span>
            </div>
        </div>
        
        <div className="flex gap-1 min-w-max">
            {weeksData.map((week, wIdx) => (
                <div key={wIdx} className="flex flex-col gap-1 relative">
                    {/* Month Label */}
                    {week.some(d => d.monthName) && (
                         <div className="absolute -top-5 text-[9px] text-slate-500 font-bold">
                             {week.find(d => d.monthName)?.monthName}
                         </div>
                    )}
                    
                    {week.map((day) => (
                        <div 
                            key={day.date}
                            className={`w-3 h-3 rounded-sm ${getColor(day.count)} transition-colors relative group`}
                        >
                            <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-slate-950 text-[10px] text-white px-2 py-1 rounded border border-slate-700 whitespace-nowrap z-50 shadow-xl pointer-events-none`}>
                                <span className="font-bold">{day.count}</span> items on {day.date}
                            </div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    </div>
  );
};

export default ActivityHeatmap;
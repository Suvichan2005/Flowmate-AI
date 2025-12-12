import React, { useMemo } from 'react';
import { Entity, EntityKind, ProductivityType } from '../types';
import { Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { getActivityEntities } from '../utils/streakCalculation';

interface DailyProductivityBarProps {
    entities: Entity[];
    selectedDate?: string; // YYYY-MM-DD, defaults to today
}

interface HourlyData {
    hour: number; // 0-23
    productiveMinutes: number;
    neutralMinutes: number;
    unproductiveMinutes: number;
    totalMinutes: number;
}

/**
 * Component that displays a 24-hour productivity bar showing hourly breakdown
 * Green = Productive, Yellow = Neutral, Red = Unproductive, Grey = No data
 */
const DailyProductivityBar: React.FC<DailyProductivityBarProps> = ({ 
    entities, 
    selectedDate 
}) => {
    const hourlyBreakdown = useMemo(() => {
        // Get target date (default to today)
        const targetDate = selectedDate || new Date().toISOString().split('T')[0];
        
        // Initialize 24 hours
        const hours: HourlyData[] = Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            productiveMinutes: 0,
            neutralMinutes: 0,
            unproductiveMinutes: 0,
            totalMinutes: 0
        }));

        // Get all activity entities (including nested logs) using utility
        const allActivities = getActivityEntities(entities);
        const activities = allActivities.filter(a => a.created_at.startsWith(targetDate));

        // Aggregate by hour
        activities.forEach(activity => {
            const timestamp = new Date(activity.created_at);
            const hour = timestamp.getHours();
            const minutes = activity.duration_minutes || 0;
            const productivity = activity.metadata?.productivity as ProductivityType | undefined;

            if (hour >= 0 && hour < 24) {
                hours[hour].totalMinutes += minutes;
                
                if (productivity === 'PRODUCTIVE') {
                    hours[hour].productiveMinutes += minutes;
                } else if (productivity === 'UNPRODUCTIVE') {
                    hours[hour].unproductiveMinutes += minutes;
                } else {
                    hours[hour].neutralMinutes += minutes;
                }
            }
        });

        return hours;
    }, [entities, selectedDate]);

    // Calculate overall stats
    const stats = useMemo(() => {
        const totalMinutes = hourlyBreakdown.reduce((sum, h) => sum + h.totalMinutes, 0);
        const productiveMinutes = hourlyBreakdown.reduce((sum, h) => sum + h.productiveMinutes, 0);
        const unproductiveMinutes = hourlyBreakdown.reduce((sum, h) => sum + h.unproductiveMinutes, 0);
        
        const mostProductiveHour = hourlyBreakdown.reduce((max, h) => 
            h.productiveMinutes > max.productiveMinutes ? h : max
        , hourlyBreakdown[0]);

        const leastProductiveHour = hourlyBreakdown
            .filter(h => h.totalMinutes > 0)
            .reduce((min, h) => 
                h.unproductiveMinutes > min.unproductiveMinutes ? h : min
            , hourlyBreakdown[0]);

        return {
            totalMinutes,
            productiveMinutes,
            unproductiveMinutes,
            mostProductiveHour: mostProductiveHour.totalMinutes > 0 ? mostProductiveHour.hour : null,
            leastProductiveHour: leastProductiveHour.totalMinutes > 0 ? leastProductiveHour.hour : null,
            productivityScore: totalMinutes > 0 ? Math.round((productiveMinutes / totalMinutes) * 100) : 0
        };
    }, [hourlyBreakdown]);

    const formatHour = (hour: number) => {
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}${ampm}`;
    };

    const getBarColor = (hour: HourlyData) => {
        if (hour.totalMinutes === 0) return 'bg-gray-800/50'; // No data
        
        const prodPercent = (hour.productiveMinutes / hour.totalMinutes) * 100;
        const unprodPercent = (hour.unproductiveMinutes / hour.totalMinutes) * 100;
        
        if (prodPercent >= 60) return 'bg-teal-500';
        if (unprodPercent >= 60) return 'bg-rose-500';
        return 'bg-gray-500';
    };

    const getBarHeight = (hour: HourlyData) => {
        const maxMinutes = Math.max(...hourlyBreakdown.map(h => h.totalMinutes), 60);
        if (hour.totalMinutes === 0) return 4; // Minimum height for empty hours
        return Math.max(12, (hour.totalMinutes / maxMinutes) * 100);
    };

    return (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                    <Clock size={16} className="text-teal-400" />
                    24-Hour Productivity Timeline
                </h3>
                <div className="text-xs text-gray-400">
                    {selectedDate || 'Today'}
                </div>
            </div>

            {/* Insights */}
            {stats.totalMinutes > 0 && (
                <div className="mb-4 grid grid-cols-2 gap-2">
                    {stats.mostProductiveHour !== null && (
                        <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <TrendingUp size={12} className="text-teal-400" />
                                <span className="text-xs text-teal-300">Peak Hour</span>
                            </div>
                            <div className="text-sm font-bold text-white">
                                {formatHour(stats.mostProductiveHour)}
                            </div>
                        </div>
                    )}
                    {stats.leastProductiveHour !== null && (
                        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <TrendingDown size={12} className="text-rose-400" />
                                <span className="text-xs text-rose-300">Low Hour</span>
                            </div>
                            <div className="text-sm font-bold text-white">
                                {formatHour(stats.leastProductiveHour)}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 24-Hour Bar Chart */}
            <div className="flex items-end justify-between gap-0.5 h-24 mb-2">
                {hourlyBreakdown.map((hour) => (
                    <div
                        key={hour.hour}
                        className="flex-1 relative group"
                        style={{ height: '100%' }}
                    >
                        <div
                            className={`${getBarColor(hour)} rounded-t transition-all duration-300 absolute bottom-0 w-full`}
                            style={{ height: `${getBarHeight(hour)}%` }}
                        />
                        
                        {/* Tooltip on hover */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                            <div className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs whitespace-nowrap shadow-xl">
                                <div className="font-bold text-white mb-1">{formatHour(hour.hour)}</div>
                                {hour.totalMinutes > 0 ? (
                                    <>
                                        <div className="text-teal-300">✓ {Math.round(hour.productiveMinutes)}m</div>
                                        <div className="text-gray-400">○ {Math.round(hour.neutralMinutes)}m</div>
                                        <div className="text-rose-300">✗ {Math.round(hour.unproductiveMinutes)}m</div>
                                    </>
                                ) : (
                                    <div className="text-gray-500">No activity</div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Hour labels (show every 3 hours) */}
            <div className="flex justify-between text-xs text-gray-600">
                {[0, 3, 6, 9, 12, 15, 18, 21].map(hour => (
                    <div key={hour}>{formatHour(hour)}</div>
                ))}
            </div>

            {/* Legend */}
            <div className="mt-4 flex items-center justify-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-teal-500" />
                    <span className="text-gray-400">Productive</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-gray-500" />
                    <span className="text-gray-400">Neutral</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-rose-500" />
                    <span className="text-gray-400">Downtime</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-gray-800" />
                    <span className="text-gray-400">No Data</span>
                </div>
            </div>
        </div>
    );
};

export default DailyProductivityBar;

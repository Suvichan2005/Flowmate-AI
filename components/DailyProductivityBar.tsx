import React, { useMemo, useState } from 'react';
import { Entity, EntityKind, EntityStatus, ProductivityType } from '../types';
import { Clock, Moon, Zap, Coffee, Gamepad2 } from 'lucide-react';
import { getActivityEntities } from '../utils/streakCalculation';

interface DailyProductivityBarProps {
    entities: Entity[];
    date?: Date; // Defaults to today
}

interface HourData {
    hour: number;
    productiveMinutes: number;
    neutralMinutes: number;
    unproductiveMinutes: number;
    sleepMinutes: number;
    activities: { title: string; duration: number; type: ProductivityType }[];
}

const HOUR_LABELS = ['12a', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
    '12p', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];

const DailyProductivityBar: React.FC<DailyProductivityBarProps> = ({ entities, date }) => {
    const targetDate = date || new Date();
    const [hoveredHour, setHoveredHour] = useState<number | null>(null);

    const hourlyData = useMemo(() => {
        const dateStr = targetDate.toISOString().split('T')[0];
        const hours: HourData[] = Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            productiveMinutes: 0,
            neutralMinutes: 0,
            unproductiveMinutes: 0,
            sleepMinutes: 0,
            activities: []
        }));

        // Get all activities (including pseudo-entities from logs)
        const activities = getActivityEntities(entities);

        // Filter to target date and group by hour
        activities.forEach(activity => {
            const timestamp = activity.start_time || activity.created_at;
            if (!timestamp) return;

            const activityDate = new Date(timestamp);
            const activityDateStr = activityDate.toISOString().split('T')[0];

            if (activityDateStr !== dateStr) return;

            const hour = activityDate.getHours();
            const duration = activity.duration_minutes || 0;
            const productivityType = (activity.metadata?.productivity as ProductivityType) || 'NEUTRAL';

            // Add to hour bucket
            if (productivityType === 'PRODUCTIVE') {
                hours[hour].productiveMinutes += duration;
            } else if (productivityType === 'UNPRODUCTIVE') {
                hours[hour].unproductiveMinutes += duration;
            } else if (productivityType === 'SLEEP') {
                hours[hour].sleepMinutes += duration;
            } else {
                hours[hour].neutralMinutes += duration;
            }

            hours[hour].activities.push({
                title: activity.title,
                duration,
                type: productivityType
            });
        });

        return hours;
    }, [entities, targetDate]);

    const getHourColor = (hourData: HourData) => {
        const total = hourData.productiveMinutes + hourData.neutralMinutes +
            hourData.unproductiveMinutes + hourData.sleepMinutes;

        if (total === 0) return 'bg-slate-800/50'; // No data

        // Find dominant category
        const max = Math.max(
            hourData.productiveMinutes,
            hourData.neutralMinutes,
            hourData.unproductiveMinutes,
            hourData.sleepMinutes
        );

        if (max === hourData.sleepMinutes) return 'bg-indigo-500';
        if (max === hourData.productiveMinutes) return 'bg-teal-500';
        if (max === hourData.unproductiveMinutes) return 'bg-rose-500';
        return 'bg-slate-500'; // Neutral
    };

    const getHourOpacity = (hourData: HourData) => {
        const total = hourData.productiveMinutes + hourData.neutralMinutes +
            hourData.unproductiveMinutes + hourData.sleepMinutes;
        if (total === 0) return 0.3;
        // Scale opacity based on how "full" the hour is (60 min = full)
        return Math.min(1, 0.4 + (total / 60) * 0.6);
    };

    const totalMinutes = hourlyData.reduce((sum, h) =>
        sum + h.productiveMinutes + h.neutralMinutes + h.unproductiveMinutes + h.sleepMinutes, 0);

    const prodMinutes = hourlyData.reduce((sum, h) => sum + h.productiveMinutes, 0);
    const sleepMinutes = hourlyData.reduce((sum, h) => sum + h.sleepMinutes, 0);
    const awakeMinutes = totalMinutes - sleepMinutes;
    const focusScore = awakeMinutes > 0 ? Math.round((prodMinutes / awakeMinutes) * 100) : 0;

    const formatTime = (hour: number) => {
        const suffix = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return `${displayHour}:00 ${suffix}`;
    };

    return (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                    <Clock size={16} className="text-indigo-400" />
                    Today's Timeline
                </h3>
                <div className="flex items-center gap-4 text-xs">
                    <span className="text-teal-400 font-medium">{Math.round(prodMinutes / 60 * 10) / 10}h Productive</span>
                    <span className="text-slate-400">|</span>
                    <span className="text-indigo-400">{focusScore}% Focus</span>
                </div>
            </div>

            {/* 24-Hour Bar */}
            <div className="relative">
                <div className="flex h-10 rounded-lg overflow-hidden border border-slate-700/50">
                    {hourlyData.map((hourData, idx) => (
                        <div
                            key={idx}
                            className={`flex-1 ${getHourColor(hourData)} transition-all duration-200 cursor-pointer hover:brightness-125 border-r border-slate-900/30 last:border-r-0`}
                            style={{ opacity: getHourOpacity(hourData) }}
                            onMouseEnter={() => setHoveredHour(idx)}
                            onMouseLeave={() => setHoveredHour(null)}
                        />
                    ))}
                </div>

                {/* Hour labels */}
                <div className="flex mt-1">
                    {[0, 6, 12, 18].map(hour => (
                        <div
                            key={hour}
                            className="text-[10px] text-slate-500"
                            style={{
                                position: 'absolute',
                                left: `${(hour / 24) * 100}%`,
                                transform: 'translateX(-50%)'
                            }}
                        >
                            {formatTime(hour)}
                        </div>
                    ))}
                    <div
                        className="text-[10px] text-slate-500"
                        style={{ position: 'absolute', right: 0 }}
                    >
                        11 PM
                    </div>
                </div>

                {/* Tooltip */}
                {hoveredHour !== null && (
                    <div
                        className="absolute top-12 bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-xl z-20 min-w-[180px]"
                        style={{
                            left: `${(hoveredHour / 24) * 100}%`,
                            transform: 'translateX(-50%)'
                        }}
                    >
                        <div className="text-xs font-semibold text-slate-200 mb-2">
                            {formatTime(hoveredHour)}
                        </div>
                        {hourlyData[hoveredHour].activities.length > 0 ? (
                            <div className="space-y-1">
                                {hourlyData[hoveredHour].activities.slice(0, 5).map((act, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs">
                                        <div className={`w-2 h-2 rounded-full ${act.type === 'PRODUCTIVE' ? 'bg-teal-500' :
                                            act.type === 'UNPRODUCTIVE' ? 'bg-rose-500' :
                                                act.type === 'SLEEP' ? 'bg-indigo-500' : 'bg-slate-500'
                                            }`} />
                                        <span className="text-slate-300 truncate max-w-[120px]">{act.title}</span>
                                        <span className="text-slate-500">{act.duration}m</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-xs text-slate-500">No activity logged</div>
                        )}
                    </div>
                )}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-4 mt-6 text-xs">
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-teal-500" />
                    <span className="text-slate-400">Productive</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-slate-500" />
                    <span className="text-slate-400">Neutral</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-rose-500" />
                    <span className="text-slate-400">Downtime</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-indigo-500" />
                    <span className="text-slate-400">Sleep</span>
                </div>
            </div>
        </div>
    );
};

export default DailyProductivityBar;

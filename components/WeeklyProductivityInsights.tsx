import React, { useMemo } from 'react';
import { Entity, EntityKind, ProductivityType } from '../types';
import { Calendar, TrendingUp, Clock, Target } from 'lucide-react';

interface WeeklyProductivityInsightsProps {
    entities: Entity[];
}

interface DayData {
    dayOfWeek: number; // 0 = Sunday, 6 = Saturday
    dayName: string;
    productiveMinutes: number;
    neutralMinutes: number;
    unproductiveMinutes: number;
    totalMinutes: number;
    activityCount: number;
}

interface TimeOfDayData {
    period: string;
    hours: number[];
    productiveMinutes: number;
    totalMinutes: number;
}

/**
 * Component that shows weekly productivity patterns and insights
 */
const WeeklyProductivityInsights: React.FC<WeeklyProductivityInsightsProps> = ({ entities }) => {
    const weeklyData = useMemo(() => {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        // Initialize days
        const days: DayData[] = dayNames.map((name, idx) => ({
            dayOfWeek: idx,
            dayName: name,
            productiveMinutes: 0,
            neutralMinutes: 0,
            unproductiveMinutes: 0,
            totalMinutes: 0,
            activityCount: 0
        }));

        // Get last 30 days of data for more reliable patterns
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Get activities
        const activities = entities.filter(e => 
            e.kind === EntityKind.ACTIVITY && 
            new Date(e.created_at) >= thirtyDaysAgo
        );

        // Extract nested activity logs
        entities.forEach(entity => {
            if (entity.metadata?.activity_log && Array.isArray(entity.metadata.activity_log)) {
                entity.metadata.activity_log.forEach((log: any) => {
                    if (log.timestamp && new Date(log.timestamp) >= thirtyDaysAgo) {
                        activities.push({
                            ...entity,
                            id: `${entity.id}-log-${log.id}`,
                            created_at: log.timestamp,
                            duration_minutes: log.duration_minutes || 0,
                            metadata: {
                                ...entity.metadata,
                                productivity: log.productivity || entity.metadata.productivity
                            }
                        });
                    }
                });
            }
        });

        // Aggregate by day of week
        activities.forEach(activity => {
            const date = new Date(activity.created_at);
            const dayOfWeek = date.getDay();
            const minutes = activity.duration_minutes || 0;
            const productivity = activity.metadata?.productivity as ProductivityType | undefined;

            days[dayOfWeek].totalMinutes += minutes;
            days[dayOfWeek].activityCount += 1;

            if (productivity === 'PRODUCTIVE') {
                days[dayOfWeek].productiveMinutes += minutes;
            } else if (productivity === 'UNPRODUCTIVE') {
                days[dayOfWeek].unproductiveMinutes += minutes;
            } else {
                days[dayOfWeek].neutralMinutes += minutes;
            }
        });

        return days;
    }, [entities]);

    const timeOfDayData = useMemo(() => {
        const periods: TimeOfDayData[] = [
            { period: 'Early Morning', hours: [5, 6, 7, 8], productiveMinutes: 0, totalMinutes: 0 },
            { period: 'Morning', hours: [9, 10, 11], productiveMinutes: 0, totalMinutes: 0 },
            { period: 'Afternoon', hours: [12, 13, 14, 15], productiveMinutes: 0, totalMinutes: 0 },
            { period: 'Evening', hours: [16, 17, 18, 19], productiveMinutes: 0, totalMinutes: 0 },
            { period: 'Night', hours: [20, 21, 22, 23], productiveMinutes: 0, totalMinutes: 0 },
            { period: 'Late Night', hours: [0, 1, 2, 3, 4], productiveMinutes: 0, totalMinutes: 0 }
        ];

        // Get last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const activities = entities.filter(e => 
            e.kind === EntityKind.ACTIVITY && 
            new Date(e.created_at) >= thirtyDaysAgo
        );

        // Extract nested logs
        entities.forEach(entity => {
            if (entity.metadata?.activity_log && Array.isArray(entity.metadata.activity_log)) {
                entity.metadata.activity_log.forEach((log: any) => {
                    if (log.timestamp && new Date(log.timestamp) >= thirtyDaysAgo) {
                        activities.push({
                            ...entity,
                            id: `${entity.id}-log-${log.id}`,
                            created_at: log.timestamp,
                            duration_minutes: log.duration_minutes || 0,
                            metadata: {
                                ...entity.metadata,
                                productivity: log.productivity || entity.metadata.productivity
                            }
                        });
                    }
                });
            }
        });

        activities.forEach(activity => {
            const hour = new Date(activity.created_at).getHours();
            const minutes = activity.duration_minutes || 0;
            const productivity = activity.metadata?.productivity as ProductivityType | undefined;

            periods.forEach(period => {
                if (period.hours.includes(hour)) {
                    period.totalMinutes += minutes;
                    if (productivity === 'PRODUCTIVE') {
                        period.productiveMinutes += minutes;
                    }
                }
            });
        });

        return periods;
    }, [entities]);

    const insights = useMemo(() => {
        // Find most productive day
        const mostProductiveDay = weeklyData.reduce((max, day) => 
            day.productiveMinutes > max.productiveMinutes ? day : max
        , weeklyData[0]);

        // Find least productive day (excluding days with no data)
        const daysWithData = weeklyData.filter(d => d.totalMinutes > 0);
        const leastProductiveDay = daysWithData.length > 0 
            ? daysWithData.reduce((min, day) => {
                const minRatio = min.totalMinutes > 0 ? min.productiveMinutes / min.totalMinutes : 1;
                const dayRatio = day.totalMinutes > 0 ? day.productiveMinutes / day.totalMinutes : 1;
                return dayRatio < minRatio ? day : min;
            }, daysWithData[0])
            : null;

        // Find best time of day
        const bestTimeOfDay = timeOfDayData.reduce((max, period) => {
            const maxRatio = max.totalMinutes > 0 ? max.productiveMinutes / max.totalMinutes : 0;
            const periodRatio = period.totalMinutes > 0 ? period.productiveMinutes / period.totalMinutes : 0;
            return periodRatio > maxRatio ? period : max;
        }, timeOfDayData[0]);

        // Find worst time of day (with data)
        const periodsWithData = timeOfDayData.filter(p => p.totalMinutes > 0);
        const worstTimeOfDay = periodsWithData.length > 0
            ? periodsWithData.reduce((min, period) => {
                const minRatio = min.totalMinutes > 0 ? min.productiveMinutes / min.totalMinutes : 1;
                const periodRatio = period.totalMinutes > 0 ? period.productiveMinutes / period.totalMinutes : 1;
                return periodRatio < minRatio ? period : min;
            }, periodsWithData[0])
            : null;

        return {
            mostProductiveDay,
            leastProductiveDay,
            bestTimeOfDay,
            worstTimeOfDay
        };
    }, [weeklyData, timeOfDayData]);

    const maxDayMinutes = Math.max(...weeklyData.map(d => d.totalMinutes), 1);

    return (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-5">
            <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                <Calendar size={16} className="text-purple-400" />
                Weekly Productivity Patterns
            </h3>

            {/* Key Insights */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                {/* Most Productive Day */}
                {insights.mostProductiveDay.totalMinutes > 0 && (
                    <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                            <TrendingUp size={14} className="text-teal-400" />
                            <span className="text-xs text-teal-300 font-medium">Best Day</span>
                        </div>
                        <div className="text-base font-bold text-white">
                            {insights.mostProductiveDay.dayName}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                            {Math.round(insights.mostProductiveDay.productiveMinutes / 60 * 10) / 10}h productive
                        </div>
                    </div>
                )}

                {/* Best Time of Day */}
                {insights.bestTimeOfDay.totalMinutes > 0 && (
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                            <Clock size={14} className="text-blue-400" />
                            <span className="text-xs text-blue-300 font-medium">Peak Time</span>
                        </div>
                        <div className="text-base font-bold text-white">
                            {insights.bestTimeOfDay.period}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                            {Math.round((insights.bestTimeOfDay.productiveMinutes / insights.bestTimeOfDay.totalMinutes) * 100)}% productive
                        </div>
                    </div>
                )}
            </div>

            {/* Day of Week Breakdown */}
            <div className="space-y-2">
                <h4 className="text-xs text-gray-500 mb-2">Productivity by Day</h4>
                {weeklyData.map(day => (
                    <div key={day.dayOfWeek} className="flex items-center gap-2">
                        <div className="w-16 text-xs text-gray-400">{day.dayName.slice(0, 3)}</div>
                        
                        {/* Bar */}
                        <div className="flex-1 flex h-6 bg-gray-800 rounded-md overflow-hidden">
                            {day.totalMinutes > 0 ? (
                                <>
                                    <div 
                                        style={{ 
                                            width: `${(day.productiveMinutes / maxDayMinutes) * 100}%` 
                                        }}
                                        className="bg-teal-500 transition-all"
                                    />
                                    <div 
                                        style={{ 
                                            width: `${(day.neutralMinutes / maxDayMinutes) * 100}%` 
                                        }}
                                        className="bg-gray-500 transition-all"
                                    />
                                    <div 
                                        style={{ 
                                            width: `${(day.unproductiveMinutes / maxDayMinutes) * 100}%` 
                                        }}
                                        className="bg-rose-500 transition-all"
                                    />
                                </>
                            ) : (
                                <div className="w-full flex items-center justify-center text-xs text-gray-600">
                                    No data
                                </div>
                            )}
                        </div>

                        {/* Time label */}
                        <div className="w-12 text-xs text-gray-400 text-right">
                            {day.totalMinutes > 0 ? `${Math.round(day.totalMinutes / 60)}h` : ''}
                        </div>
                    </div>
                ))}
            </div>

            {/* Time of Day Performance */}
            {insights.worstTimeOfDay && (
                <div className="mt-5 pt-4 border-t border-gray-700">
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                            <Target size={14} className="text-amber-400" />
                            <span className="text-xs text-amber-300 font-medium">Insight</span>
                        </div>
                        <div className="text-sm text-gray-300">
                            {insights.worstTimeOfDay.period} productivity drops to{' '}
                            <span className="text-white font-bold">
                                {Math.round((insights.worstTimeOfDay.productiveMinutes / insights.worstTimeOfDay.totalMinutes) * 100)}%
                            </span>
                            . Consider scheduling deep work during {insights.bestTimeOfDay.period.toLowerCase()}.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WeeklyProductivityInsights;

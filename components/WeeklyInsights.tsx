import React, { useMemo } from 'react';
import { Entity, ProductivityType } from '../types';
import { getActivityEntities } from '../utils/streakCalculation';
import { TrendingUp, Sun, Moon, Clock, Sparkles, AlertTriangle } from 'lucide-react';

interface WeeklyInsightsProps {
    entities: Entity[];
}

interface DayStats {
    day: string;
    shortDay: string;
    productiveMinutes: number;
    totalMinutes: number;
    score: number;
}

interface TimeSlotStats {
    slot: string;
    productiveMinutes: number;
    totalMinutes: number;
    score: number;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_SLOTS = [
    { name: 'Early Morning', range: 'Before 9am', hours: [5, 6, 7, 8] },
    { name: 'Morning', range: '9am-12pm', hours: [9, 10, 11] },
    { name: 'Afternoon', range: '12-5pm', hours: [12, 13, 14, 15, 16] },
    { name: 'Evening', range: '5-9pm', hours: [17, 18, 19, 20] },
    { name: 'Night', range: 'After 9pm', hours: [21, 22, 23, 0, 1, 2, 3, 4] }
];

const WeeklyInsights: React.FC<WeeklyInsightsProps> = ({ entities }) => {
    const insights = useMemo(() => {
        const now = new Date();
        const fourWeeksAgo = new Date(now);
        fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

        // Initialize day stats
        const dayStats: DayStats[] = DAYS.map((day, i) => ({
            day,
            shortDay: SHORT_DAYS[i],
            productiveMinutes: 0,
            totalMinutes: 0,
            score: 0
        }));

        // Initialize time slot stats
        const timeSlotStats: TimeSlotStats[] = TIME_SLOTS.map(slot => ({
            slot: slot.name,
            productiveMinutes: 0,
            totalMinutes: 0,
            score: 0
        }));

        // Get all activities
        const activities = getActivityEntities(entities);

        // Process activities from last 4 weeks
        activities.forEach(a => {
            const timestamp = a.start_time || a.created_at;
            if (!timestamp) return;

            const date = new Date(timestamp);
            if (date < fourWeeksAgo) return;

            const dayOfWeek = date.getDay();
            const hour = date.getHours();
            const duration = a.duration_minutes || 0;
            const prodType = (a.metadata?.productivity as ProductivityType) || 'NEUTRAL';
            const isProductive = prodType === 'PRODUCTIVE';

            // Update day stats
            dayStats[dayOfWeek].totalMinutes += duration;
            if (isProductive) {
                dayStats[dayOfWeek].productiveMinutes += duration;
            }

            // Update time slot stats
            TIME_SLOTS.forEach((slot, idx) => {
                if (slot.hours.includes(hour)) {
                    timeSlotStats[idx].totalMinutes += duration;
                    if (isProductive) {
                        timeSlotStats[idx].productiveMinutes += duration;
                    }
                }
            });
        });

        // Calculate scores
        dayStats.forEach(d => {
            d.score = d.totalMinutes > 0 ? Math.round((d.productiveMinutes / d.totalMinutes) * 100) : 0;
        });
        timeSlotStats.forEach(t => {
            t.score = t.totalMinutes > 0 ? Math.round((t.productiveMinutes / t.totalMinutes) * 100) : 0;
        });

        // Find best/worst
        const daysWithData = dayStats.filter(d => d.totalMinutes > 30);
        const timesWithData = timeSlotStats.filter(t => t.totalMinutes > 30);

        const bestDay = daysWithData.length > 0
            ? daysWithData.reduce((a, b) => a.score > b.score ? a : b)
            : null;
        const worstDay = daysWithData.length > 0
            ? daysWithData.reduce((a, b) => a.score < b.score ? a : b)
            : null;
        const bestTime = timesWithData.length > 0
            ? timesWithData.reduce((a, b) => a.score > b.score ? a : b)
            : null;
        const worstTime = timesWithData.length > 0
            ? timesWithData.reduce((a, b) => a.score < b.score ? a : b)
            : null;

        // Generate insight messages
        const messages: { text: string; type: 'positive' | 'warning' | 'neutral' }[] = [];

        if (bestDay && bestDay.score >= 50) {
            messages.push({
                text: `You're most productive on ${bestDay.day}s (${bestDay.score}% focus)`,
                type: 'positive'
            });
        }
        if (worstDay && worstDay.score < 30 && worstDay.totalMinutes > 60) {
            messages.push({
                text: `${worstDay.day}s tend to be unproductive (${worstDay.score}% focus)`,
                type: 'warning'
            });
        }
        if (bestTime && bestTime.score >= 50) {
            messages.push({
                text: `Peak productivity: ${bestTime.slot} (${bestTime.score}% focus)`,
                type: 'positive'
            });
        }
        if (worstTime && worstTime.score < 30 && worstTime.totalMinutes > 60) {
            messages.push({
                text: `${worstTime.slot} productivity drops to ${worstTime.score}%`,
                type: 'warning'
            });
        }

        if (messages.length === 0) {
            messages.push({
                text: 'Log more activities with productivity tags to see insights!',
                type: 'neutral'
            });
        }

        return { dayStats, timeSlotStats, messages, bestDay, bestTime };
    }, [entities]);

    const maxDayScore = Math.max(...insights.dayStats.map(d => d.score), 1);
    const maxTimeScore = Math.max(...insights.timeSlotStats.map(t => t.score), 1);

    return (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                <Sparkles size={16} className="text-purple-400" />
                Weekly Productivity Insights
            </h3>

            {/* Insight Cards */}
            <div className="space-y-2 mb-5">
                {insights.messages.slice(0, 3).map((msg, i) => (
                    <div
                        key={i}
                        className={`flex items-start gap-2 p-2.5 rounded-lg text-sm ${msg.type === 'positive' ? 'bg-teal-500/10 text-teal-300' :
                            msg.type === 'warning' ? 'bg-amber-500/10 text-amber-300' :
                                'bg-slate-800/50 text-slate-400'
                            }`}
                    >
                        {msg.type === 'positive' && <TrendingUp size={16} className="shrink-0 mt-0.5" />}
                        {msg.type === 'warning' && <AlertTriangle size={16} className="shrink-0 mt-0.5" />}
                        {msg.type === 'neutral' && <Sparkles size={16} className="shrink-0 mt-0.5" />}
                        <span>{msg.text}</span>
                    </div>
                ))}
            </div>

            {/* Day of Week Chart */}
            <div className="mb-5">
                <div className="text-xs text-slate-500 mb-2">Productivity by Day</div>
                <div className="flex items-end gap-1 h-20">
                    {insights.dayStats.map((day, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center">
                            <div
                                className={`w-full rounded-t transition-all ${day.score >= 50 ? 'bg-teal-500' :
                                    day.score >= 30 ? 'bg-slate-500' :
                                        day.totalMinutes > 0 ? 'bg-rose-500/60' : 'bg-slate-800'
                                    }`}
                                style={{
                                    height: day.totalMinutes > 0
                                        ? `${Math.max(8, (day.score / maxDayScore) * 100)}%`
                                        : '8%',
                                    opacity: day.totalMinutes > 0 ? 1 : 0.3
                                }}
                                title={`${day.day}: ${day.score}% (${Math.round(day.totalMinutes / 60)}h logged)`}
                            />
                            <span className="text-[10px] text-slate-500 mt-1">{day.shortDay}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Time of Day Chart */}
            <div>
                <div className="text-xs text-slate-500 mb-2">Productivity by Time of Day</div>
                <div className="space-y-1.5">
                    {insights.timeSlotStats.map((slot, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <div className="w-20 text-[10px] text-slate-500 truncate">{slot.slot}</div>
                            <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
                                <div
                                    className={`h-full transition-all ${slot.score >= 50 ? 'bg-teal-500' :
                                        slot.score >= 30 ? 'bg-slate-500' :
                                            slot.totalMinutes > 0 ? 'bg-rose-500/60' : 'bg-transparent'
                                        }`}
                                    style={{ width: `${slot.totalMinutes > 0 ? Math.max(5, slot.score) : 0}%` }}
                                />
                            </div>
                            <div className="w-10 text-right text-[10px] text-slate-400">
                                {slot.totalMinutes > 0 ? `${slot.score}%` : '-'}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default WeeklyInsights;

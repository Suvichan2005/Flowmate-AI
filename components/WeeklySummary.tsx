import React, { useMemo } from 'react';
import { Entity, EntityKind, EntityStatus, Relationship, RelationshipType } from '../types';
import { getActivityEntities } from '../utils/streakCalculation';
import { CheckCircle, Clock, Flame, TrendingUp, TrendingDown } from 'lucide-react';

interface WeeklySummaryProps {
    entities: Entity[];
    relationships: Relationship[];
}

const WeeklySummary: React.FC<WeeklySummaryProps> = ({ entities, relationships }) => {
    const stats = useMemo(() => {
        const now = new Date();
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const twoWeeksAgo = new Date(now);
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

        // This week stats
        let tasksCompletedThisWeek = 0;
        let hoursLoggedThisWeek = 0;
        let activitiesThisWeek = 0;

        // Last week stats (for comparison)
        let tasksCompletedLastWeek = 0;
        let hoursLoggedLastWeek = 0;

        // Count completed tasks
        entities.forEach(e => {
            const updatedAt = new Date(e.updated_at);

            // Tasks completed this week
            if (e.kind === EntityKind.TASK && e.status === EntityStatus.COMPLETED) {
                if (updatedAt >= weekAgo) {
                    tasksCompletedThisWeek++;
                } else if (updatedAt >= twoWeeksAgo && updatedAt < weekAgo) {
                    tasksCompletedLastWeek++;
                }
            }
        });

        // Get all activities (legacy ACTIVITY entities + metadata.activity_log entries)
        const allActivities = getActivityEntities(entities);

        // Count activities and hours
        allActivities.forEach(e => {
            const actDate = new Date(e.start_time || e.created_at);
            if (actDate >= weekAgo) {
                activitiesThisWeek++;
                hoursLoggedThisWeek += (e.duration_minutes || 0) / 60;
            } else if (actDate >= twoWeeksAgo && actDate < weekAgo) {
                hoursLoggedLastWeek += (e.duration_minutes || 0) / 60;
            }
        });

        // Calculate changes
        const taskChange = tasksCompletedLastWeek > 0
            ? Math.round(((tasksCompletedThisWeek - tasksCompletedLastWeek) / tasksCompletedLastWeek) * 100)
            : tasksCompletedThisWeek > 0 ? 100 : 0;

        const hoursChange = hoursLoggedLastWeek > 0
            ? Math.round(((hoursLoggedThisWeek - hoursLoggedLastWeek) / hoursLoggedLastWeek) * 100)
            : hoursLoggedThisWeek > 0 ? 100 : 0;

        // Get longest habit streak
        let longestStreak = 0;
        let streakHabit = '';
        entities.filter(e => e.kind === EntityKind.HABIT).forEach(h => {
            const streak = h.metadata?.streak_current || 0;
            if (streak > longestStreak) {
                longestStreak = streak;
                streakHabit = h.title;
            }
        });

        return {
            tasksCompleted: tasksCompletedThisWeek,
            taskChange,
            hoursLogged: hoursLoggedThisWeek.toFixed(1),
            hoursChange,
            activities: activitiesThisWeek,
            longestStreak,
            streakHabit
        };
    }, [entities]);

    const StatCard = ({ icon: Icon, label, value, change, suffix = '' }: any) => (
        <div className="bg-gray-900/50 rounded-lg p-3 flex flex-col">
            <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                <Icon size={14} />
                {label}
            </div>
            <div className="text-2xl font-bold text-white">
                {value}{suffix}
            </div>
            {change !== undefined && change !== 0 && (
                <div className={`flex items-center gap-1 text-xs mt-1 ${change > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {change > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {Math.abs(change)}% vs last week
                </div>
            )}
        </div>
    );

    return (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-4">This Week's Summary</h3>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                    icon={CheckCircle}
                    label="Tasks Completed"
                    value={stats.tasksCompleted}
                    change={stats.taskChange}
                />
                <StatCard
                    icon={Clock}
                    label="Hours Logged"
                    value={stats.hoursLogged}
                    suffix="h"
                    change={stats.hoursChange}
                />
                <StatCard
                    icon={Flame}
                    label="Best Streak"
                    value={stats.longestStreak}
                    suffix=" days"
                />
                <div className="bg-gray-900/50 rounded-lg p-3 flex flex-col">
                    <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                        <TrendingUp size={14} />
                        Top Habit
                    </div>
                    <div className="text-lg font-bold text-white truncate">
                        {stats.streakHabit || 'None yet'}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WeeklySummary;

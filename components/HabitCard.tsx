import React, { useMemo } from 'react';
import { Entity, HabitMetadata, Relationship, RelationshipType, EntityKind } from '../types';
import { Flame, CheckCircle, TrendingUp, XCircle, Clock } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

interface HabitCardProps {
    habit: Entity;
    relationships: Relationship[];
    allEntities: Entity[];
}

const HabitCard: React.FC<HabitCardProps> = ({ habit, relationships, allEntities }) => {
    const meta = habit.metadata as HabitMetadata;
    const isGood = meta.habit_type !== 'BAD';
    const color = isGood ? '#22c55e' : '#ef4444'; // green-500 : red-500

    // --- 1. Calculate Sparkline Data (Last 14 Days) ---
    const sparklineData = useMemo(() => {
        const data = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 13; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            // Find activities linked to this habit on this date
            // We look for relationships where (to == habit.id AND type == FULFILLS)
            // Then check the 'from' entity (Activity) for start_time matching date
            let value = 0;

            const relevantRels = relationships.filter(r =>
                r.to === habit.id && r.type === RelationshipType.FULFILLS
            );

            // Check if any activity for this date exists
            const hit = relevantRels.some(r => {
                const activity = allEntities.find(e => e.id === r.from);
                if (!activity || !activity.start_time) return false;
                return activity.start_time.startsWith(dateStr);
            });

            if (isGood) {
                value = hit ? 1 : 0;
            } else {
                // For Bad habits, maybe track minutes? For now, binary 'did it' vs 'didn't'
                // Actually user wants "Time Spent" for bad habits usually.
                // Let's sum duration for bad habits
                let minutes = 0;
                relevantRels.forEach(r => {
                    const activity = allEntities.find(e => e.id === r.from);
                    if (activity && activity.start_time?.startsWith(dateStr)) {
                        minutes += activity.duration_minutes || 0;
                    }
                });
                value = minutes;
            }

            data.push({ date: dateStr, value });
        }
        return data;
    }, [habit, relationships, allEntities, isGood]);

    return (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 flex flex-col justify-between hover:bg-gray-800/80 transition-all hover:border-gray-600 group">

            {/* Header */}
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h3 className="text-white font-medium text-lg flex items-center gap-2">
                        {habit.title}
                        {isGood ? <CheckCircle size={16} className="text-green-500" /> : <XCircle size={16} className="text-red-500" />}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1 uppercase tracking-wider font-semibold">
                        {meta.frequency_goal}x / {meta.frequency_period}
                    </p>
                </div>

                {/* Streak Badge */}
                <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${isGood ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                    <Flame size={12} fill="currentColor" />
                    {meta.streak_current || 0}
                </div>
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-gray-900/50 rounded-lg p-2">
                    <div className="text-xs text-gray-500 mb-1">Total</div>
                    <div className="text-xl font-bold text-gray-200">
                        {isGood ? meta.total_completions || 0 : `${Math.round((meta.time_spent_minutes || 0) / 60)}h`}
                    </div>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-2">
                    <div className="text-xs text-gray-500 mb-1">Best Streak</div>
                    <div className={`text-xl font-bold ${isGood ? 'text-green-400' : 'text-orange-400'}`}>
                        {meta.streak_best || 0}
                    </div>
                </div>
            </div>

            {/* Sparkline Graph */}
            <div className="h-16 w-full mt-auto">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sparklineData}>
                        <Line
                            type="monotone"
                            dataKey="value"
                            stroke={color}
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false} // Clean rendering
                        />
                        {/* Hide Axis but keep domain dynamic */}
                        {/* For Bad habits (minutes), domain should be auto. For Good (0/1), domain [0,1] */}
                        <YAxis hide domain={isGood ? [0, 1] : ['auto', 'auto']} />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* Clean overlay for interaction hints could go here */}
        </div>
    );
};

export default HabitCard;

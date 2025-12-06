import React, { useMemo } from 'react';
import { Entity, EntityKind } from '../types';
import { Target } from 'lucide-react';

interface GoalProgressChartProps {
    entities: Entity[];
}

interface CircularProgressProps {
    progress: number;
    title: string;
}

const GoalProgressChart: React.FC<GoalProgressChartProps> = ({ entities }) => {
    const goals = useMemo(() => {
        return entities
            .filter(e => e.kind === EntityKind.GOAL && e.status !== 'ARCHIVED' && e.status !== 'COMPLETED')
            .map(e => ({
                id: e.id,
                title: e.title,
                progress: e.metadata?.progress_percent || 0
            }))
            .slice(0, 6);
    }, [entities]);

    if (goals.length === 0) {
        return null;
    }

    // Circular progress component
    const CircularProgress: React.FC<{ progress: number; title: string }> = ({ progress, title }) => {
        const radius = 32;
        const circumference = 2 * Math.PI * radius;
        const strokeDashoffset = circumference - (progress / 100) * circumference;

        return (
            <div className="flex flex-col items-center">
                <div className="relative w-20 h-20">
                    <svg className="w-20 h-20 transform -rotate-90" viewBox="0 0 80 80">
                        {/* Background circle */}
                        <circle
                            cx="40"
                            cy="40"
                            r={radius}
                            stroke="currentColor"
                            strokeWidth="6"
                            fill="transparent"
                            className="text-gray-700"
                        />
                        {/* Progress circle */}
                        <circle
                            cx="40"
                            cy="40"
                            r={radius}
                            stroke="currentColor"
                            strokeWidth="6"
                            fill="transparent"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            strokeLinecap="round"
                            className="text-indigo-500 transition-all duration-500"
                        />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-lg font-bold text-white">{Math.round(progress)}%</span>
                    </div>
                </div>
                <span className="text-xs text-gray-400 mt-2 text-center truncate max-w-[80px]">
                    {title}
                </span>
            </div>
        );
    };

    return (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-4">
                <Target size={18} className="text-indigo-400" />
                <h3 className="text-sm font-medium text-gray-300">Goal Progress</h3>
            </div>

            <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                {goals.map(goal => (
                    <CircularProgress key={goal.id} progress={goal.progress} title={goal.title} />
                ))}
            </div>
        </div>
    );
};

export default GoalProgressChart;

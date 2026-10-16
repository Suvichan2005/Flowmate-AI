import React, { useMemo } from 'react';
import { Entity, EntityKind } from '../types';
import { Target, ArrowUpRight } from 'lucide-react';
import { useStore } from '../store';
import { calculateProgress } from '../utils/progressCalculation';

interface GoalProgressChartProps {
    entities: Entity[];
    onSelectGoal?: (goalId: string) => void;
}

interface CircularProgressProps {
    id: string;
    progress: number;
    title: string;
    onClick?: () => void;
}

const GoalProgressChart: React.FC<GoalProgressChartProps> = ({ entities, onSelectGoal }) => {
    const { relationships, selectEntity } = useStore();
    const handleGoalClick = onSelectGoal || selectEntity;

    const goals = useMemo(() => {
        return entities
            .filter(e => e.kind === EntityKind.GOAL && e.status !== 'ARCHIVED')
            .map(e => ({
                id: e.id,
                title: e.title,
                progress: calculateProgress(e, entities, relationships)
            }))
            .slice(0, 6);
    }, [entities, relationships]);

    if (goals.length === 0) {
        return null;
    }

    // Interactive circular progress component
    const CircularProgress: React.FC<CircularProgressProps> = ({ id, progress, title, onClick }) => {
        const radius = 32;
        const circumference = 2 * Math.PI * radius;
        const strokeDashoffset = circumference - (Math.min(100, Math.max(0, progress)) / 100) * circumference;

        return (
            <div
                role="button"
                tabIndex={0}
                data-testid={`goal-circle-${id}`}
                onClick={onClick}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onClick?.();
                    }
                }}
                className="flex flex-col items-center p-2 rounded-xl hover:bg-slate-800/60 transition-all cursor-pointer group border border-transparent hover:border-indigo-500/30 active:scale-95"
                title={`Click to inspect ${title}`}
                aria-label={`Goal: ${title}, ${Math.round(progress)}% complete`}
            >
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
                            className="text-slate-800 group-hover:text-slate-700 transition-colors"
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
                            className="text-indigo-500 group-hover:text-indigo-400 transition-all duration-500"
                        />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-lg font-bold text-white group-hover:text-indigo-200 transition-colors font-mono">
                            {Math.round(progress)}%
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-1 mt-2 max-w-[90px]">
                    <span className="text-xs text-slate-300 group-hover:text-white transition-colors text-center truncate font-medium">
                        {title}
                    </span>
                    <ArrowUpRight size={10} className="text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
            </div>
        );
    };

    return (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 shadow-sm" data-testid="goal-progress-chart-card">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Target size={18} className="text-indigo-400" />
                    <h3 className="text-sm font-medium text-slate-200">Goal Progress</h3>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">
                    Click to inspect workstream & schedule
                </span>
            </div>

            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {goals.map(goal => (
                    <CircularProgress
                        key={goal.id}
                        id={goal.id}
                        progress={goal.progress}
                        title={goal.title}
                        onClick={() => handleGoalClick(goal.id)}
                    />
                ))}
            </div>
        </div>
    );
};

export default GoalProgressChart;

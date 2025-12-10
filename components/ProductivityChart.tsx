import React, { useMemo } from 'react';
import { Entity } from '../types';
import { getActivitySummary } from '../utils/streakCalculation';
import { Zap, Coffee, Gamepad2, Info } from 'lucide-react';

interface ProductivityChartProps {
    entities: Entity[];
}

const ProductivityChart: React.FC<ProductivityChartProps> = ({ entities }) => {
    const summary = useMemo(() => getActivitySummary(entities), [entities]);

    const { productiveMinutes, neutralMinutes, unproductiveMinutes, totalMinutes } = summary;

    if (totalMinutes === 0) return null;

    const prodPercent = Math.round((productiveMinutes / totalMinutes) * 100);
    const neutralPercent = Math.round((neutralMinutes / totalMinutes) * 100);
    const unprodPercent = Math.round((unproductiveMinutes / totalMinutes) * 100);

    const formatHours = (mins: number) => (mins / 60).toFixed(1) + 'h';

    return (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                <Zap size={16} className="text-teal-400" />
                Productivity Breakdown
            </h3>

            {/* Progress Bar */}
            <div className="flex h-3 w-full rounded-full overflow-hidden bg-gray-700 mb-4">
                <div style={{ width: `${prodPercent}%` }} className="bg-teal-500 transition-all duration-500" />
                <div style={{ width: `${neutralPercent}%` }} className="bg-gray-500 transition-all duration-500" />
                <div style={{ width: `${unprodPercent}%` }} className="bg-rose-500 transition-all duration-500" />
            </div>

            {/* Legend / Stats */}
            <div className="grid grid-cols-3 gap-2">
                {/* Productive */}
                <div className="bg-gray-900/50 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-2 h-2 rounded-full bg-teal-500" />
                        <span className="text-xs text-teal-300">Productive</span>
                    </div>
                    <div className="text-lg font-bold text-white">{formatHours(productiveMinutes)}</div>
                    <div className="text-xs text-gray-500">{prodPercent}%</div>
                </div>

                {/* Neutral */}
                <div className="bg-gray-900/50 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-2 h-2 rounded-full bg-gray-500" />
                        <span className="text-xs text-gray-300">Neutral</span>
                    </div>
                    <div className="text-lg font-bold text-white">{formatHours(neutralMinutes)}</div>
                    <div className="text-xs text-gray-500">{neutralPercent}%</div>
                </div>

                {/* Unproductive */}
                <div className="bg-gray-900/50 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-2 h-2 rounded-full bg-rose-500" />
                        <span className="text-xs text-rose-300">Downtime</span>
                    </div>
                    <div className="text-lg font-bold text-white">{formatHours(unproductiveMinutes)}</div>
                    <div className="text-xs text-gray-500">{unprodPercent}%</div>
                </div>
            </div>
        </div>
    );
};

export default ProductivityChart;

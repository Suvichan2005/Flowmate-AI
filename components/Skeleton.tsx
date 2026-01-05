import React from 'react';

/**
 * Skeleton Loading Components
 * 
 * Provides smooth loading placeholders for better perceived performance.
 * Uses CSS animations that are GPU-accelerated.
 */

interface SkeletonProps {
    className?: string;
    width?: string | number;
    height?: string | number;
    rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
    animate?: boolean;
}

/**
 * Base skeleton component with shimmer animation
 */
export const Skeleton: React.FC<SkeletonProps> = ({
    className = '',
    width,
    height,
    rounded = 'md',
    animate = true,
}) => {
    const roundedClasses = {
        none: '',
        sm: 'rounded-sm',
        md: 'rounded-md',
        lg: 'rounded-lg',
        full: 'rounded-full',
    };

    const style: React.CSSProperties = {};
    if (width) style.width = typeof width === 'number' ? `${width}px` : width;
    if (height) style.height = typeof height === 'number' ? `${height}px` : height;

    return (
        <div
            className={`
                bg-zinc-800/50 
                ${roundedClasses[rounded]} 
                ${animate ? 'animate-pulse' : ''} 
                ${className}
            `}
            style={style}
            aria-hidden="true"
        />
    );
};

/**
 * Text line skeleton
 */
export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({
    lines = 1,
    className = '',
}) => (
    <div className={`space-y-2 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
            <Skeleton
                key={i}
                height={16}
                width={i === lines - 1 && lines > 1 ? '75%' : '100%'}
                rounded="sm"
            />
        ))}
    </div>
);

/**
 * Card skeleton for entity cards
 */
export const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`bg-zinc-900/50 rounded-lg p-4 border border-zinc-800 ${className}`}>
        <div className="flex items-start gap-3">
            <Skeleton width={40} height={40} rounded="lg" />
            <div className="flex-1 space-y-2">
                <Skeleton height={20} width="60%" />
                <Skeleton height={14} width="40%" />
            </div>
        </div>
        <div className="mt-3 space-y-2">
            <Skeleton height={12} width="100%" />
            <Skeleton height={12} width="85%" />
        </div>
    </div>
);

/**
 * List item skeleton
 */
export const SkeletonListItem: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`flex items-center gap-3 p-3 ${className}`}>
        <Skeleton width={24} height={24} rounded="full" />
        <div className="flex-1">
            <Skeleton height={16} width="70%" />
        </div>
        <Skeleton width={60} height={20} rounded="full" />
    </div>
);

/**
 * Dashboard skeleton with multiple cards
 */
export const SkeletonDashboard: React.FC = () => (
    <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
            <Skeleton height={32} width={200} />
            <Skeleton height={36} width={120} rounded="lg" />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
                    <Skeleton height={14} width="50%" className="mb-2" />
                    <Skeleton height={28} width="70%" />
                </div>
            ))}
        </div>

        {/* Content grid */}
        <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
                <Skeleton height={24} width={150} />
                {[1, 2, 3].map((i) => (
                    <SkeletonCard key={i} />
                ))}
            </div>
            <div className="space-y-4">
                <Skeleton height={24} width={150} />
                {[1, 2, 3].map((i) => (
                    <SkeletonCard key={i} />
                ))}
            </div>
        </div>
    </div>
);

/**
 * Graph view skeleton
 */
export const SkeletonGraph: React.FC = () => (
    <div className="relative w-full h-full flex items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-center">
            {/* Simulated nodes */}
            {[
                { x: '30%', y: '40%', size: 60 },
                { x: '50%', y: '30%', size: 80 },
                { x: '70%', y: '45%', size: 50 },
                { x: '40%', y: '60%', size: 45 },
                { x: '60%', y: '65%', size: 55 },
            ].map((node, i) => (
                <div
                    key={i}
                    className="absolute animate-pulse"
                    style={{
                        left: node.x,
                        top: node.y,
                        transform: 'translate(-50%, -50%)',
                    }}
                >
                    <Skeleton width={node.size} height={node.size} rounded="full" />
                </div>
            ))}
        </div>
        <div className="text-zinc-500 text-sm">Loading graph...</div>
    </div>
);

/**
 * Calendar skeleton
 */
export const SkeletonCalendar: React.FC = () => (
    <div className="p-4 space-y-4">
        {/* Month header */}
        <div className="flex items-center justify-between">
            <Skeleton height={24} width={150} />
            <div className="flex gap-2">
                <Skeleton width={32} height={32} rounded="lg" />
                <Skeleton width={32} height={32} rounded="lg" />
            </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((_, i) => (
                <Skeleton key={i} height={24} rounded="sm" className="opacity-50" />
            ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }).map((_, i) => (
                <Skeleton key={i} height={60} rounded="md" />
            ))}
        </div>
    </div>
);

/**
 * Chat skeleton
 */
export const SkeletonChat: React.FC = () => (
    <div className="flex flex-col h-full">
        <div className="flex-1 p-4 space-y-4 overflow-hidden">
            {/* Messages */}
            {[
                { isUser: true, width: '60%' },
                { isUser: false, width: '75%' },
                { isUser: true, width: '45%' },
                { isUser: false, width: '80%' },
            ].map((msg, i) => (
                <div
                    key={i}
                    className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
                >
                    <div
                        className={`
                            max-w-[80%] p-3 rounded-lg
                            ${msg.isUser ? 'bg-violet-600/20' : 'bg-zinc-800/50'}
                        `}
                        style={{ width: msg.width }}
                    >
                        <SkeletonText lines={2} />
                    </div>
                </div>
            ))}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-zinc-800">
            <Skeleton height={48} rounded="lg" />
        </div>
    </div>
);

/**
 * Entity detail panel skeleton
 */
export const SkeletonEntityDetail: React.FC = () => (
    <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
            <Skeleton width={48} height={48} rounded="lg" />
            <div className="flex-1 space-y-2">
                <Skeleton height={28} width="80%" />
                <Skeleton height={18} width="40%" />
            </div>
        </div>

        {/* Status badges */}
        <div className="flex gap-2">
            <Skeleton width={80} height={24} rounded="full" />
            <Skeleton width={60} height={24} rounded="full" />
            <Skeleton width={70} height={24} rounded="full" />
        </div>

        {/* Description */}
        <div className="space-y-2">
            <Skeleton height={20} width={100} />
            <SkeletonText lines={3} />
        </div>

        {/* Metadata */}
        <div className="space-y-3">
            {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2">
                    <Skeleton width={20} height={20} rounded="sm" />
                    <Skeleton height={16} width={120} />
                </div>
            ))}
        </div>
    </div>
);

export default Skeleton;

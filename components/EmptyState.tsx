import React from 'react';
import { 
    Inbox, 
    Calendar, 
    Target, 
    FileText, 
    Utensils, 
    CheckSquare,
    BarChart3,
    Network,
    Plus,
    LucideIcon
} from 'lucide-react';

interface EmptyStateProps {
    /** Type of empty state to show */
    type?: 'default' | 'tasks' | 'goals' | 'events' | 'notes' | 'food' | 'habits' | 'analytics' | 'graph';
    /** Custom title */
    title?: string;
    /** Custom description */
    description?: string;
    /** Custom icon */
    icon?: LucideIcon;
    /** Action button text */
    actionText?: string;
    /** Action callback */
    onAction?: () => void;
    /** Additional CSS classes */
    className?: string;
}

interface EmptyStateConfig {
    icon: LucideIcon;
    title: string;
    description: string;
    actionText?: string;
}

const emptyStateConfigs: Record<string, EmptyStateConfig> = {
    default: {
        icon: Inbox,
        title: 'Nothing here yet',
        description: 'Start by adding some items to get going.',
        actionText: 'Add Item',
    },
    tasks: {
        icon: CheckSquare,
        title: 'No tasks yet',
        description: 'Create your first task to start tracking your work.',
        actionText: 'Create Task',
    },
    goals: {
        icon: Target,
        title: 'No goals set',
        description: 'Define your goals and track progress towards achieving them.',
        actionText: 'Set a Goal',
    },
    events: {
        icon: Calendar,
        title: 'No events scheduled',
        description: 'Schedule events to keep your calendar organized.',
        actionText: 'Schedule Event',
    },
    notes: {
        icon: FileText,
        title: 'No notes yet',
        description: 'Capture your thoughts and ideas here.',
        actionText: 'Create Note',
    },
    food: {
        icon: Utensils,
        title: 'No food logged',
        description: 'Track your meals to monitor your nutrition.',
        actionText: 'Log Food',
    },
    habits: {
        icon: CheckSquare,
        title: 'No habits tracked',
        description: 'Build good habits by tracking them daily.',
        actionText: 'Add Habit',
    },
    analytics: {
        icon: BarChart3,
        title: 'Not enough data',
        description: 'Use the app more to see detailed analytics and insights.',
    },
    graph: {
        icon: Network,
        title: 'Your knowledge graph is empty',
        description: 'Start adding tasks, notes, and goals to build your personal knowledge graph.',
        actionText: 'Get Started',
    },
};

/**
 * Empty State Component
 * 
 * Displays a friendly message when there's no data to show.
 * Encourages users to take action.
 */
const EmptyState: React.FC<EmptyStateProps> = ({
    type = 'default',
    title,
    description,
    icon: CustomIcon,
    actionText,
    onAction,
    className = '',
}) => {
    const config = emptyStateConfigs[type] || emptyStateConfigs.default;
    const Icon = CustomIcon || config.icon;
    const displayTitle = title || config.title;
    const displayDescription = description || config.description;
    const displayActionText = actionText || config.actionText;

    return (
        <div
            className={`
                flex flex-col items-center justify-center 
                py-12 px-6 text-center
                ${className}
            `}
            role="status"
            aria-label={displayTitle}
        >
            {/* Icon */}
            <div className="mb-4 p-4 rounded-full bg-zinc-800/50">
                <Icon className="w-12 h-12 text-zinc-500" strokeWidth={1.5} />
            </div>

            {/* Title */}
            <h3 className="text-lg font-medium text-zinc-300 mb-2">
                {displayTitle}
            </h3>

            {/* Description */}
            <p className="text-sm text-zinc-500 max-w-sm mb-6">
                {displayDescription}
            </p>

            {/* Action Button */}
            {displayActionText && onAction && (
                <button
                    onClick={onAction}
                    className="
                        flex items-center gap-2 px-4 py-2
                        bg-violet-600 hover:bg-violet-500
                        text-white text-sm font-medium
                        rounded-lg transition-colors
                        focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-900
                    "
                >
                    <Plus className="w-4 h-4" />
                    {displayActionText}
                </button>
            )}
        </div>
    );
};

/**
 * Inline empty state for smaller areas
 */
export const EmptyStateInline: React.FC<{
    message: string;
    className?: string;
}> = ({ message, className = '' }) => (
    <div
        className={`
            flex items-center justify-center gap-2
            py-4 px-3 text-sm text-zinc-500
            ${className}
        `}
    >
        <Inbox className="w-4 h-4" />
        <span>{message}</span>
    </div>
);

/**
 * Error state component
 */
export const ErrorState: React.FC<{
    title?: string;
    message?: string;
    onRetry?: () => void;
    className?: string;
}> = ({
    title = 'Something went wrong',
    message = 'We encountered an error loading this content.',
    onRetry,
    className = '',
}) => (
    <div
        className={`
            flex flex-col items-center justify-center
            py-12 px-6 text-center
            ${className}
        `}
        role="alert"
    >
        <div className="mb-4 p-4 rounded-full bg-red-900/20">
            <svg
                className="w-12 h-12 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
            </svg>
        </div>

        <h3 className="text-lg font-medium text-zinc-300 mb-2">
            {title}
        </h3>

        <p className="text-sm text-zinc-500 max-w-sm mb-6">
            {message}
        </p>

        {onRetry && (
            <button
                onClick={onRetry}
                className="
                    px-4 py-2
                    bg-zinc-800 hover:bg-zinc-700
                    text-zinc-300 text-sm font-medium
                    rounded-lg transition-colors
                    focus:outline-none focus:ring-2 focus:ring-zinc-500
                "
            >
                Try Again
            </button>
        )}
    </div>
);

/**
 * Loading state with spinner
 */
export const LoadingState: React.FC<{
    message?: string;
    className?: string;
}> = ({ message = 'Loading...', className = '' }) => (
    <div
        className={`
            flex flex-col items-center justify-center
            py-12 px-6 text-center
            ${className}
        `}
        role="status"
        aria-live="polite"
    >
        <div className="mb-4">
            <svg
                className="w-10 h-10 text-violet-500 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
            >
                <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                />
                <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
            </svg>
        </div>
        <p className="text-sm text-zinc-500">{message}</p>
    </div>
);

export default EmptyState;

/**
 * Accessibility Utilities
 * 
 * Provides helpers for WCAG compliance and keyboard navigation.
 */

/**
 * Handles keyboard interaction for clickable elements
 * Allows Enter and Space to trigger clicks
 */
export const handleKeyboardClick = (
    event: React.KeyboardEvent,
    callback: () => void
): void => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        callback();
    }
};

/**
 * Creates keyboard event handler for interactive elements
 */
export const onKeyboardSelect = (callback: () => void) => ({
    onKeyDown: (e: React.KeyboardEvent) => handleKeyboardClick(e, callback),
    tabIndex: 0,
    role: 'button' as const,
});

/**
 * Announces a message to screen readers via ARIA live region
 */
export const announceToScreenReader = (message: string, priority: 'polite' | 'assertive' = 'polite'): void => {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', priority);
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;

    document.body.appendChild(announcement);

    // Remove after announcement is made
    setTimeout(() => {
        document.body.removeChild(announcement);
    }, 1000);
};

/**
 * Creates props for a visually hidden but screen-reader accessible element
 */
export const srOnly = {
    className: 'sr-only',
    style: {
        position: 'absolute' as const,
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap' as const,
        border: 0,
    },
};

/**
 * Focus trap for modals - keeps focus within the modal
 */
export const useFocusTrap = (containerRef: React.RefObject<HTMLElement>, isActive: boolean) => {
    React.useEffect(() => {
        if (!isActive || !containerRef.current) return;

        const container = containerRef.current;
        const focusableElements = container.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        const handleTabKey = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;

            if (e.shiftKey) {
                if (document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement?.focus();
                }
            } else {
                if (document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement?.focus();
                }
            }
        };

        // Focus first element when trap activates
        firstElement?.focus();

        container.addEventListener('keydown', handleTabKey);
        return () => container.removeEventListener('keydown', handleTabKey);
    }, [containerRef, isActive]);
};

/**
 * Skip link component for keyboard users to skip navigation
 */
export const SkipLink: React.FC<{ targetId: string; children: React.ReactNode }> = ({ targetId, children }) => (
    <a
        href={`#${targetId}`}
        className="
            sr-only focus:not-sr-only
            focus:absolute focus:top-4 focus:left-4 focus:z-50
            focus:px-4 focus:py-2 focus:bg-violet-600 focus:text-white
            focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400
        "
    >
        {children}
    </a>
);

/**
 * Common ARIA labels for entity kinds
 */
export const entityKindLabels: Record<string, string> = {
    TASK: 'Task',
    GOAL: 'Goal',
    PROJECT: 'Project',
    EVENT: 'Event',
    NOTE: 'Note',
    HABIT: 'Habit',
    CATEGORY: 'Category',
    TAG: 'Tag',
    CONTEXT: 'Context',
    MINI_STREAK: 'Mini Streak',
    FOOD_LOG: 'Food Log',
    RESOURCE: 'Resource',
    FINANCE: 'Finance Entry',
};

/**
 * Common ARIA labels for entity statuses
 */
export const entityStatusLabels: Record<string, string> = {
    ACTIVE: 'Active',
    COMPLETED: 'Completed',
    ARCHIVED: 'Archived',
    PAUSED: 'Paused',
    TEMPLATE: 'Template',
};

/**
 * Get accessible label for an entity
 */
export const getEntityAriaLabel = (entity: { title: string; kind: string; status: string }): string => {
    const kindLabel = entityKindLabels[entity.kind] || entity.kind;
    const statusLabel = entityStatusLabels[entity.status] || entity.status;
    return `${kindLabel}: ${entity.title}. Status: ${statusLabel}`;
};

// Import React for the effect
import React from 'react';

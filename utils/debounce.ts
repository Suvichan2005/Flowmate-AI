/**
 * Debounce and Throttle Utilities
 * 
 * Provides utilities to prevent rapid-fire function execution
 * which can cause performance issues and rate limiting problems.
 */

/**
 * Creates a debounced function that delays invoking the provided function
 * until after `wait` milliseconds have elapsed since the last time it was invoked.
 * 
 * @param fn - The function to debounce
 * @param wait - The number of milliseconds to delay
 * @returns A debounced version of the function
 */
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    wait: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const debounced = (...args: Parameters<T>) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            fn(...args);
            timeoutId = null;
        }, wait);
    };

    debounced.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    return debounced;
}

/**
 * Creates a throttled function that only invokes the provided function
 * at most once per every `wait` milliseconds.
 * 
 * @param fn - The function to throttle
 * @param wait - The number of milliseconds to throttle
 * @returns A throttled version of the function
 */
export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    wait: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
    let lastTime = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const throttled = (...args: Parameters<T>) => {
        const now = Date.now();
        const remaining = wait - (now - lastTime);

        if (remaining <= 0) {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            lastTime = now;
            fn(...args);
        } else if (!timeoutId) {
            timeoutId = setTimeout(() => {
                lastTime = Date.now();
                timeoutId = null;
                fn(...args);
            }, remaining);
        }
    };

    throttled.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    return throttled;
}

/**
 * Creates a function that prevents double-clicks by ignoring subsequent calls
 * within the specified time window.
 * 
 * @param fn - The function to guard
 * @param wait - The lockout period in milliseconds (default: 1000ms)
 * @returns A guarded version of the function
 */
export function preventDoubleClick<T extends (...args: any[]) => any>(
    fn: T,
    wait: number = 1000
): (...args: Parameters<T>) => void {
    let isLocked = false;

    return (...args: Parameters<T>) => {
        if (isLocked) return;

        isLocked = true;
        fn(...args);

        setTimeout(() => {
            isLocked = false;
        }, wait);
    };
}

/**
 * React hook for creating a debounced callback
 * 
 * Usage:
 * const debouncedSave = useDebouncedCallback(saveData, 500);
 */
export function createDebouncedCallback<T extends (...args: any[]) => any>(
    fn: T,
    wait: number
): ((...args: Parameters<T>) => void) & { cancel: () => void; flush: () => void } {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pendingArgs: Parameters<T> | null = null;

    const debounced = (...args: Parameters<T>) => {
        pendingArgs = args;
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            if (pendingArgs) {
                fn(...pendingArgs);
            }
            timeoutId = null;
            pendingArgs = null;
        }, wait);
    };

    debounced.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        pendingArgs = null;
    };

    debounced.flush = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (pendingArgs) {
            fn(...pendingArgs);
            pendingArgs = null;
        }
    };

    return debounced;
}

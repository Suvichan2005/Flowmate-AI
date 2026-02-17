// Haptics Service
// Web-only haptic feedback using the Vibration API

type ImpactStyle = 'light' | 'medium' | 'heavy';

/**
 * Web-based haptic feedback service.
 * Uses the Vibration API on supported mobile browsers.
 * Silently no-ops on unsupported browsers.
 */
export const haptics = {
    async impact(style: ImpactStyle = 'medium'): Promise<void> {
        const durations: Record<ImpactStyle, number> = { light: 10, medium: 20, heavy: 40 };
        navigator.vibrate?.(durations[style]);
    },

    async success(): Promise<void> {
        navigator.vibrate?.([10, 30, 10]);
    },

    async warning(): Promise<void> {
        navigator.vibrate?.([30, 20, 30]);
    },

    async error(): Promise<void> {
        navigator.vibrate?.([50, 30, 50]);
    },

    async selectionClick(): Promise<void> {
        navigator.vibrate?.(5);
    },
};

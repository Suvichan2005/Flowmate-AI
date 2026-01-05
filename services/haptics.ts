// Haptics Service
// Native haptic feedback using Capacitor Haptics plugin

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

/**
 * Cross-platform haptic feedback service.
 * On native platforms (Android/iOS), triggers device haptics.
 * On web, silently fails (no-op).
 */
export const haptics = {
    /**
     * Light/medium/heavy impact feedback
     */
    async impact(style: ImpactStyle = ImpactStyle.Medium): Promise<void> {
        if (Capacitor.isNativePlatform()) {
            try {
                await Haptics.impact({ style });
            } catch (err) {
                console.warn('[Haptics] Impact failed:', err);
            }
        }
    },

    /**
     * Success notification haptic (task complete, streak milestone)
     */
    async success(): Promise<void> {
        if (Capacitor.isNativePlatform()) {
            try {
                await Haptics.notification({ type: NotificationType.Success });
            } catch (err) {
                console.warn('[Haptics] Success notification failed:', err);
            }
        }
    },

    /**
     * Warning notification haptic (deadline approaching)
     */
    async warning(): Promise<void> {
        if (Capacitor.isNativePlatform()) {
            try {
                await Haptics.notification({ type: NotificationType.Warning });
            } catch (err) {
                console.warn('[Haptics] Warning notification failed:', err);
            }
        }
    },

    /**
     * Error notification haptic (sync failed, validation error)
     */
    async error(): Promise<void> {
        if (Capacitor.isNativePlatform()) {
            try {
                await Haptics.notification({ type: NotificationType.Error });
            } catch (err) {
                console.warn('[Haptics] Error notification failed:', err);
            }
        }
    },

    /**
     * Light tap for button presses
     */
    async selectionClick(): Promise<void> {
        if (Capacitor.isNativePlatform()) {
            try {
                await Haptics.selectionStart();
                await Haptics.selectionEnd();
            } catch (err) {
                console.warn('[Haptics] Selection click failed:', err);
            }
        }
    }
};

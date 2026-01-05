// Local Notifications Service
// Native local notifications using Capacitor LocalNotifications plugin

import { LocalNotifications, ScheduleOptions, PendingLocalNotificationSchema } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

export interface FlowmateNotification {
    id: number;
    title: string;
    body: string;
    scheduleAt?: Date;
    extra?: Record<string, any>;
}

/**
 * Local notifications service for native platforms.
 * Handles permission requests, scheduling, and notification actions.
 */
export const notifications = {
    /**
     * Check and request notification permissions
     */
    async requestPermission(): Promise<boolean> {
        if (!Capacitor.isNativePlatform()) {
            console.log('[Notifications] Web platform, skipping permission request');
            return false;
        }

        try {
            const status = await LocalNotifications.checkPermissions();

            if (status.display === 'granted') {
                return true;
            }

            if (status.display === 'prompt' || status.display === 'prompt-with-rationale') {
                const result = await LocalNotifications.requestPermissions();
                return result.display === 'granted';
            }

            return false;
        } catch (err) {
            console.error('[Notifications] Permission request failed:', err);
            return false;
        }
    },

    /**
     * Schedule a local notification
     */
    async schedule(notification: FlowmateNotification): Promise<boolean> {
        if (!Capacitor.isNativePlatform()) {
            console.log('[Notifications] Web platform, skipping notification');
            return false;
        }

        try {
            const scheduleOptions: ScheduleOptions = {
                notifications: [
                    {
                        id: notification.id,
                        title: notification.title,
                        body: notification.body,
                        schedule: notification.scheduleAt ? { at: notification.scheduleAt } : undefined,
                        extra: notification.extra,
                        sound: 'default',
                        smallIcon: 'ic_stat_icon_config_sample',
                        iconColor: '#6366f1'
                    }
                ]
            };

            await LocalNotifications.schedule(scheduleOptions);
            console.log('[Notifications] Scheduled:', notification.title);
            return true;
        } catch (err) {
            console.error('[Notifications] Schedule failed:', err);
            return false;
        }
    },

    /**
     * Cancel a scheduled notification
     */
    async cancel(id: number): Promise<void> {
        if (!Capacitor.isNativePlatform()) return;

        try {
            await LocalNotifications.cancel({ notifications: [{ id }] });
            console.log('[Notifications] Cancelled:', id);
        } catch (err) {
            console.error('[Notifications] Cancel failed:', err);
        }
    },

    /**
     * Cancel all scheduled notifications
     */
    async cancelAll(): Promise<void> {
        if (!Capacitor.isNativePlatform()) return;

        try {
            const pending = await LocalNotifications.getPending();
            if (pending.notifications.length > 0) {
                await LocalNotifications.cancel({ notifications: pending.notifications });
                console.log('[Notifications] Cancelled all:', pending.notifications.length);
            }
        } catch (err) {
            console.error('[Notifications] Cancel all failed:', err);
        }
    },

    /**
     * Get all pending notifications
     */
    async getPending(): Promise<PendingLocalNotificationSchema[]> {
        if (!Capacitor.isNativePlatform()) return [];

        try {
            const result = await LocalNotifications.getPending();
            return result.notifications;
        } catch (err) {
            console.error('[Notifications] Get pending failed:', err);
            return [];
        }
    },

    /**
     * Schedule upcoming event reminder (15 min before)
     */
    async scheduleEventReminder(
        eventId: string,
        eventTitle: string,
        eventTime: Date
    ): Promise<boolean> {
        const reminderTime = new Date(eventTime.getTime() - 15 * 60 * 1000); // 15 min before

        // Don't schedule if already passed
        if (reminderTime <= new Date()) {
            return false;
        }

        return this.schedule({
            id: hashStringToInt(eventId),
            title: 'Upcoming Event',
            body: `${eventTitle} in 15 minutes`,
            scheduleAt: reminderTime,
            extra: { eventId, type: 'event_reminder' }
        });
    },

    /**
     * Schedule streak at risk notification (end of day if no activity)
     */
    async scheduleStreakReminder(streakName: string, streakId: string): Promise<boolean> {
        const today = new Date();
        today.setHours(20, 0, 0, 0); // 8 PM

        // Don't schedule if already passed
        if (today <= new Date()) {
            return false;
        }

        return this.schedule({
            id: hashStringToInt(streakId),
            title: 'Streak at Risk! 🔥',
            body: `Don't forget to complete "${streakName}" today`,
            scheduleAt: today,
            extra: { streakId, type: 'streak_reminder' }
        });
    },

    /**
     * Register notification action handlers
     */
    async registerListeners(
        onAction: (extra: Record<string, any>, actionId: string) => void
    ): Promise<void> {
        if (!Capacitor.isNativePlatform()) return;

        await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
            console.log('[Notifications] Action performed:', event.actionId, event.notification.extra);
            onAction(event.notification.extra || {}, event.actionId);
        });
    }
};

/**
 * Convert string to a consistent integer for notification IDs
 */
function hashStringToInt(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
}

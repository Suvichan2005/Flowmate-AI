// Notifications Service
// Web-only notifications using the Notification API + setTimeout scheduling

export interface FlowmateNotification {
    id: number;
    title: string;
    body: string;
    scheduleAt?: Date;
    extra?: Record<string, any>;
}

const scheduledTimers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Web Notifications service using the browser Notification API.
 * Supports permission requests, immediate + scheduled notifications.
 */
export const notifications = {
    async requestPermission(): Promise<boolean> {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') return true;
        if (Notification.permission === 'denied') return false;
        const result = await Notification.requestPermission();
        return result === 'granted';
    },

    async schedule(notification: FlowmateNotification): Promise<boolean> {
        if (!('Notification' in window) || Notification.permission !== 'granted') return false;

        const show = () => {
            new Notification(notification.title, {
                body: notification.body,
                icon: '/manifest.json',
                tag: String(notification.id),
                data: notification.extra,
            });
        };

        if (notification.scheduleAt) {
            const delay = notification.scheduleAt.getTime() - Date.now();
            if (delay <= 0) return false;
            this.cancel(notification.id);
            scheduledTimers.set(notification.id, setTimeout(show, delay));
        } else {
            show();
        }

        return true;
    },

    async cancel(id: number): Promise<void> {
        const timer = scheduledTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            scheduledTimers.delete(id);
        }
    },

    async cancelAll(): Promise<void> {
        for (const [id, timer] of scheduledTimers) {
            clearTimeout(timer);
        }
        scheduledTimers.clear();
    },

    async getPending(): Promise<{ id: number }[]> {
        return Array.from(scheduledTimers.keys()).map(id => ({ id }));
    },

    async scheduleEventReminder(
        eventId: string,
        eventTitle: string,
        eventTime: Date
    ): Promise<boolean> {
        const reminderTime = new Date(eventTime.getTime() - 15 * 60 * 1000);
        if (reminderTime <= new Date()) return false;

        return this.schedule({
            id: hashStringToInt(eventId),
            title: 'Upcoming Event',
            body: `${eventTitle} in 15 minutes`,
            scheduleAt: reminderTime,
            extra: { eventId, type: 'event_reminder' },
        });
    },

    async scheduleStreakReminder(streakName: string, streakId: string): Promise<boolean> {
        const today = new Date();
        today.setHours(20, 0, 0, 0);
        if (today <= new Date()) return false;

        return this.schedule({
            id: hashStringToInt(streakId),
            title: 'Streak at Risk! 🔥',
            body: `Don't forget to complete "${streakName}" today`,
            scheduleAt: today,
            extra: { streakId, type: 'streak_reminder' },
        });
    },

    async registerListeners(
        onAction: (extra: Record<string, any>, actionId: string) => void
    ): Promise<void> {
        // Web notifications don't support action listeners in the same way,
        // but we can listen for clicks via service worker in the future
    },
};

function hashStringToInt(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

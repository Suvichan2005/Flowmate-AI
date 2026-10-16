/**
 * Flowmate Notifications Service (P1-08)
 *
 * Facade bridging application callers to the active Platform Notification Adapter.
 * Pure delegation to getPlatform().notifications, keeping zero-any invariants.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { getPlatform } from './platform/registry';
import { PlatformNotificationPayload } from './platform/ports';

export interface FlowmateNotification {
  id: number;
  title: string;
  body: string;
  scheduleAt?: Date;
  extra?: Record<string, unknown>;
}

export const notifications = {
  async requestPermission(): Promise<boolean> {
    return getPlatform().notifications.requestPermission();
  },

  async schedule(notification: FlowmateNotification): Promise<boolean> {
    const payload: PlatformNotificationPayload = {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      scheduledAt: notification.scheduleAt,
      tag: String(notification.id),
      extra: notification.extra,
    };
    return getPlatform().notifications.schedule(payload);
  },

  async cancel(id: number): Promise<void> {
    return getPlatform().notifications.cancel(id);
  },

  async cancelAll(): Promise<void> {
    return getPlatform().notifications.cancelAll();
  },

  async getPending(): Promise<{ id: number }[]> {
    if (getPlatform().notifications.getPending) {
      const pending = await getPlatform().notifications.getPending!();
      return pending.map(p => ({ id: Number(p.id) }));
    }
    return [];
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
    _onAction: (extra: Record<string, unknown>, actionId: string) => void
  ): Promise<void> {
    // Web notifications click handling via SW where supported
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

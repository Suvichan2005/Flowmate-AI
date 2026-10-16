/**
 * Flowmate Web Platform — Notification Adapter (P1-08)
 *
 * Implements NotificationPort using HTML5 Notifications API and timer scheduling.
 * Encapsulates all browser/DOM notification concerns away from Flowmate Core.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import {
  NotificationPort,
  PlatformNotificationPayload,
  PlatformPermissionState,
} from '../ports';

export class WebNotificationAdapter implements NotificationPort {
  private scheduledTimers = new Map<string | number, ReturnType<typeof setTimeout>>();

  async checkPermission(): Promise<PlatformPermissionState> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    const perm = Notification.permission;
    if (perm === 'granted' || perm === 'denied' || perm === 'default') {
      return perm === 'default' ? 'prompt' : perm;
    }
    return 'prompt';
  }

  async requestPermission(): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;

    try {
      const result = await Notification.requestPermission();
      return result === 'granted';
    } catch {
      return false;
    }
  }

  async schedule(notification: PlatformNotificationPayload): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false;
    }
    if (Notification.permission !== 'granted') {
      return false;
    }

    const show = (): void => {
      new Notification(notification.title, {
        body: notification.body,
        icon: '/manifest.json',
        tag: notification.tag ?? String(notification.id),
        data: notification.extra,
      });
    };

    if (notification.scheduledAt) {
      const scheduleTime =
        typeof notification.scheduledAt === 'string'
          ? new Date(notification.scheduledAt).getTime()
          : notification.scheduledAt.getTime();

      const delay = scheduleTime - Date.now();
      if (delay <= 0) {
        show();
        return true;
      }

      await this.cancel(notification.id);
      this.scheduledTimers.set(
        notification.id,
        setTimeout(() => {
          this.scheduledTimers.delete(notification.id);
          show();
        }, delay)
      );
    } else {
      show();
    }

    return true;
  }

  async cancel(id: string | number): Promise<void> {
    const timer = this.scheduledTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.scheduledTimers.delete(id);
    }
  }

  async cancelAll(): Promise<void> {
    for (const [, timer] of this.scheduledTimers) {
      clearTimeout(timer);
    }
    this.scheduledTimers.clear();
  }

  async getPending(): Promise<Array<{ id: string | number }>> {
    return Array.from(this.scheduledTimers.keys()).map(id => ({ id }));
  }
}

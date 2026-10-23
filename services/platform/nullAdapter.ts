/**
 * Flowmate Greenfield Platform Core — Null / Fallback Adapter (P1-08)
 *
 * Safe no-op implementation of PlatformPort for non-browser/test/server environments.
 * Ensures Core never throws ReferenceError when running without host adapters.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import {
  PlatformPort,
  NotificationPort,
  HapticsPort,
  PlatformCapabilities,
  PlatformPermissionState,
  PlatformNotificationPayload,
  HapticImpactStyle,
  HapticNotificationType,
} from './ports';

export class NullNotificationAdapter implements NotificationPort {
  async checkPermission(): Promise<PlatformPermissionState> {
    return 'unsupported';
  }

  async requestPermission(): Promise<boolean> {
    return false;
  }

  async schedule(_notification: PlatformNotificationPayload): Promise<boolean> {
    return false;
  }

  async cancel(_id: string | number): Promise<void> {
    // No-op
  }

  async cancelAll(): Promise<void> {
    // No-op
  }
}

export class NullHapticsAdapter implements HapticsPort {
  async impact(_style?: HapticImpactStyle): Promise<void> {
    // No-op
  }

  async notification(_type?: HapticNotificationType): Promise<void> {
    // No-op
  }

  async selectionClick(): Promise<void> {
    // No-op
  }
}

export class NullPlatformAdapter implements PlatformPort {
  readonly notifications: NotificationPort = new NullNotificationAdapter();
  readonly haptics: HapticsPort = new NullHapticsAdapter();

  getCapabilities(): PlatformCapabilities {
    return {
      hasNotifications: false,
      hasHaptics: false,
      hasAudioInput: false,
      isOnline: true,
      platformName: 'node',
    };
  }
}

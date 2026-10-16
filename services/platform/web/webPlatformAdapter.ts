/**
 * Flowmate Web Platform — Aggregate Platform Adapter (P1-08)
 *
 * Implements PlatformPort for web browser environments.
 * Encapsulates location, notifications, haptics, and capability detection.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import {
  PlatformPort,
  LocationPort,
  NotificationPort,
  HapticsPort,
  PlatformCapabilities,
} from '../ports';
import { setPlatform } from '../registry';
import { WebLocationAdapter } from './webLocationAdapter';
import { WebNotificationAdapter } from './webNotificationAdapter';
import { WebHapticsAdapter } from './webHapticsAdapter';

export class WebPlatformAdapter implements PlatformPort {
  readonly location: LocationPort;
  readonly notifications: NotificationPort;
  readonly haptics: HapticsPort;

  constructor(
    location?: LocationPort,
    notifications?: NotificationPort,
    haptics?: HapticsPort
  ) {
    this.location = location ?? new WebLocationAdapter();
    this.notifications = notifications ?? new WebNotificationAdapter();
    this.haptics = haptics ?? new WebHapticsAdapter();
  }

  getCapabilities(): PlatformCapabilities {
    const isBrowser = typeof window !== 'undefined' && typeof navigator !== 'undefined';

    return {
      hasGeolocation: isBrowser && 'geolocation' in navigator,
      hasNotifications: isBrowser && 'Notification' in window,
      hasHaptics: isBrowser && typeof navigator.vibrate === 'function',
      hasAudioInput: isBrowser && Boolean(navigator.mediaDevices?.getUserMedia),
      isOnline: isBrowser ? navigator.onLine : true,
      platformName: 'web',
    };
  }
}

/**
 * Registers the Web Platform Adapter as active in the platform registry.
 * Should be called once during web app bootstrapping.
 */
export function registerWebPlatform(): WebPlatformAdapter {
  const adapter = new WebPlatformAdapter();
  setPlatform(adapter);
  return adapter;
}

/**
 * Flowmate Greenfield Platform Core — Boundary & Port Contract Tests (P1-08)
 *
 * Verifies:
 * 1. Core modules operate purely without browser/DOM globals.
 * 2. Null/fallback platform adapters safely no-op in headless/Node runtimes.
 * 3. Custom platform ports inject cleanly into LiveContextManager.
 * 4. Web adapters handle absent browser APIs gracefully without crashing.
 * 5. AuthenticatedIdentity completely decouples Store from Firebase SDK User.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LocationPort,
  NotificationPort,
  HapticsPort,
  PlatformPort,
  PlatformPermissionState,
  PlatformLocationReading,
  PlatformNotificationPayload,
  AuthenticatedIdentity,
  getPlatform,
  setPlatform,
  resetPlatform,
  NullPlatformAdapter,
  NullLocationAdapter,
  NullNotificationAdapter,
  NullHapticsAdapter,
} from '../services/platform';
import {
  WebLocationAdapter,
  WebNotificationAdapter,
  WebHapticsAdapter,
  WebPlatformAdapter,
} from '../services/platform/web';
import { LiveContextManager } from '../services/context/liveContext';
import { useStore } from '../store';

describe('P1-08: Platform Core & Adapter Boundary', () => {
  beforeEach(() => {
    resetPlatform();
  });

  afterEach(() => {
    resetPlatform();
    vi.restoreAllMocks();
  });

  describe('1. Null / Fallback Platform Adapter', () => {
    it('provides safe no-op behavior for location in headless/Node runtimes', async () => {
      const location = new NullLocationAdapter();
      const perm = await location.checkPermission();
      expect(perm).toBe('unsupported');

      const pos = await location.getCurrentPosition();
      expect(pos).toBeNull();
    });

    it('provides safe no-op behavior for notifications in headless/Node runtimes', async () => {
      const notifications = new NullNotificationAdapter();
      expect(await notifications.checkPermission()).toBe('unsupported');
      expect(await notifications.requestPermission()).toBe(false);

      const scheduled = await notifications.schedule({
        id: 'test-1',
        title: 'Test',
        body: 'Testing',
      });
      expect(scheduled).toBe(false);

      // Should not throw
      await notifications.cancel('test-1');
      await notifications.cancelAll();
    });

    it('provides safe no-op behavior for haptics in headless/Node runtimes', async () => {
      const haptics = new NullHapticsAdapter();
      // None of these should throw in headless environments
      await haptics.impact('light');
      await haptics.notification('success');
      await haptics.selectionClick();
    });

    it('reports platformName node and offline/safe capability flags', () => {
      const platform = new NullPlatformAdapter();
      const caps = platform.getCapabilities();

      expect(caps.platformName).toBe('node');
      expect(caps.hasGeolocation).toBe(false);
      expect(caps.hasNotifications).toBe(false);
      expect(caps.hasHaptics).toBe(false);
      expect(caps.isOnline).toBe(true);
    });
  });

  describe('2. Platform Registry & Injection', () => {
    it('defaults to NullPlatformAdapter when uninitialized', () => {
      const current = getPlatform();
      expect(current).toBeInstanceOf(NullPlatformAdapter);
      expect(current.getCapabilities().platformName).toBe('node');
    });

    it('allows registering a custom PlatformPort implementation', () => {
      const customPlatform: PlatformPort = {
        location: new NullLocationAdapter(),
        notifications: new NullNotificationAdapter(),
        haptics: new NullHapticsAdapter(),
        getCapabilities: () => ({
          hasGeolocation: true,
          hasNotifications: true,
          hasHaptics: true,
          hasAudioInput: true,
          isOnline: true,
          platformName: 'desktop',
        }),
      };

      setPlatform(customPlatform);
      expect(getPlatform().getCapabilities().platformName).toBe('desktop');
      expect(getPlatform().getCapabilities().hasGeolocation).toBe(true);

      resetPlatform();
      expect(getPlatform().getCapabilities().platformName).toBe('node');
    });
  });

  describe('3. LiveContextManager Decoupled Integration', () => {
    it('uses injected mock LocationPort without invoking browser globals', async () => {
      const mockLocationPort: LocationPort = {
        checkPermission: async () => 'granted',
        getCurrentPosition: async (opts) => ({
          lat: 20.2961,
          lon: 85.8245,
          accuracy_meters: opts?.highAccuracy ? 5 : 25,
          timestamp: 1700000000000,
          source: 'device',
        }),
      };

      const manager = new LiveContextManager(mockLocationPort);

      // Check permission via injected port
      const perm = await manager.checkPermission();
      expect(perm).toBe('granted');

      // Acquire location via injected port
      const loc = await manager.acquireLocation({ forceFresh: true });
      expect(loc).not.toBeNull();
      expect(loc?.lat).toBe(20.2961);
      expect(loc?.lon).toBe(85.8245);
      expect(loc?.accuracy_meters).toBe(5);
      expect(loc?.source).toBe('device');
    });

    it('falls back to active registry LocationPort if none injected', async () => {
      const manager = new LiveContextManager();
      const perm = await manager.checkPermission();
      expect(perm).toBe('unsupported'); // from default NullLocationAdapter
    });
  });

  describe('4. Web Adapters Resilience in Headless / Non-DOM Environments', () => {
    it('WebLocationAdapter handles missing navigator gracefully', async () => {
      const adapter = new WebLocationAdapter();
      const perm = await adapter.checkPermission();
      expect(perm).toBeDefined();

      const pos = await adapter.getCurrentPosition({ timeoutMs: 50 });
      expect(pos).toBeNull();
    });

    it('WebNotificationAdapter handles missing window.Notification gracefully', async () => {
      const adapter = new WebNotificationAdapter();
      const perm = await adapter.checkPermission();
      expect(perm).toBeDefined();

      const res = await adapter.schedule({
        id: 'reminder-1',
        title: 'Standup',
        body: 'Time for daily standup',
      });
      // In jsdom without Notification permission granted, should safely return false
      expect(typeof res).toBe('boolean');
    });

    it('WebHapticsAdapter handles missing navigator.vibrate gracefully', async () => {
      const adapter = new WebHapticsAdapter();
      // Should not throw even if navigator.vibrate is undefined
      await adapter.impact('heavy');
      await adapter.notification('warning');
      await adapter.selectionClick();
    });

    it('WebPlatformAdapter produces valid capabilities snapshot', () => {
      const adapter = new WebPlatformAdapter();
      const caps = adapter.getCapabilities();

      expect(caps.platformName).toBe('web');
      expect(typeof caps.hasGeolocation).toBe('boolean');
      expect(typeof caps.hasNotifications).toBe('boolean');
      expect(typeof caps.hasHaptics).toBe('boolean');
      expect(typeof caps.isOnline).toBe('boolean');
    });
  });

  describe('5. Store User Identity Decoupling', () => {
    it('accepts platform-neutral AuthenticatedIdentity in store without Firebase User class', () => {
      const mockIdentity: AuthenticatedIdentity = {
        uid: 'flowmate_user_99',
        email: 'alex@flowmate.ai',
        displayName: 'Alex Rivers',
        photoURL: 'https://flowmate.ai/avatars/alex.png',
        providerId: 'google.com',
      };

      useStore.getState().setCurrentUser(mockIdentity);

      const currentUser = useStore.getState().currentUser;
      expect(currentUser).not.toBeNull();
      expect(currentUser?.uid).toBe('flowmate_user_99');
      expect(currentUser?.email).toBe('alex@flowmate.ai');
      expect(currentUser?.displayName).toBe('Alex Rivers');

      // Clear user
      useStore.getState().setCurrentUser(null);
      expect(useStore.getState().currentUser).toBeNull();
    });
  });
});

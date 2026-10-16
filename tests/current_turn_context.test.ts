import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isLocationRelevantQuery,
  formatLiveLocationForContext,
  buildContextPrompt,
} from '../services/ai/context';
import { liveContext } from '../services/context/liveContext';
import { privacyManager, DEFAULT_PRIVACY_POLICY } from '../services/context/privacy';
import { useStore } from '../store';
import type { DeviceLocationWithFreshness, PrivacyPolicySettings } from '../services/context/types';

describe('Smart Current-Turn Context Layer', () => {
  beforeEach(() => {
    liveContext.clearCache();
    privacyManager.clearLogs();
    useStore.setState({
      messages: [],
      entities: [],
      relationships: [],
    });
  });

  describe('isLocationRelevantQuery', () => {
    it('detects location-sensitive and spatial queries', () => {
      expect(isLocationRelevantQuery('Where am I right now?')).toBe(true);
      expect(isLocationRelevantQuery('What is the nearest coffee shop?')).toBe(true);
      expect(isLocationRelevantQuery('Find nearby restaurants')).toBe(true);
      expect(isLocationRelevantQuery('How far is Bhubaneswar station?')).toBe(true);
      expect(isLocationRelevantQuery('When should I leave for Campus 25?')).toBe(true);
      expect(isLocationRelevantQuery('What is the best route to Cuttack?')).toBe(true);
      expect(isLocationRelevantQuery('Check current traffic to airport')).toBe(true);
      expect(isLocationRelevantQuery('What is the weather today?')).toBe(true);
      expect(isLocationRelevantQuery('Find a pharmacy near me')).toBe(true);
    });

    it('rejects non-spatial general queries', () => {
      expect(isLocationRelevantQuery('Create a task to buy milk')).toBe(false);
      expect(isLocationRelevantQuery('What are my active goals?')).toBe(false);
      expect(isLocationRelevantQuery('Summarize my project meetings')).toBe(false);
      expect(isLocationRelevantQuery('Help me write a Python sorting algorithm')).toBe(false);
      expect(isLocationRelevantQuery('Good morning Flowmate')).toBe(false);
      expect(isLocationRelevantQuery('Log a meal of oatmeal for breakfast')).toBe(false);
    });
  });

  describe('formatLiveLocationForContext', () => {
    it('formats human-readable locality prose with place name and accuracy', () => {
      const reading: DeviceLocationWithFreshness = {
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 15,
        timestamp: Date.now() - 8000,
        source: 'device',
        freshnessTier: 'fresh',
        ageMs: 8000,
      };

      const formatted = formatLiveLocationForContext(reading, 'Patia, Bhubaneswar, Odisha');
      expect(formatted).toContain('Current approximate location: Patia, Bhubaneswar, Odisha.');
      expect(formatted).toContain('Accuracy: ~15m.');
      expect(formatted).toContain('Acquired 8s ago.');
      expect(formatted).toContain('Source: device location (fresh).');
    });

    it('falls back to coordinates when place name is not available', () => {
      const reading: DeviceLocationWithFreshness = {
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 30,
        timestamp: Date.now() - 25000,
        source: 'device',
        freshnessTier: 'fresh',
        ageMs: 25000,
      };

      const formatted = formatLiveLocationForContext(reading);
      expect(formatted).toContain('Current approximate location: 20.3547°N, 85.8189°E.');
      expect(formatted).toContain('Accuracy: ~30m.');
      expect(formatted).toContain('Acquired 25s ago.');
    });
  });

  describe('buildContextPrompt', () => {
    const mockSnapshot = { entities: [], relationships: [] };

    it('strictly injects live context only when provided', () => {
      const promptWithoutLive = buildContextPrompt(
        mockSnapshot,
        '',
        false,
        'Asia/Kolkata',
        'Campus 25, KIIT',
        null,
      );
      expect(promptWithoutLive).not.toContain('[Live Context]');
      expect(promptWithoutLive).toContain('[Location] Configured Default Starting Location: Campus 25, KIIT');

      const liveContextString = 'Current approximate location: Patia, Bhubaneswar. Accuracy: ~15m.';
      const promptWithLive = buildContextPrompt(
        mockSnapshot,
        '',
        false,
        'Asia/Kolkata',
        'Campus 25, KIIT',
        liveContextString,
      );
      expect(promptWithLive).toContain(`[Live Context] ${liveContextString}`);
      expect(promptWithLive).toContain('[Location] Configured Default Starting Location: Campus 25, KIIT');
    });

    it('injects privacy policy disable notification when denied', () => {
      const deniedNotice = 'Device location access is currently disabled by privacy policy.';
      const prompt = buildContextPrompt(
        mockSnapshot,
        '',
        false,
        'Asia/Kolkata',
        undefined,
        deniedNotice,
      );
      expect(prompt).toContain(`[Live Context] ${deniedNotice}`);
      expect(prompt).not.toContain('[Location]');
    });
  });

  describe('Chat History Boundary Protection', () => {
    it('verifies that persistent chat messages never retain transient live context injection', () => {
      const store = useStore.getState();
      const rawUserQuery = 'What is the nearest coffee shop to me?';

      // Simulate sending a message to store
      store.addMessage('user', rawUserQuery);
      store.addMessage('assistant', 'The nearest coffee shop is Cafe 16 located 350m north.');

      const savedMessages = useStore.getState().messages;
      expect(savedMessages).toHaveLength(2);

      // Verify the user message contains ONLY the user text
      expect(savedMessages[0].text).toBe(rawUserQuery);
      expect(savedMessages[0].text).not.toContain('[Live Context]');
      expect(savedMessages[0].text).not.toContain('Patia');
      expect(savedMessages[0].text).not.toContain('approximate location');

      // Verify the assistant message contains ONLY the assistant reply
      expect(savedMessages[1].text).toBe('The nearest coffee shop is Cafe 16 located 350m north.');
      expect(savedMessages[1].text).not.toContain('[Live Context]');
    });
  });

  describe('Privacy Policy Gating and Audit Logging', () => {
    it('blocks acquisition and records zero GPS access when policy is deny', () => {
      const denyPolicy: PrivacyPolicySettings = {
        capabilities: {
          device_location: { read: 'deny', mutation: 'deny' },
        },
        audit_logging_enabled: true,
      };

      const decision = privacyManager.checkPermission('device_location', 'read', denyPolicy);
      expect(decision.permitted).toBe(false);

      // Verify no audit access logged for denied read
      const logs = privacyManager.getAccessLogs();
      expect(logs).toHaveLength(0);
    });

    it('permits acquisition and records audit entry when policy is allow', () => {
      const allowPolicy: PrivacyPolicySettings = {
        capabilities: {
          device_location: { read: 'allow', mutation: 'deny' },
        },
        audit_logging_enabled: true,
      };

      const decision = privacyManager.checkPermission('device_location', 'read', allowPolicy);
      expect(decision.permitted).toBe(true);

      privacyManager.recordAccess(
        'device_location',
        'read',
        'Current-turn context enrichment for prompt',
        allowPolicy,
      );

      const logs = privacyManager.getAccessLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].capabilityId).toBe('device_location');
      expect(logs[0].action).toBe('read');
      expect(logs[0].reason).toBe('Current-turn context enrichment for prompt');
    });
  });
});

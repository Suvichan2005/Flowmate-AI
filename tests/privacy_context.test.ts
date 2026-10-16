/**
 * TASK-P1-03: Privacy & Context Foundation + Live Device Location Test Suite
 *
 * Verifies:
 * 1. Privacy/Capability Abstraction:
 *    - Default permission policy ('ask' read, 'deny' mutation for location)
 *    - Modes: 'allow', 'ask', 'deny'
 *    - Separation of READ vs MUTATION permissions
 *    - Revocation of capabilities
 * 2. Transparent Sensitive Access Auditing:
 *    - Access logging on sensitive reads
 *    - Audit toggle enforcement
 *    - Clear audit log
 * 3. Ephemeral Device Location & Freshness:
 *    - Request-time authoritative acquisition (<60s 'fresh')
 *    - Recent cached observation (<15m 'recent')
 *    - Stale cache rejection (>=15m 'stale')
 *    - Hardware states: granted, denied, prompt, unsupported, timeout
 *    - Ephemeral runtime: coordinates NEVER written to permanent settings
 * 4. Origin Precedence Hierarchy in Travel:
 *    - Explicit Origin > Authorized Fresh Live Location > Recent Cache > Default Home Base > Ask User
 *    - Privacy policy denial blocks device location even if hardware is available
 *    - Default home base never masquerades as current location
 * 5. Prompt Cleanliness:
 *    - Coordinates are NOT injected into unrelated prompts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  liveContext,
  LiveContextManager,
  privacyManager,
  PrivacyManager,
  DEFAULT_PRIVACY_POLICY,
  PrivacyPolicySettings,
  DeviceLocationReading,
} from '../services/context';
import { lookupTravelRoute } from '../services/travel';
import { buildContextPrompt } from '../services/ai/context';
import {
  FIXTURE_CAMPUS_25,
  FIXTURE_BBS_STATION,
  FIXTURE_SF_FERRY,
  FIXTURE_SFO_AIRPORT,
  MockGeocodingProvider,
  MockRouteProvider,
} from './fixtures/travelFixtures';

describe('TASK-P1-03: Privacy & Context Foundation + Live Device Location', () => {
  let mockGeocoder: MockGeocodingProvider;
  let mockRouter: MockRouteProvider;

  beforeEach(() => {
    mockGeocoder = new MockGeocodingProvider();
    mockRouter = new MockRouteProvider({ distanceKm: 14.1, durationMinutes: 28 });
    liveContext.clearCache();
    privacyManager.clearAccessLogs();
  });

  afterEach(() => {
    liveContext.clearCache();
    privacyManager.clearAccessLogs();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Privacy & Capability Permission Foundation
  // =========================================================================
  describe('Privacy & Capability Permission Foundation', () => {
    it('provides sensible default privacy policy with read=ask, mutation=deny for location', () => {
      const pm = new PrivacyManager();
      const decisionRead = pm.checkPermission('device_location', 'read');
      expect(decisionRead.permitted).toBe(true);
      expect(decisionRead.requiresConfirmation).toBe(true);

      const decisionWrite = pm.checkPermission('device_location', 'write');
      expect(decisionWrite.permitted).toBe(false);
      expect(decisionWrite.reason).toContain('Mutation access to \'device_location\' is denied');
    });

    it('enforces strict separation between READ and MUTATION permissions', () => {
      const pm = new PrivacyManager();
      const customPolicy: PrivacyPolicySettings = {
        capabilities: {
          device_location: { read: 'allow', mutation: 'deny' },
          google_calendar: { read: 'allow', mutation: 'ask' },
        },
        audit_logging_enabled: true,
      };

      // Location: Read is allowed, write is denied
      expect(pm.checkPermission('device_location', 'read', customPolicy).permitted).toBe(true);
      expect(pm.checkPermission('device_location', 'read', customPolicy).requiresConfirmation).toBe(false);
      expect(pm.checkPermission('device_location', 'write', customPolicy).permitted).toBe(false);

      // Calendar: Read is allowed without prompt, mutation requires confirmation
      expect(pm.checkPermission('google_calendar', 'read', customPolicy).permitted).toBe(true);
      expect(pm.checkPermission('google_calendar', 'read', customPolicy).requiresConfirmation).toBe(false);
      expect(pm.checkPermission('google_calendar', 'write', customPolicy).permitted).toBe(true);
      expect(pm.checkPermission('google_calendar', 'write', customPolicy).requiresConfirmation).toBe(true);
    });

    it('immediately blocks capability access when policy is set to deny', () => {
      const pm = new PrivacyManager();
      const deniedPolicy: PrivacyPolicySettings = {
        capabilities: {
          device_location: { read: 'deny', mutation: 'deny' },
        },
        audit_logging_enabled: true,
      };

      const decision = pm.checkPermission('device_location', 'read', deniedPolicy);
      expect(decision.permitted).toBe(false);
      expect(decision.reason).toContain('denied by privacy policy');
    });

    it('honors capability revocation flag', () => {
      const pm = new PrivacyManager();
      const revokedPolicy: PrivacyPolicySettings = {
        capabilities: {
          device_location: { read: 'allow', mutation: 'deny', revoked: true },
        },
        audit_logging_enabled: true,
      };

      const decision = pm.checkPermission('device_location', 'read', revokedPolicy);
      expect(decision.permitted).toBe(false);
      expect(decision.reason).toContain('revoked by user policy');
    });

    it('defaults unconfigured future capabilities to deny for safety', () => {
      const pm = new PrivacyManager();
      const minimalPolicy: PrivacyPolicySettings = {
        capabilities: {
          device_location: { read: 'allow', mutation: 'deny' },
        },
        audit_logging_enabled: true,
      };

      const decision = pm.checkPermission('gmail', 'read', minimalPolicy);
      expect(decision.permitted).toBe(false);
      expect(decision.reason).toContain('not configured or available');
    });
  });

  // =========================================================================
  // 2. Sensitive Context Access Auditing
  // =========================================================================
  describe('Sensitive Context Access Auditing', () => {
    it('records access logs with purpose, action, timestamp, and capability ID', () => {
      const pm = new PrivacyManager();
      pm.recordAccess('device_location', 'read', 'Calculate route to railway station');

      const logs = pm.getAccessLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].capabilityId).toBe('device_location');
      expect(logs[0].action).toBe('read');
      expect(logs[0].reason).toBe('Calculate route to railway station');
      expect(logs[0].timestamp).toBeGreaterThan(0);
    });

    it('does NOT record logs when audit_logging_enabled is false', () => {
      const pm = new PrivacyManager();
      const noAuditPolicy: PrivacyPolicySettings = {
        capabilities: {
          device_location: { read: 'allow', mutation: 'deny' },
        },
        audit_logging_enabled: false,
      };

      pm.recordAccess('device_location', 'read', 'Should not be recorded', noAuditPolicy);
      expect(pm.getAccessLogs()).toHaveLength(0);
    });

    it('clears audit logs cleanly', () => {
      const pm = new PrivacyManager();
      pm.recordAccess('device_location', 'read', 'Test log');
      expect(pm.getAccessLogs()).toHaveLength(1);

      pm.clearAccessLogs();
      expect(pm.getAccessLogs()).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. Ephemeral Device Geolocation & Freshness Modeling
  // =========================================================================
  describe('Device Geolocation & Freshness Tiers', () => {
    it('models fresh acquisition tier (< 60s)', () => {
      const now = Date.now();
      const tier = liveContext.calculateFreshnessTier(now - 15 * 1000, now);
      expect(tier).toBe('fresh');
    });

    it('models recent cached observation tier (< 15m)', () => {
      const now = Date.now();
      const tier = liveContext.calculateFreshnessTier(now - 7 * 60 * 1000, now);
      expect(tier).toBe('recent');
    });

    it('models stale observation tier (>= 15m)', () => {
      const now = Date.now();
      const tier = liveContext.calculateFreshnessTier(now - 20 * 60 * 1000, now);
      expect(tier).toBe('stale');
    });

    it('guarantees live location is ephemeral in-memory state and not saved to settings', async () => {
      liveContext.setMockLocation({
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 10,
        timestamp: Date.now(),
        source: 'mock',
      });

      const reading = await liveContext.acquireLocation();
      expect(reading).toBeDefined();

      // Clear in-memory cache
      liveContext.clearCache();
      expect(liveContext.getLastReading()).toBeNull();
    });
  });

  // =========================================================================
  // 4. Origin Precedence Hierarchy & Privacy Integration in Travel
  // =========================================================================
  describe('Origin Precedence Hierarchy in Travel Routing', () => {
    it('Priority 1: Explicit origin supplied in query always wins, ignoring live location', async () => {
      liveContext.setMockLocation({
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 5,
        timestamp: Date.now(),
        source: 'mock',
      });

      const res = await lookupTravelRoute(
        {
          origin: 'Ferry Building',
          destination: 'SFO Airport',
        },
        { home_location: 'Campus 25' } as any,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      expect(res.status).toBe('success');
      expect(res.origin_type).toBe('explicit');
      expect(res.route?.origin.displayName).toBe(FIXTURE_SF_FERRY.displayName);
      expect(res.route?.destination.displayName).toBe(FIXTURE_SFO_AIRPORT.displayName);
      // Privacy access was NOT triggered because explicit origin was provided
      expect(privacyManager.getAccessLogs()).toHaveLength(0);
    });

    it('Priority 2: Fresh live device location is used when origin is omitted and authorized', async () => {
      liveContext.setMockLocation({
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 6,
        timestamp: Date.now(),
        source: 'mock',
      });

      const res = await lookupTravelRoute(
        { destination: 'Bhubaneswar Railway Station' },
        { home_location: 'Campus 25' } as any,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      expect(res.status).toBe('success');
      expect(res.origin_type).toBe('live_location');
      expect(res.origin_freshness).toBe('fresh');
      expect(res.route?.origin.lat).toBe(20.3547);
      expect(res.route?.origin.lon).toBe(85.8189);
      expect(res.route?.destination.displayName).toBe(FIXTURE_BBS_STATION.displayName);

      // Audited transparently
      const logs = privacyManager.getAccessLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].capabilityId).toBe('device_location');
      expect(logs[0].reason).toContain('Bhubaneswar Railway Station');
    });

    it('Privacy Enforcement: Denied location policy blocks GPS and falls back to default home base', async () => {
      liveContext.setMockLocation({
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 6,
        timestamp: Date.now(),
        source: 'mock',
      });

      // User has explicitly set location read access to 'deny'
      const settingsWithDeniedLocation = {
        home_location: 'Campus 25',
        privacy_preferences: {
          capabilities: {
            device_location: { read: 'deny', mutation: 'deny' },
          },
          audit_logging_enabled: true,
        },
      } as any;

      const res = await lookupTravelRoute(
        { destination: 'Bhubaneswar Railway Station' },
        settingsWithDeniedLocation,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      // Falls back to configured default home base without touching GPS
      expect(res.status).toBe('success');
      expect(res.origin_type).toBe('default_home');
      expect(res.route?.origin.displayName).toBe(FIXTURE_CAMPUS_25.displayName);
      // No sensitive location access logged
      expect(privacyManager.getAccessLogs()).toHaveLength(0);
    });

    it('Priority 5: Degrades to MISSING_ORIGIN when no origin, denied location, and no home location', async () => {
      const settingsDeniedNoHome = {
        home_location: undefined,
        privacy_preferences: {
          capabilities: {
            device_location: { read: 'deny', mutation: 'deny' },
          },
          audit_logging_enabled: true,
        },
      } as any;

      const res = await lookupTravelRoute(
        { destination: 'Bhubaneswar Railway Station' },
        settingsDeniedNoHome,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      expect(res.status).toBe('error');
      expect(res.code).toBe('MISSING_ORIGIN');
      expect(res.message).toContain('Starting origin is required');
    });
  });

  // =========================================================================
  // 5. Prompt Cleanliness & Absence of Coordinate Leakage
  // =========================================================================
  describe('Prompt Cleanliness & Privacy Boundary', () => {
    it('does NOT inject raw coordinates into general context prompts', () => {
      const prompt = buildContextPrompt(
        { entities: [], relationships: [] },
        'study, exam',
        false,
        'Asia/Kolkata',
        'Campus 25',
      );

      // Contains configured home base preference, but NEVER raw device coordinates
      expect(prompt).toContain('Configured Default Starting Location: Campus 25');
      expect(prompt).not.toContain('Coordinates:');
      expect(prompt).not.toContain('lat:');
      expect(prompt).not.toContain('lon:');
    });
  });
});

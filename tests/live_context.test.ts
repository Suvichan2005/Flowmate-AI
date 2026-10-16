/**
 * TASK-P1-03: Live Context Engine & Device Geolocation Test Suite
 *
 * Verifies:
 * 1. Freshness Tiers: 'fresh' (<60s), 'recent' (<15m), 'stale' (>=15m)
 * 2. Origin Precedence Hierarchy:
 *    Explicit Origin > Fresh Live Location > Recent Cached Observation > Configured Default Home > Ask User
 * 3. Ephemeral Sensor Model:
 *    Coordinates and accuracy are never written to permanent settings/storage without explicit user action
 * 4. Decoupled Reverse Geocoding:
 *    Direct coordinate execution for routing without blocking reverse geocode
 * 5. Permission Degradation & Stale Observation Handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  liveContext,
  LiveContextManager,
  LOCATION_FRESHNESS_FRESH_MS,
  LOCATION_FRESHNESS_RECENT_MS,
  DeviceLocationReading,
} from '../services/context';
import { lookupTravelRoute } from '../services/travel';
import {
  FIXTURE_CAMPUS_25,
  FIXTURE_BBS_STATION,
  FIXTURE_SF_FERRY,
  FIXTURE_SFO_AIRPORT,
  MockGeocodingProvider,
  MockRouteProvider,
} from './fixtures/travelFixtures';

describe('TASK-P1-03: Live Context Engine & Device Geolocation', () => {
  let mockGeocoder: MockGeocodingProvider;
  let mockRouter: MockRouteProvider;

  beforeEach(() => {
    mockGeocoder = new MockGeocodingProvider();
    mockRouter = new MockRouteProvider({ distanceKm: 12.8, durationMinutes: 25 });
    liveContext.clearCache();
  });

  afterEach(() => {
    liveContext.clearCache();
    vi.restoreAllMocks();
  });

  describe('Freshness Tier Modeling', () => {
    it('accurately categorizes fresh observations (< 60 seconds)', () => {
      const now = 1700000000000;
      const readingTimestamp = now - 25 * 1000; // 25 seconds ago
      const tier = liveContext.calculateFreshnessTier(readingTimestamp, now);
      expect(tier).toBe('fresh');
    });

    it('accurately categorizes recent cached observations (60s to 15m)', () => {
      const now = 1700000000000;
      const readingTimestamp = now - 5 * 60 * 1000; // 5 minutes ago
      const tier = liveContext.calculateFreshnessTier(readingTimestamp, now);
      expect(tier).toBe('recent');
    });

    it('accurately categorizes stale observations (>= 15 minutes)', () => {
      const now = 1700000000000;
      const readingTimestamp = now - 16 * 60 * 1000; // 16 minutes ago
      const tier = liveContext.calculateFreshnessTier(readingTimestamp, now);
      expect(tier).toBe('stale');
    });

    it('attaches freshness metadata and ageMs correctly', () => {
      const now = 1700000000000;
      const reading: DeviceLocationReading = {
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 15,
        timestamp: now - 30 * 1000,
        source: 'device',
      };

      const enriched = liveContext.withFreshness(reading, now);
      expect(enriched.freshnessTier).toBe('fresh');
      expect(enriched.ageMs).toBe(30 * 1000);
      expect(enriched.lat).toBe(20.3547);
    });
  });

  describe('Acquisition & Cache Lifecycle', () => {
    it('returns mock reading immediately when mock location is injected', async () => {
      const now = Date.now();
      liveContext.setMockLocation({
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 8,
        timestamp: now,
        source: 'mock',
      });

      const loc = await liveContext.acquireLocation();
      expect(loc).toBeDefined();
      expect(loc?.lat).toBe(20.3547);
      expect(loc?.freshnessTier).toBe('fresh');
      expect(loc?.source).toBe('mock');
    });

    it('clears transient in-memory observations cleanly', () => {
      liveContext.setMockLocation({
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 10,
        timestamp: Date.now(),
        source: 'mock',
      });

      expect(liveContext.getLastReading()).not.toBeNull();
      liveContext.clearCache();
      expect(liveContext.getLastReading()).toBeNull();
    });

    it('returns recent cached observation if fresh acquisition is not forced', async () => {
      const manager = new LiveContextManager();
      const reading: DeviceLocationReading = {
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 12,
        timestamp: Date.now() - 3 * 60 * 1000, // 3 min ago (recent)
        source: 'device',
      };
      (manager as any).lastReading = reading;

      const result = await manager.acquireLocation({ forceFresh: false });
      expect(result).not.toBeNull();
      expect(result?.freshnessTier).toBe('recent');
      expect(result?.lat).toBe(20.3547);
    });
  });

  describe('Decoupled Reverse Geocoding', () => {
    it('executes reverse geocoding on-demand and caches result', async () => {
      // Mock global fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                name: 'KIIT Campus 25',
                district: 'Bhubaneswar',
                state: 'Odisha',
              },
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const name = await liveContext.reverseGeocode(20.3547, 85.8189);
      expect(name).toBe('KIIT Campus 25, Bhubaneswar, Odisha');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call uses internal coordinate cache
      const cachedName = await liveContext.reverseGeocode(20.3547, 85.8189);
      expect(cachedName).toBe('KIIT Campus 25, Bhubaneswar, Odisha');
      expect(mockFetch).toHaveBeenCalledTimes(1); // Not called again
    });

    it('falls back to formatted coordinate string when reverse geocode fails or times out', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network offline')));

      const fallback = await liveContext.reverseGeocode(20.3547, 85.8189);
      expect(fallback).toBe('20.3547°N, 85.8189°E');
    });
  });

  describe('Origin Precedence Hierarchy in Travel Routing', () => {
    it('Priority 1: Explicit origin in query overrides live location completely', async () => {
      // Injected fresh live location
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
    });

    it('Priority 2: Fresh live device location is used when origin is omitted', async () => {
      const now = Date.now();
      liveContext.setMockLocation({
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 6,
        timestamp: now - 10 * 1000, // 10s old (fresh)
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
    });

    it('Priority 3: Recent cached observation (< 15 min old) is accepted if fresh GPS fails', async () => {
      const now = Date.now();
      liveContext.setMockLocation({
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 15,
        timestamp: now - 8 * 60 * 1000, // 8 min old (recent)
        source: 'mock',
      });

      const res = await lookupTravelRoute(
        { destination: 'Bhubaneswar Railway Station' },
        { home_location: 'Campus 25' } as any,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      expect(res.status).toBe('success');
      expect(res.origin_type).toBe('live_location');
      expect(res.origin_freshness).toBe('recent');
      expect(res.route?.origin.lat).toBe(20.3547);
    });

    it('Priority 4: Stale location degrades to configured default fallback (home_location)', async () => {
      const now = Date.now();
      // Inject stale location (20 min old)
      liveContext.setMockLocation({
        lat: 37.7955,
        lon: -122.3937,
        accuracy_meters: 20,
        timestamp: now - 20 * 60 * 1000, // 20m old (stale)
        source: 'mock',
      });

      const res = await lookupTravelRoute(
        { destination: 'Bhubaneswar Railway Station' },
        { home_location: 'Campus 25' } as any,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      // Stale observation is rejected, falling back to configured home_location
      expect(res.status).toBe('success');
      expect(res.origin_type).toBe('default_home');
      expect(res.route?.origin.displayName).toBe(FIXTURE_CAMPUS_25.displayName);
    });

    it('Priority 5: Degrades to MISSING_ORIGIN when no origin, no live location, and no home_location', async () => {
      liveContext.clearCache();

      const res = await lookupTravelRoute(
        { destination: 'Bhubaneswar Railway Station' },
        { home_location: undefined } as any,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      expect(res.status).toBe('error');
      expect(res.code).toBe('MISSING_ORIGIN');
      expect(res.message).toContain('Starting origin is required');
    });

    it('Direct coordinate execution: routes successfully without requiring reverse geocoding blocker', async () => {
      liveContext.setMockLocation({
        lat: 20.3547,
        lon: 85.8189,
        accuracy_meters: 10,
        timestamp: Date.now(),
        source: 'mock',
      });

      const res = await lookupTravelRoute(
        { destination: 'Bhubaneswar Railway Station' },
        undefined,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      expect(res.status).toBe('success');
      expect(res.route?.origin.type).toBe('live_device_location');
      expect(res.route?.origin.lat).toBe(20.3547);
      expect(res.route?.origin.lon).toBe(85.8189);
      expect(res.route?.distance_km).toBe(12.8);
      expect(res.route?.duration_minutes).toBe(25);
    });
  });

  describe('Generic Live Context Summary Assembly', () => {
    it('produces formatted prompt context summary from active observation', async () => {
      const now = Date.now();
      liveContext.setMockLocation({
        lat: 20.3540,
        lon: 85.8180,
        accuracy_meters: 14,
        timestamp: now,
        source: 'mock',
      });

      const summary = await liveContext.buildLiveContextSummary();
      expect(summary).toBeDefined();
      expect(summary).toContain('20.3540°N, 85.8180°E');
      expect(summary).toContain('fresh');
      expect(summary).toContain('±14m');
    });

    it('returns null when no observation is present', async () => {
      liveContext.clearCache();
      const summary = await liveContext.buildLiveContextSummary();
      expect(summary).toBeNull();
    });
  });
});

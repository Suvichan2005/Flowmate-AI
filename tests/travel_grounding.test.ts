import { describe, it, expect, beforeEach } from 'vitest';
import {
  lookupTravelRoute,
  calculateCriticalPathJourney,
} from '../services/travel';
import {
  FIXTURE_CAMPUS_25,
  FIXTURE_BBS_STATION,
  FIXTURE_SF_FERRY,
  FIXTURE_SFO_AIRPORT,
  MockGeocodingProvider,
  MockRouteProvider,
} from './fixtures/travelFixtures';
import { dispatchToolCall } from '../services/ai/executors';
import { Entity, EntityKind, EntityStatus, UserSettings } from '../types';

describe('TASK-P1-02: Grounded Travel & Route Grounding Service', () => {
  let mockGeocoder: MockGeocodingProvider;
  let mockRouter: MockRouteProvider;

  beforeEach(() => {
    mockGeocoder = new MockGeocodingProvider();
    mockRouter = new MockRouteProvider({ distanceKm: 13.5, durationMinutes: 28 });
  });

  describe('Origin Resolution & Fallback Behavior', () => {
    it('returns MISSING_ORIGIN when no origin is provided and settings has no home_location', async () => {
      const res = await lookupTravelRoute(
        { destination: 'Bhubaneswar Railway Station' },
        { home_location: undefined } as any,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      expect(res.status).toBe('error');
      expect(res.code).toBe('MISSING_ORIGIN');
      expect(res.message).toContain('Starting origin is required');
    });

    it('uses settings.home_location as fallback when origin parameter is omitted', async () => {
      const res = await lookupTravelRoute(
        { destination: 'Bhubaneswar Railway Station' },
        { home_location: 'Campus 25' } as any,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      expect(res.status).toBe('success');
      expect(res.route).toBeDefined();
      expect(res.route?.origin.displayName).toBe(FIXTURE_CAMPUS_25.displayName);
      expect(res.route?.destination.displayName).toBe(FIXTURE_BBS_STATION.displayName);
    });

    it('gives precedence to explicitly supplied origin over settings.home_location', async () => {
      const res = await lookupTravelRoute(
        { origin: 'Ferry Building', destination: 'SFO Airport' },
        { home_location: 'Campus 25' } as any,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      expect(res.status).toBe('success');
      expect(res.route?.origin.displayName).toBe(FIXTURE_SF_FERRY.displayName);
      expect(res.route?.destination.displayName).toBe(FIXTURE_SFO_AIRPORT.displayName);
    });
  });

  describe('Location Geocoding & Error Handling', () => {
    it('returns LOCATION_NOT_FOUND when geocoder fails to resolve a location', async () => {
      const res = await lookupTravelRoute(
        { origin: 'NonExistentPlaceXYZ987', destination: 'Bhubaneswar Station' },
        undefined,
        { geocoder: mockGeocoder, routeProvider: mockRouter },
      );

      expect(res.status).toBe('error');
      expect(res.code).toBe('LOCATION_NOT_FOUND');
      expect(res.unresolved).toBeDefined();
      expect(res.unresolved?.[0]).toContain('NonExistentPlaceXYZ987');
    });

    it('returns ROUTE_NOT_FOUND when route provider cannot find a valid path', async () => {
      const failingRouter = new MockRouteProvider({ shouldFail: true });
      const res = await lookupTravelRoute(
        { origin: 'Campus 25', destination: 'Bhubaneswar Station' },
        undefined,
        { geocoder: mockGeocoder, routeProvider: failingRouter },
      );

      expect(res.status).toBe('error');
      expect(res.code).toBe('ROUTE_NOT_FOUND');
      expect(res.message).toContain('Unable to compute a grounded');
    });
  });

  describe('Traffic Awareness & Provider Metadata Preservation', () => {
    it('distinguishes free-flow road duration from live traffic ETA (OSRM model)', async () => {
      const osrmMockRouter = new MockRouteProvider({
        isTrafficAware: false,
        distanceKm: 12.5,
        durationMinutes: 25,
      });

      const res = await lookupTravelRoute(
        { origin: 'Campus 25', destination: 'Bhubaneswar Station' },
        undefined,
        { geocoder: mockGeocoder, routeProvider: osrmMockRouter },
      );

      expect(res.status).toBe('success');
      expect(res.route?.is_traffic_aware).toBe(false);
      expect(res.route?.traffic_duration_minutes).toBeUndefined();
      expect(res.provider_info?.is_traffic_aware).toBe(false);
      expect(res.provider_info?.description).toContain('free-flow road network');
    });

    it('preserves live traffic ETA when route provider is traffic-aware (Google model)', async () => {
      const googleMockRouter = new MockRouteProvider({
        isTrafficAware: true,
        distanceKm: 13.2,
        durationMinutes: 28,
      });

      const res = await lookupTravelRoute(
        { origin: 'Campus 25', destination: 'Bhubaneswar Station' },
        undefined,
        { geocoder: mockGeocoder, routeProvider: googleMockRouter },
      );

      expect(res.status).toBe('success');
      expect(res.route?.is_traffic_aware).toBe(true);
      expect(res.route?.traffic_duration_minutes).toBe(36); // 28 + 8 in mock
      expect(res.provider_info?.is_traffic_aware).toBe(true);
    });
  });

  describe('Critical-Path Backwards Scheduling', () => {
    it('accurately models backwards critical path for a 9:30 PM train with midnight rollover', () => {
      // Departure: 2026-10-07 21:30:00+05:30
      const targetDepartureIso = '2026-10-07T21:30:00+05:30';
      const transitDuration = 25; // 25 min road duration

      const plan = calculateCriticalPathJourney(
        targetDepartureIso,
        FIXTURE_CAMPUS_25,
        FIXTURE_BBS_STATION,
        transitDuration,
        false, // not traffic aware -> adds 10m contingency = 35m effective
        { stationBufferMinutes: 45 },
      );

      expect(plan.target_departure_time).toBe('2026-10-07T21:30:00+05:30');
      // Buffer = 45m -> Arrival target: 20:45:00
      expect(plan.terminal_arrival_target).toBe('2026-10-07T20:45:00+05:30');
      // Transit = 35m -> Leave origin: 20:10:00
      expect(plan.leave_origin_time).toBe('2026-10-07T20:10:00+05:30');
      // Dinner ends 20m before leaving (19:50) and lasts 45m (19:05 - 19:50)
      expect(plan.dinner_window?.end).toBe('2026-10-07T19:50:00+05:30');
      expect(plan.dinner_window?.start).toBe('2026-10-07T19:05:00+05:30');
      // Packing ends when dinner starts (19:05) and lasts 60m (18:05 - 19:05)
      expect(plan.packing_window?.end).toBe('2026-10-07T19:05:00+05:30');
      expect(plan.packing_window?.start).toBe('2026-10-07T18:05:00+05:30');

      // Timeline steps contain discrete entities
      expect(plan.timeline_steps).toHaveLength(5);
      expect(plan.timeline_steps.some(s => s.step.includes('Packing'))).toBe(true);
      expect(plan.timeline_steps.some(s => s.step.includes('Dinner'))).toBe(true);
      expect(plan.timeline_steps.some(s => s.step.includes('Commute'))).toBe(true);
      expect(plan.timeline_steps.some(s => s.step.includes('Platform'))).toBe(true);
      expect(plan.timeline_steps.some(s => s.step.includes('Departure'))).toBe(true);
    });

    it('uses airport buffer (default 120m) for flight terminal destinations', () => {
      const flightDepartureIso = '2026-10-08T14:00:00+05:30'; // 2:00 PM
      const transitDuration = 30;

      const plan = calculateCriticalPathJourney(
        flightDepartureIso,
        FIXTURE_SF_FERRY,
        FIXTURE_SFO_AIRPORT,
        transitDuration,
        true, // traffic aware
        { airportBufferMinutes: 120 },
      );

      expect(plan.target_departure_time).toBe('2026-10-08T14:00:00+05:30');
      // 120 min buffer -> Terminal arrival target: 12:00:00
      expect(plan.terminal_arrival_target).toBe('2026-10-08T12:00:00+05:30');
      // 30 min transit -> Leave origin: 11:30:00
      expect(plan.leave_origin_time).toBe('2026-10-08T11:30:00+05:30');
    });
  });

  describe('AI Orchestrator Tool Dispatch Integration', () => {
    it('dispatches lookup_travel_route through dispatchToolCall with grounded output', async () => {
      const mockEntities: Entity[] = [];
      const res = await dispatchToolCall(
        {
          name: 'lookup_travel_route',
          args: {
            origin: 'Ferry Building',
            destination: 'SFO Airport',
            target_departure_time: '2026-10-08T10:00:00+05:30',
          },
        },
        mockEntities,
      );

      expect(res.name).toBe('lookup_travel_route');
      expect(res.response).toBeDefined();
      // Should have resolved via OSM dynamic geocoder or mock
      if (res.response.result?.status === 'success') {
        expect(res.response.result.route).toBeDefined();
        expect(res.response.result.route.distance_km).toBeGreaterThan(0);
      }
    }, 15000);

    it('detects conflicting calendar events when read_calendar is called for the travel date', async () => {
      const conflictingEvent: Entity = {
        id: 'evt-conflicting-meeting',
        kind: EntityKind.EVENT,
        title: 'Team Sync Call',
        description: null,
        status: EntityStatus.ACTIVE,
        priority: 2,
        start_time: '2026-10-07T20:00:00+05:30',
        end_time: '2026-10-07T20:45:00+05:30',
        deadline: null,
        duration_minutes: 45,
        recurrence: null,
        canonical_tags: ['work'],
        metadata: {},
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      };

      const res = await dispatchToolCall(
        {
          name: 'read_calendar',
          args: {
            start_date: '2026-10-07',
            end_date: '2026-10-07',
          },
        },
        [conflictingEvent],
      );

      expect(res.name).toBe('read_calendar');
      expect(res.response.result).toHaveLength(1);
      expect(res.response.result[0].id).toBe('evt-conflicting-meeting');
      expect(res.response.result[0].title).toBe('Team Sync Call');
    });
  });
});

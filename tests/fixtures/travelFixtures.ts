/**
 * Travel Grounding Test Fixtures
 *
 * Dedicated test fixtures and mock providers for testing
 * travel routing, geocoding, and backwards journey scheduling.
 *
 * Keeps all test-specific locations and data out of production code.
 */

import {
  GeocodingProvider,
  ResolvedLocation,
  RouteProvider,
  RouteResult,
} from '../../services/travel/types';

// Fixture Locations
export const FIXTURE_CAMPUS_25: ResolvedLocation = {
  query: 'Campus 25',
  displayName: 'Campus 25, KIIT, Bhubaneswar, Odisha',
  lat: 20.3547,
  lon: 85.8189,
  type: 'university',
};

export const FIXTURE_BBS_STATION: ResolvedLocation = {
  query: 'Bhubaneswar Railway Station',
  displayName: 'Bhubaneswar Railway Station, Master Canteen, Odisha',
  lat: 20.2666,
  lon: 85.8437,
  type: 'station',
};

export const FIXTURE_SF_FERRY: ResolvedLocation = {
  query: 'Ferry Building',
  displayName: 'Ferry Building, San Francisco, CA',
  lat: 37.7955,
  lon: -122.3937,
  type: 'ferry_terminal',
};

export const FIXTURE_SFO_AIRPORT: ResolvedLocation = {
  query: 'SFO Airport',
  displayName: 'San Francisco International Airport, CA',
  lat: 37.6213,
  lon: -122.379,
  type: 'airport',
};

/** Mock Geocoder for deterministic testing */
export class MockGeocodingProvider implements GeocodingProvider {
  name = 'mock_geocoder';
  private locationMap: Map<string, ResolvedLocation> = new Map();

  constructor() {
    this.addLocation('campus 25', FIXTURE_CAMPUS_25);
    this.addLocation('bhubaneswar railway station', FIXTURE_BBS_STATION);
    this.addLocation('bhubaneswar station', FIXTURE_BBS_STATION);
    this.addLocation('ferry building', FIXTURE_SF_FERRY);
    this.addLocation('sfo airport', FIXTURE_SFO_AIRPORT);
  }

  addLocation(queryKey: string, loc: ResolvedLocation) {
    this.locationMap.set(queryKey.toLowerCase(), loc);
  }

  async geocode(query: string): Promise<ResolvedLocation | null> {
    const q = query.toLowerCase().trim();
    for (const [key, loc] of this.locationMap.entries()) {
      if (q.includes(key) || key.includes(q)) {
        return loc;
      }
    }
    return null;
  }
}

/** Mock Route Provider for deterministic testing */
export class MockRouteProvider implements RouteProvider {
  name = 'mock';
  isTrafficAware: boolean;
  private shouldFail: boolean;
  private distanceKm: number;
  private durationMinutes: number;

  constructor(options?: {
    isTrafficAware?: boolean;
    shouldFail?: boolean;
    distanceKm?: number;
    durationMinutes?: number;
  }) {
    this.isTrafficAware = options?.isTrafficAware ?? false;
    this.shouldFail = options?.shouldFail ?? false;
    this.distanceKm = options?.distanceKm ?? 12.8;
    this.durationMinutes = options?.durationMinutes ?? 28;
  }

  async computeRoute(
    origin: ResolvedLocation,
    destination: ResolvedLocation,
    mode: 'driving' | 'transit' | 'walking' = 'driving',
  ): Promise<RouteResult | null> {
    if (this.shouldFail) return null;

    return {
      origin,
      destination,
      distance_km: this.distanceKm,
      duration_minutes: this.durationMinutes,
      traffic_duration_minutes: this.isTrafficAware ? this.durationMinutes + 8 : undefined,
      is_traffic_aware: this.isTrafficAware,
      provider: 'mock',
      mode,
      summary: `Mock route: ${this.distanceKm} km, ~${this.durationMinutes} min`,
    };
  }
}

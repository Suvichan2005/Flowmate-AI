/**
 * Travel Grounding & Route Resolver Service
 *
 * Single travel-grounding boundary that orchestrates:
 * 1. Origin and destination location resolution
 * 2. Pluggable road route providers (Google Routes, OSRM)
 * 3. Critical-path backward journey scheduling
 *
 * Never fabricates numbers. If grounding fails, returns structured error.
 */

import { UserSettings } from '../../types';
import { defaultGeocoder } from './geocoding';
import { calculateCriticalPathJourney } from './planner';
import { GoogleRouteProvider } from './providers/googleProvider';
import { defaultOsrmProvider } from './providers/osrmProvider';
import {
  GeocodingProvider,
  RouteProvider,
  TravelLookupParams,
  TravelLookupResponse,
} from './types';

import { liveContext, privacyManager, DeviceLocationWithFreshness, LocationFreshnessTier } from '../context';
import { ResolvedLocation } from './types';

export * from './types';
export * from './geocoding';
export * from './planner';

export async function lookupTravelRoute(
  params: TravelLookupParams,
  settings?: UserSettings,
  customProviders?: {
    geocoder?: GeocodingProvider;
    routeProvider?: RouteProvider;
  },
): Promise<TravelLookupResponse> {
  // 1. Resolve Origin according to Master Architecture Cue 5-Tier Precedence Hierarchy:
  // Tier 1: Explicit Origin in Query
  // Tier 2: Fresh Live Location (acquired at request time or within <60s)
  // Tier 3: Recent Cached Observation (< 15 min old)
  // Tier 4: Configured Default Fallback (settings.home_location)
  // Tier 5: Ask User (Zero Guessing)
  let originLocation: ResolvedLocation | null = null;
  let originType: 'explicit' | 'live_location' | 'default_home' | undefined = undefined;
  let originFreshness: LocationFreshnessTier | undefined = undefined;

  const explicitOrigin = params.origin?.trim();
  const fallbackOrigin = settings?.home_location?.trim();

  if (explicitOrigin) {
    originType = 'explicit';
  } else {
    // 1b. Check Privacy Policy before accessing Live Device Location
    const privacyDecision = privacyManager.checkPermission(
      'device_location',
      'read',
      settings?.privacy_preferences,
    );

    let liveReading: DeviceLocationWithFreshness | null = null;

    if (privacyDecision.permitted) {
      if (params.live_location) {
        liveReading = liveContext.withFreshness(params.live_location);
      } else {
        // Authoritative request-time fresh acquisition
        liveReading = await liveContext.acquireLocation({
          forceFresh: true,
          reason: `Calculate grounded travel route to ${params.destination}`,
        });
      }

      if (liveReading) {
        privacyManager.recordAccess(
          'device_location',
          'read',
          `Calculate grounded travel route to ${params.destination}`,
          settings?.privacy_preferences,
        );
      }
    }

    if (liveReading && (liveReading.freshnessTier === 'fresh' || liveReading.freshnessTier === 'recent')) {
      originType = 'live_location';
      originFreshness = liveReading.freshnessTier;
      originLocation = {
        query: 'Current Location',
        displayName: liveReading.displayName || `Current Location (${liveReading.lat.toFixed(4)}, ${liveReading.lon.toFixed(4)})`,
        lat: liveReading.lat,
        lon: liveReading.lon,
        type: 'live_device_location',
      };
    } else if (fallbackOrigin) {
      // Tier 4: Configured Default Fallback (never masquerades as current location)
      originType = 'default_home';
    } else {
      // Tier 5: Ask User (Zero Guessing)
      return {
        status: 'error',
        code: 'MISSING_ORIGIN',
        message:
          'Starting origin is required to calculate travel routes. Please specify your departure location or grant location permission.',
      };
    }
  }

  const effectiveDestination = params.destination?.trim();
  if (!effectiveDestination) {
    return {
      status: 'error',
      code: 'LOCATION_NOT_FOUND',
      unresolved: ['destination'],
      message: 'Destination location must be provided.',
    };
  }

  // 2. Geocode Origin & Destination
  const geocoder = customProviders?.geocoder || defaultGeocoder;
  const unresolved: string[] = [];

  const [resolvedOrigin, destLocation] = await Promise.all([
    originLocation ? Promise.resolve(originLocation) : geocoder.geocode(explicitOrigin || fallbackOrigin!),
    geocoder.geocode(effectiveDestination),
  ]);

  originLocation = resolvedOrigin;

  if (!originLocation) unresolved.push(`origin: "${explicitOrigin || fallbackOrigin}"`);
  if (!destLocation) unresolved.push(`destination: "${effectiveDestination}"`);

  if (unresolved.length > 0) {
    return {
      status: 'error',
      code: 'LOCATION_NOT_FOUND',
      unresolved,
      message: `Could not resolve geographic coordinates for: ${unresolved.join(', ')}.`,
    };
  }

  // 3. Route Provider Selection & Execution
  let routeProvider = customProviders?.routeProvider;
  if (!routeProvider) {
    const googleKey = settings?.travel_preferences?.google_maps_api_key;
    if (googleKey) {
      routeProvider = new GoogleRouteProvider(googleKey);
    } else {
      routeProvider = defaultOsrmProvider;
    }
  }

  const mode = params.mode || settings?.travel_preferences?.default_transit_mode || 'driving';
  const route = await routeProvider.computeRoute(originLocation, destLocation!, mode);

  if (!route) {
    return {
      status: 'error',
      code: 'ROUTE_NOT_FOUND',
      message: `Unable to compute a grounded ${mode} route between "${originLocation.displayName}" and "${destLocation!.displayName}".`,
    };
  }

  // 4. Critical Path Backwards Scheduling (if departure time requested)
  let criticalPath = undefined;
  if (params.target_departure_time) {
    try {
      criticalPath = calculateCriticalPathJourney(
        params.target_departure_time,
        originLocation,
        destLocation!,
        route.duration_minutes,
        route.is_traffic_aware,
        {
          stationBufferMinutes:
            params.station_buffer_minutes ??
            settings?.travel_preferences?.station_buffer_minutes,
          airportBufferMinutes:
            params.airport_buffer_minutes ??
            settings?.travel_preferences?.airport_buffer_minutes,
        },
      );
    } catch (err: any) {
      console.warn('[lookupTravelRoute] Critical path calculation failed:', err);
    }
  }

  return {
    status: 'success',
    route,
    critical_path: criticalPath,
    origin_type: originType,
    origin_freshness: originFreshness,
    provider_info: {
      provider: route.provider,
      is_traffic_aware: route.is_traffic_aware,
      description: route.is_traffic_aware
        ? 'Live traffic-aware ETA from Google Routes.'
        : 'OpenStreetMap OSRM free-flow road network duration. Live traffic conditions are not included.',
    },
  };
}

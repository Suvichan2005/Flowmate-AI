/**
 * Google Routes API Route Provider
 *
 * Provides traffic-aware routing using Google Maps Routes API v2
 * when an API key is explicitly configured in settings.
 */

import { ResolvedLocation, RouteProvider, RouteResult } from '../types';

export class GoogleRouteProvider implements RouteProvider {
  name = 'google_routes';
  isTrafficAware = true;

  constructor(private apiKey: string) {}

  async computeRoute(
    origin: ResolvedLocation,
    destination: ResolvedLocation,
    mode: 'driving' | 'transit' | 'walking' = 'driving'
  ): Promise<RouteResult | null> {
    if (!this.apiKey) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    try {
      const travelMode = mode === 'transit' ? 'TRANSIT' : mode === 'walking' ? 'WALK' : 'DRIVE';
      const body: any = {
        origin: {
          location: {
            latLng: { latitude: origin.lat, longitude: origin.lon },
          },
        },
        destination: {
          location: {
            latLng: { latitude: destination.lat, longitude: destination.lon },
          },
        },
        travelMode,
      };

      if (travelMode === 'DRIVE') {
        body.routingPreference = 'TRAFFIC_AWARE';
      }

      const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const data = await res.json();
      if (!data.routes || !data.routes[0]) return null;

      const route = data.routes[0];
      const distance_km = Math.round(((route.distanceMeters || 0) / 1000) * 10) / 10;
      const durationSec = parseInt(route.duration?.replace('s', '') || '0', 10);
      const duration_minutes = Math.round(durationSec / 60);

      return {
        origin,
        destination,
        distance_km,
        duration_minutes,
        traffic_duration_minutes: duration_minutes,
        is_traffic_aware: true,
        provider: 'google_routes',
        mode,
        summary: `Calculated via Google Routes API: ${distance_km} km, ~${duration_minutes} min with live traffic.`,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('[GoogleRouteProvider] Route computation failed:', err);
      return null;
    }
  }
}

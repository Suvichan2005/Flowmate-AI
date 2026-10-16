/**
 * Open Source Routing Machine (OSRM) Route Provider
 *
 * Computes road distance and free-flow duration using the public OSRM API.
 * Explicitly marks isTrafficAware = false so the system never claims
 * this represents live traffic conditions.
 */

import { ResolvedLocation, RouteProvider, RouteResult } from '../types';

export class OsrmRouteProvider implements RouteProvider {
  name = 'osrm';
  isTrafficAware = false;

  async computeRoute(
    origin: ResolvedLocation,
    destination: ResolvedLocation,
    mode: 'driving' | 'transit' | 'walking' = 'driving'
  ): Promise<RouteResult | null> {
    const osrmProfile = mode === 'walking' ? 'foot' : 'driving';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    try {
      const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const data = await res.json();
      if (!data.routes || !data.routes[0]) return null;

      const route = data.routes[0];
      const distance_km = Math.round((route.distance / 1000) * 10) / 10;
      const duration_minutes = Math.round(route.duration / 60);

      return {
        origin,
        destination,
        distance_km,
        duration_minutes,
        traffic_duration_minutes: undefined, // OSRM does NOT provide live traffic
        is_traffic_aware: false,
        provider: 'osrm',
        mode,
        summary: `Calculated via OpenStreetMap OSRM: ${distance_km} km, ~${duration_minutes} min road duration (free-flow road network; not live traffic-aware).`,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('[OsrmRouteProvider] Route computation failed:', err);
      return null;
    }
  }
}

export const defaultOsrmProvider = new OsrmRouteProvider();

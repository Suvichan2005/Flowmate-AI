/**
 * Dynamic Location Resolution & Geocoding
 *
 * Uses open-standard geocoding (Photon + Nominatim OpenStreetMap)
 * to resolve arbitrary worldwide place names, campuses, addresses,
 * stations, and airports to geographic coordinates.
 *
 * No hardcoded place tables or city dictionaries.
 */

import { GeocodingProvider, ResolvedLocation } from './types';

// In-memory cache to prevent redundant network requests
const geocodeCache = new Map<string, ResolvedLocation>();

export class OpenStreetMapGeocodingProvider implements GeocodingProvider {
  name = 'osm_dynamic_geocoder';

  async geocode(query: string): Promise<ResolvedLocation | null> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return null;

    const cacheKey = cleanQuery.toLowerCase();
    if (geocodeCache.has(cacheKey)) {
      return geocodeCache.get(cacheKey)!;
    }

    // Attempt 1: Photon OpenStreetMap Geocoder (Fast, CORS-friendly, no API key)
    try {
      const photonRes = await this.queryPhoton(cleanQuery);
      if (photonRes) {
        geocodeCache.set(cacheKey, photonRes);
        return photonRes;
      }
    } catch (err) {
      console.warn('[Geocoding] Photon query failed, attempting Nominatim fallback:', err);
    }

    // Attempt 2: Nominatim OpenStreetMap Geocoder
    try {
      const nominatimRes = await this.queryNominatim(cleanQuery);
      if (nominatimRes) {
        geocodeCache.set(cacheKey, nominatimRes);
        return nominatimRes;
      }
    } catch (err) {
      console.warn('[Geocoding] Nominatim query failed:', err);
    }

    return null;
  }

  private async queryPhoton(query: string): Promise<ResolvedLocation | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const data = await res.json();
      const feature = data.features?.[0];
      if (!feature || !feature.geometry?.coordinates) return null;

      const [lon, lat] = feature.geometry.coordinates;
      const props = feature.properties || {};
      const nameParts = [props.name, props.city, props.state, props.country].filter(Boolean);
      const displayName = nameParts.length > 0 ? nameParts.join(', ') : query;

      return {
        query,
        displayName,
        lat,
        lon,
        type: props.type || props.osm_value,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      return null;
    }
  }

  private async queryNominatim(query: string): Promise<ResolvedLocation | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        query,
      )}&format=json&limit=1`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Flowmate-Personal-Productivity-App/3.0',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const data = await res.json();
      const item = data[0];
      if (!item || !item.lat || !item.lon) return null;

      return {
        query,
        displayName: item.display_name || query,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
        placeId: String(item.place_id || ''),
        type: item.type,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      return null;
    }
  }
}

export const defaultGeocoder = new OpenStreetMapGeocodingProvider();

/** Helper for tests to clear or pre-populate the geocode cache */
export function __test_clearGeocodeCache(): void {
  geocodeCache.clear();
}

export function __test_setGeocodeCache(key: string, location: ResolvedLocation): void {
  geocodeCache.set(key.trim().toLowerCase(), location);
}

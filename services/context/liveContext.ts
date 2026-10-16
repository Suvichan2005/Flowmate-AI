/**
 * Live Context Engine — Generic Live Context Abstraction (P1-08)
 *
 * Manages transient, permission-based device context (geolocation,
 * device sensors, live environment).
 *
 * Architectural Guarantees:
 * 1. Current location means current:
 *    - Explicit 3-tier freshness model:
 *      * 'fresh': acquired < 60 seconds ago
 *      * 'recent': cached observation < 15 minutes ago
 *      * 'stale': observation >= 15 minutes ago
 *    - On-demand acquisition queries platform location port at request time when freshness is required.
 * 2. Fully Decoupled & Platform Independent (P1-08):
 *    - Interacts exclusively with LocationPort.
 *    - Zero browser/DOM globals (`navigator.geolocation`, `navigator.permissions`).
 * 3. Decoupled Reverse Geocoding:
 *    - Raw sensor readings produce coordinates + accuracy + timestamp.
 *    - Reverse geocoding executes purely on-demand when textual display is requested.
 * 4. Ephemeral Runtime State:
 *    - Never written to persistent storage, Firestore profile, or local settings without explicit user command.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import {
  AcquireLocationOptions,
  DeviceLocationReading,
  DeviceLocationWithFreshness,
  GeolocationPermissionState,
  LOCATION_FRESHNESS_FRESH_MS,
  LOCATION_FRESHNESS_RECENT_MS,
  LocationFreshnessTier,
} from './types';
import { LocationPort } from '../platform/ports';
import { getPlatform } from '../platform/registry';

export class LiveContextManager {
  private lastReading: DeviceLocationReading | null = null;
  private mockReading: DeviceLocationReading | null = null;
  private reverseGeoCache: Map<string, string> = new Map();
  private locationPort?: LocationPort;

  constructor(locationPort?: LocationPort) {
    this.locationPort = locationPort;
  }

  /**
   * Resolves the active LocationPort (injected or platform default).
   */
  private getLocationPort(): LocationPort {
    return this.locationPort ?? getPlatform().location;
  }

  /**
   * Injects a custom LocationPort (for testing or specialized hosts).
   */
  setLocationPort(port: LocationPort): void {
    this.locationPort = port;
  }

  /**
   * Evaluates the freshness tier of a reading based on its timestamp.
   */
  calculateFreshnessTier(timestamp: number, now: number = Date.now()): LocationFreshnessTier {
    const ageMs = Math.max(0, now - timestamp);
    if (ageMs <= LOCATION_FRESHNESS_FRESH_MS) {
      return 'fresh';
    }
    if (ageMs <= LOCATION_FRESHNESS_RECENT_MS) {
      return 'recent';
    }
    return 'stale';
  }

  /**
   * Attaches freshness metadata and age to a raw device reading.
   */
  withFreshness(reading: DeviceLocationReading, now: number = Date.now()): DeviceLocationWithFreshness {
    const ageMs = Math.max(0, now - reading.timestamp);
    return {
      ...reading,
      freshnessTier: this.calculateFreshnessTier(reading.timestamp, now),
      ageMs,
    };
  }

  /**
   * Checks current permission state for geolocation via LocationPort.
   */
  async checkPermission(): Promise<GeolocationPermissionState> {
    return this.getLocationPort().checkPermission();
  }

  /**
   * Acquires device location according to requested freshness options.
   *
   * If forceFresh is true, attempts a fresh device reading at request time
   * unless the cached reading is already within the fresh threshold (< 60s).
   * If fresh acquisition fails (timeout/temporary error), falls back to a recent
   * cached observation if available (< 15m), labeled with its actual freshness tier.
   */
  async acquireLocation(options?: AcquireLocationOptions): Promise<DeviceLocationWithFreshness | null> {
    const now = Date.now();

    // 1. Mock override for testing and offline development
    if (this.mockReading) {
      return this.withFreshness(this.mockReading, now);
    }

    const forceFresh = options?.forceFresh ?? false;
    const maxAcceptableAge = options?.maxAgeMs ?? (forceFresh ? LOCATION_FRESHNESS_FRESH_MS : LOCATION_FRESHNESS_RECENT_MS);

    // 2. Check existing cache
    if (this.lastReading) {
      const ageMs = now - this.lastReading.timestamp;
      if (ageMs <= maxAcceptableAge) {
        return this.withFreshness(this.lastReading, now);
      }
    }

    // 3. Acquire fresh position from location port
    const freshReading = await this.readDevicePosition(
      options?.timeoutMs ?? 6000,
      options?.highAccuracy ?? true,
    );

    if (freshReading) {
      this.lastReading = freshReading;
      return this.withFreshness(freshReading, Date.now());
    }

    // 4. If fresh acquisition failed, check if we have a recent cached observation
    if (this.lastReading) {
      const fallbackAge = Date.now() - this.lastReading.timestamp;
      if (fallbackAge <= LOCATION_FRESHNESS_RECENT_MS) {
        return this.withFreshness(this.lastReading, Date.now());
      }
    }

    return null;
  }

  /**
   * On-demand reverse geocoding. Decoupled from raw coordinate acquisition.
   * Queries Photon/Komoot with a 3.5-second timeout and internal coordinate cache.
   */
  async reverseGeocode(lat: number, lon: number): Promise<string> {
    const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (this.reverseGeoCache.has(cacheKey)) {
      return this.reverseGeoCache.get(cacheKey)!;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    try {
      const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const props = data.features?.[0]?.properties;
        if (props) {
          const parts = [
            props.name,
            props.district || props.city,
            props.state,
          ].filter(Boolean);
          if (parts.length > 0) {
            const formatted = parts.join(', ');
            this.reverseGeoCache.set(cacheKey, formatted);
            return formatted;
          }
        }
      }
    } catch {
      clearTimeout(timeoutId);
    }

    const fallback = `${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`;
    this.reverseGeoCache.set(cacheKey, fallback);
    return fallback;
  }

  /**
   * Attaches human-readable displayName to a location reading on demand.
   */
  async resolveDisplayName(loc: DeviceLocationWithFreshness): Promise<DeviceLocationWithFreshness> {
    if (loc.displayName) return loc;
    const name = await this.reverseGeocode(loc.lat, loc.lon);
    return {
      ...loc,
      displayName: name,
    };
  }

  /**
   * Inspects the latest cached reading with its current freshness tier, if any exists.
   */
  getLastReading(): DeviceLocationWithFreshness | null {
    if (this.mockReading) {
      return this.withFreshness(this.mockReading);
    }
    return this.lastReading ? this.withFreshness(this.lastReading) : null;
  }

  /**
   * Generates a generic, concise live context summary for LLM context prompts.
   */
  async buildLiveContextSummary(includeReverseGeo = false): Promise<string | null> {
    const reading = this.getLastReading();
    if (!reading) return null;

    let text = `Coordinates: ${reading.lat.toFixed(4)}°N, ${reading.lon.toFixed(4)}°E (${reading.freshnessTier}, ±${Math.round(reading.accuracy_meters)}m)`;
    if (includeReverseGeo) {
      const place = await this.reverseGeocode(reading.lat, reading.lon);
      text += ` near ${place}`;
    }
    return text;
  }

  /**
   * Clears transient in-memory location observations and mocks.
   */
  clearCache(): void {
    this.lastReading = null;
    this.mockReading = null;
    this.reverseGeoCache.clear();
  }

  /**
   * Injects mock reading for tests and offline development.
   */
  setMockLocation(loc: DeviceLocationReading | null): void {
    this.mockReading = loc;
  }

  /**
   * Private helper to read hardware position via LocationPort.
   */
  private async readDevicePosition(
    timeoutMs: number,
    highAccuracy: boolean,
  ): Promise<DeviceLocationReading | null> {
    const reading = await this.getLocationPort().getCurrentPosition({
      timeoutMs,
      highAccuracy,
    });
    if (!reading) {
      return null;
    }
    return {
      lat: reading.lat,
      lon: reading.lon,
      accuracy_meters: reading.accuracy_meters,
      timestamp: reading.timestamp,
      source: reading.source,
    };
  }
}

export const liveContext = new LiveContextManager();

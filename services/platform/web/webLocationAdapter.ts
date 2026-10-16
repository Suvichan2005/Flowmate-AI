/**
 * Flowmate Web Platform — Location Adapter (P1-08)
 *
 * Implements LocationPort using HTML5 Geolocation and Permissions API.
 * Encapsulates all browser/DOM geolocation concerns away from Flowmate Core.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import {
  LocationPort,
  PlatformPermissionState,
  PlatformLocationReading,
  LocationRequestOptions,
} from '../ports';

export class WebLocationAdapter implements LocationPort {
  async checkPermission(): Promise<PlatformPermissionState> {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return 'unsupported';
    }

    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      try {
        // Use type-safe descriptor without 'any'
        const status = await navigator.permissions.query({
          name: 'geolocation' as PermissionName,
        });
        if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
          return status.state;
        }
        return 'prompt';
      } catch {
        // Fallback for browsers that throw on geolocation query
        return 'prompt';
      }
    }

    return 'prompt';
  }

  async getCurrentPosition(options?: LocationRequestOptions): Promise<PlatformLocationReading | null> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return null;
    }

    const timeoutMs = options?.timeoutMs ?? 6000;
    const highAccuracy = options?.highAccuracy ?? true;

    return new Promise(resolve => {
      let isSettled = false;
      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          resolve(null);
        }
      }, timeoutMs);

      navigator.geolocation.getCurrentPosition(
        position => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(timer);

          resolve({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy_meters: position.coords.accuracy || 10,
            timestamp: position.timestamp || Date.now(),
            source: 'device',
          });
        },
        _err => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(timer);
          resolve(null);
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: timeoutMs,
          maximumAge: 0,
        },
      );
    });
  }
}

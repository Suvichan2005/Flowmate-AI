/**
 * Live Context Domain Types
 *
 * Ephemeral, permission-based real-time context (device location,
 * time, session environment). Never stored as permanent user memory.
 */

export const LOCATION_FRESHNESS_FRESH_MS = 60 * 1000; // 60 seconds (fresh acquisition)
export const LOCATION_FRESHNESS_RECENT_MS = 15 * 60 * 1000; // 15 minutes (recent cached observation)

export type LocationFreshnessTier = 'fresh' | 'recent' | 'stale';

export interface DeviceLocationReading {
  lat: number;
  lon: number;
  accuracy_meters: number;
  timestamp: number; // Unix epoch ms
  source: 'device' | 'mock' | 'network' | 'ip' | 'cache';
}

export interface DeviceLocationWithFreshness extends DeviceLocationReading {
  freshnessTier: LocationFreshnessTier;
  ageMs: number;
  displayName?: string; // Optional human-readable place description (populated only on-demand)
}

export type GeolocationPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

export type PrivacyPermissionMode = 'allow' | 'ask' | 'deny';

export interface CapabilityPermissionConfig {
  read: PrivacyPermissionMode;
  mutation: PrivacyPermissionMode;
  revoked?: boolean;
}

export interface PrivacyPolicySettings {
  capabilities: {
    device_location: CapabilityPermissionConfig;
    google_calendar?: CapabilityPermissionConfig;
    gmail?: CapabilityPermissionConfig;
    contacts?: CapabilityPermissionConfig;
    cloud_files?: CapabilityPermissionConfig;
  };
  audit_logging_enabled: boolean;
}

export type ContextCapabilityId =
  | 'device_location'
  | 'google_calendar'
  | 'gmail'
  | 'contacts'
  | 'cloud_files';

export interface SensitiveAccessLogEntry {
  id: string;
  capabilityId: ContextCapabilityId;
  action: 'read' | 'write';
  timestamp: number;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface AcquireLocationOptions {
  /** If true, attempts a fresh device reading at request time rather than returning a cached recent observation */
  forceFresh?: boolean;
  /** Maximum acceptable age in milliseconds (default: 60s if forceFresh, else 15m) */
  maxAgeMs?: number;
  /** Geolocation request timeout in milliseconds (default: 5000ms) */
  timeoutMs?: number;
  /** Whether to request high accuracy GPS (default: true) */
  highAccuracy?: boolean;
  /** Purpose/reason for accessing device location for transparent auditing */
  reason?: string;
}

export interface LiveContextState {
  lastReading: DeviceLocationWithFreshness | null;
  permission: GeolocationPermissionState;
  lastAcquired: number | null;
  accessLogs: SensitiveAccessLogEntry[];
}

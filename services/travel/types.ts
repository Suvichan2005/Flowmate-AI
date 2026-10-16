/**
 * Travel & Grounded Route Domain Types
 */

export interface ResolvedLocation {
  query: string;
  displayName: string;
  lat: number;
  lon: number;
  placeId?: string;
  type?: string;
}

export interface GeocodingProvider {
  name: string;
  geocode(query: string): Promise<ResolvedLocation | null>;
}

export interface RouteResult {
  origin: ResolvedLocation;
  destination: ResolvedLocation;
  distance_km: number;
  duration_minutes: number; // base road duration
  traffic_duration_minutes?: number; // defined only if is_traffic_aware is true
  is_traffic_aware: boolean;
  provider: 'google_routes' | 'osrm' | 'mock';
  mode: 'driving' | 'transit' | 'walking';
  summary?: string;
}

export interface RouteProvider {
  name: string;
  isTrafficAware: boolean;
  computeRoute(
    origin: ResolvedLocation,
    destination: ResolvedLocation,
    mode: 'driving' | 'transit' | 'walking'
  ): Promise<RouteResult | null>;
}

export interface CriticalPathStep {
  step: string;
  start: string; // ISO 8601 (+05:30)
  end?: string; // ISO 8601 (+05:30)
  duration_minutes?: number;
  description: string;
  entity_kind: 'EVT' | 'TSK';
}

export interface JourneyCriticalPath {
  target_departure_time: string;          // ISO 8601
  terminal_arrival_target: string;        // ISO 8601
  leave_origin_time: string;              // ISO 8601
  transit_duration_minutes: number;
  terminal_buffer_minutes: number;
  dinner_window?: {
    start: string;
    end: string;
    duration_minutes: number;
  };
  packing_window?: {
    start: string;
    end: string;
    duration_minutes: number;
  };
  timeline_steps: CriticalPathStep[];
}

import { DeviceLocationReading, LocationFreshnessTier } from '../context/types';

export interface TravelLookupParams {
  origin?: string;
  destination: string;
  mode?: 'driving' | 'transit' | 'walking';
  target_departure_time?: string; // ISO 8601 string of train/flight departure
  station_buffer_minutes?: number;
  airport_buffer_minutes?: number;
  live_location?: DeviceLocationReading;
}

export type TravelErrorCode =
  | 'MISSING_ORIGIN'
  | 'LOCATION_NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'PROVIDER_UNAVAILABLE';

export interface TravelLookupResponse {
  status: 'success' | 'error';
  code?: TravelErrorCode;
  message?: string;
  route?: RouteResult;
  critical_path?: JourneyCriticalPath;
  unresolved?: string[];
  origin_type?: 'explicit' | 'live_location' | 'default_home';
  origin_freshness?: LocationFreshnessTier;
  provider_info?: {
    provider: string;
    is_traffic_aware: boolean;
    description: string;
  };
}

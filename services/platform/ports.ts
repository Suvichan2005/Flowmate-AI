/**
 * Flowmate Greenfield Platform Core — Port Contracts (P1-08)
 *
 * Defines platform-agnostic contracts for hardware, OS capabilities,
 * notifications, geolocation, and user identity.
 *
 * Flowmate Core (Kernel, Context Engine, AI) interacts with the host
 * environment exclusively through these interfaces.
 *
 * STRICT INVARIANT: ZERO `any`
 */

export type PlatformPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

export interface PlatformLocationReading {
  readonly lat: number;
  readonly lon: number;
  readonly accuracy_meters: number;
  readonly timestamp: number;
  readonly source: 'device' | 'network' | 'ip' | 'cache';
}

export interface LocationRequestOptions {
  readonly timeoutMs?: number;
  readonly highAccuracy?: boolean;
}

/**
 * Platform Location Port
 * Provides access to host geolocation hardware and permission status.
 */
export interface LocationPort {
  checkPermission(): Promise<PlatformPermissionState>;
  requestPermission?(): Promise<PlatformPermissionState>;
  getCurrentPosition(options?: LocationRequestOptions): Promise<PlatformLocationReading | null>;
}

export interface PlatformNotificationPayload {
  readonly id: string | number;
  readonly title: string;
  readonly body: string;
  readonly scheduledAt?: Date | string;
  readonly tag?: string;
  readonly extra?: Record<string, unknown>;
}

/**
 * Platform Notification Port
 * Provides access to host notification system and scheduling.
 */
export interface NotificationPort {
  checkPermission(): Promise<PlatformPermissionState>;
  requestPermission(): Promise<boolean>;
  schedule(notification: PlatformNotificationPayload): Promise<boolean>;
  cancel(id: string | number): Promise<void>;
  cancelAll(): Promise<void>;
  getPending?(): Promise<Array<{ id: string | number }>>;
}

export type HapticImpactStyle = 'light' | 'medium' | 'heavy';
export type HapticNotificationType = 'success' | 'warning' | 'error';

/**
 * Platform Haptics Port
 * Provides tactile feedback on supported devices.
 */
export interface HapticsPort {
  impact(style?: HapticImpactStyle): Promise<void>;
  notification(type?: HapticNotificationType): Promise<void>;
  selectionClick(): Promise<void>;
}

/**
 * Platform-Neutral User Identity
 * Decouples Flowmate store from Firebase Auth SDK `User` class.
 */
export interface AuthenticatedIdentity {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly photoURL: string | null;
  readonly providerId?: string;
}

/**
 * Platform Capabilities Matrix
 * Describes the hardware and OS capabilities available in the current environment.
 */
export interface PlatformCapabilities {
  readonly hasGeolocation: boolean;
  readonly hasNotifications: boolean;
  readonly hasHaptics: boolean;
  readonly hasAudioInput: boolean;
  readonly isOnline: boolean;
  readonly platformName: 'web' | 'node' | 'desktop' | 'mobile';
}

/**
 * Aggregate Platform Provider
 */
export interface PlatformPort {
  readonly location: LocationPort;
  readonly notifications: NotificationPort;
  readonly haptics: HapticsPort;
  getCapabilities(): PlatformCapabilities;
}

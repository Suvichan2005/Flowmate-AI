/**
 * Flowmate Greenfield Platform Core — Port Contracts (P1-08)
 *
 * Defines platform-agnostic contracts for notifications, haptics,
 * browser capabilities, and user identity.
 *
 * Flowmate Core (Kernel, Context Engine, AI) interacts with the host
 * environment exclusively through these interfaces.
 *
 * STRICT INVARIANT: ZERO `any`
 */

export type PlatformPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

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
  readonly notifications: NotificationPort;
  readonly haptics: HapticsPort;
  getCapabilities(): PlatformCapabilities;
}

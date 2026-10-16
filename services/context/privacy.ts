/**
 * Flowmate Privacy & Capability Access Layer
 *
 * Core architectural boundary that regulates access to all sensitive
 * context sources (device location, external calendar, email, contacts, files).
 *
 * Architectural Guarantees:
 * 1. Reusable & Extensible: Not hardcoded to location; location is the first consumer.
 * 2. Separation of Concerns: READ (access) and WRITE (mutation) are strictly distinct.
 * 3. Policy Enforcement: Respects 'allow', 'ask', 'deny', and revocation.
 * 4. Transparent Auditability: Maintains lightweight access log with purpose/timestamp,
 *    without storing sensitive payloads.
 */

import {
  ContextCapabilityId,
  PrivacyPolicySettings,
  PrivacyPermissionMode,
  SensitiveAccessLogEntry,
} from './types';

export type CapabilityAction = 'read' | 'write';

export interface PrivacyAccessDecision {
  permitted: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

export const DEFAULT_PRIVACY_POLICY: PrivacyPolicySettings = {
  capabilities: {
    device_location: {
      read: 'ask',       // Prompt user or query on-demand
      mutation: 'deny',  // Location is purely read-only sensor data
    },
  },
  audit_logging_enabled: true,
};

export class PrivacyManager {
  private accessLogs: SensitiveAccessLogEntry[] = [];

  /**
   * Evaluates whether an action is permitted for a capability according to user policy.
   */
  checkPermission(
    capabilityId: ContextCapabilityId,
    action: CapabilityAction,
    policy?: PrivacyPolicySettings,
  ): PrivacyAccessDecision {
    const activePolicy = policy || DEFAULT_PRIVACY_POLICY;
    const config = activePolicy.capabilities[capabilityId];

    if (!config) {
      // Unconfigured future capabilities default to deny for safety
      return {
        permitted: false,
        reason: `Capability '${capabilityId}' is not configured or available.`,
      };
    }

    if (config.revoked) {
      return {
        permitted: false,
        reason: `Access to '${capabilityId}' has been revoked by user policy.`,
      };
    }

    const mode: PrivacyPermissionMode = action === 'read' ? config.read : config.mutation;

    switch (mode) {
      case 'deny':
        return {
          permitted: false,
          reason: `${action === 'read' ? 'Read' : 'Mutation'} access to '${capabilityId}' is denied by privacy policy.`,
        };
      case 'ask':
        return {
          permitted: true,
          requiresConfirmation: true,
        };
      case 'allow':
        return {
          permitted: true,
          requiresConfirmation: false,
        };
      default:
        return {
          permitted: false,
          reason: `Invalid privacy mode for '${capabilityId}'.`,
        };
    }
  }

  /**
   * Records a sensitive context access for transparent auditing.
   */
  recordAccess(
    capabilityId: ContextCapabilityId,
    action: CapabilityAction,
    purpose: string,
    policy?: PrivacyPolicySettings,
  ): void {
    const activePolicy = policy || DEFAULT_PRIVACY_POLICY;
    if (activePolicy.audit_logging_enabled === false) {
      return;
    }

    const entry: SensitiveAccessLogEntry = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      capabilityId,
      action,
      timestamp: Date.now(),
      reason: purpose,
    };

    this.accessLogs.unshift(entry);
    // Keep most recent 50 entries
    if (this.accessLogs.length > 50) {
      this.accessLogs = this.accessLogs.slice(0, 50);
    }
  }

  /**
   * Retrieves the most recent sensitive access log entries.
   */
  getAccessLogs(limit: number = 10): SensitiveAccessLogEntry[] {
    return this.accessLogs.slice(0, limit);
  }

  /**
   * Clears the in-memory sensitive access logs.
   */
  clearAccessLogs(): void {
    this.accessLogs = [];
  }

  clearLogs(): void {
    this.clearAccessLogs();
  }
}

export const privacyManager = new PrivacyManager();

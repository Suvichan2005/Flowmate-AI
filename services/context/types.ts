export type PrivacyPermissionMode = 'allow' | 'ask' | 'deny';

export interface CapabilityPermissionConfig {
  read: PrivacyPermissionMode;
  mutation: PrivacyPermissionMode;
  revoked?: boolean;
}

export interface PrivacyPolicySettings {
  capabilities: {
    google_calendar?: CapabilityPermissionConfig;
    gmail?: CapabilityPermissionConfig;
    contacts?: CapabilityPermissionConfig;
    cloud_files?: CapabilityPermissionConfig;
  };
  audit_logging_enabled: boolean;
}

export type ContextCapabilityId =
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

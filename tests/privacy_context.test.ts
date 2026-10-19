import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIVACY_POLICY,
  PrivacyManager,
  type PrivacyPolicySettings,
} from '../services/context';

describe('Privacy & Context Access Policy', () => {
  it('denies access to unconfigured capabilities by default', () => {
    const manager = new PrivacyManager();
    expect(manager.checkPermission('google_calendar', 'read').permitted).toBe(false);
    expect(manager.checkPermission('google_calendar', 'write').permitted).toBe(false);
  });

  it('keeps read and mutation permissions separate', () => {
    const manager = new PrivacyManager();
    const policy: PrivacyPolicySettings = {
      capabilities: { google_calendar: { read: 'allow', mutation: 'ask' } },
      audit_logging_enabled: true,
    };

    expect(manager.checkPermission('google_calendar', 'read', policy)).toMatchObject({
      permitted: true,
      requiresConfirmation: false,
    });
    expect(manager.checkPermission('google_calendar', 'write', policy)).toMatchObject({
      permitted: true,
      requiresConfirmation: true,
    });
  });

  it('honors denial and revocation', () => {
    const manager = new PrivacyManager();
    const denied: PrivacyPolicySettings = {
      capabilities: { gmail: { read: 'deny', mutation: 'deny' } },
      audit_logging_enabled: true,
    };
    const revoked: PrivacyPolicySettings = {
      capabilities: { gmail: { read: 'allow', mutation: 'deny', revoked: true } },
      audit_logging_enabled: true,
    };

    expect(manager.checkPermission('gmail', 'read', denied).reason).toContain('denied by privacy policy');
    expect(manager.checkPermission('gmail', 'read', revoked).reason).toContain('revoked by user policy');
  });

  it('records purpose without storing payloads and respects audit opt-out', () => {
    const manager = new PrivacyManager();
    manager.recordAccess('google_calendar', 'read', 'Refresh calendar events');
    expect(manager.getAccessLogs()).toMatchObject([{ capabilityId: 'google_calendar', reason: 'Refresh calendar events' }]);

    manager.recordAccess('gmail', 'read', 'Should not be recorded', {
      ...DEFAULT_PRIVACY_POLICY,
      audit_logging_enabled: false,
    });
    expect(manager.getAccessLogs()).toHaveLength(1);
    manager.clearAccessLogs();
    expect(manager.getAccessLogs()).toHaveLength(0);
  });
});

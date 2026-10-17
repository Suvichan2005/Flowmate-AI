import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasWorkspaceCloudSyncConsent, setWorkspaceCloudSyncConsentForUser, subscribeToWorkspaceCloudSyncConsent } from '../services/workspaceSyncConsent';

describe('workspace cloud sync consent', () => {
  beforeEach(() => localStorage.clear());

  it('defaults off and scopes the choice to the exact account on this device', () => {
    expect(hasWorkspaceCloudSyncConsent('uid-a')).toBe(false);
    expect(setWorkspaceCloudSyncConsentForUser('uid-a', true)).toBe(true);
    expect(hasWorkspaceCloudSyncConsent('uid-a')).toBe(true);
    expect(hasWorkspaceCloudSyncConsent('uid-b')).toBe(false);
    expect(setWorkspaceCloudSyncConsentForUser('uid-a', false)).toBe(true);
    expect(hasWorkspaceCloudSyncConsent('uid-a')).toBe(false);
  });

  it('fails closed when local consent cannot be persisted', () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(setWorkspaceCloudSyncConsentForUser('uid-a', true)).toBe(false);
    expect(hasWorkspaceCloudSyncConsent('uid-a')).toBe(false);
    setItem.mockRestore();
  });

  it('fails closed when the browser denies access to local storage', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new DOMException('storage blocked', 'SecurityError'); },
    });
    try {
      expect(hasWorkspaceCloudSyncConsent('uid-a')).toBe(false);
      expect(setWorkspaceCloudSyncConsentForUser('uid-a', true)).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
      else delete (window as any).localStorage;
    }
  });

  it('observes a same-device consent revocation from another tab', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToWorkspaceCloudSyncConsent(listener);
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'flowmate:privacy:workspace-cloud:v1:uid-a',
      oldValue: 'enabled',
      newValue: null,
    }));
    expect(listener).toHaveBeenCalledWith({ uid: 'uid-a', enabled: false });
    unsubscribe();
  });
});

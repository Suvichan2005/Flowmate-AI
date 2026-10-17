const CONSENT_PREFIX = 'flowmate:privacy:workspace-cloud:v1:';
const CHANGE_EVENT = 'flowmate:workspace-sync-consent-changed';

export interface WorkspaceSyncConsentChange {
  uid: string;
  enabled: boolean;
}

const consentKey = (uid: string) => `${CONSENT_PREFIX}${encodeURIComponent(uid)}`;

/**
 * Workspace cloud sync is a separate, local per-account choice. Firebase Auth
 * alone must never imply consent, and a choice on one device does not silently
 * authorize uploads from another device.
 */
export function hasWorkspaceCloudSyncConsent(uid: string | null | undefined): boolean {
  if (!uid || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(consentKey(uid)) === 'enabled';
  } catch {
    // Storage failures fail closed: the workspace remains local on this device.
    return false;
  }
}

export function setWorkspaceCloudSyncConsentForUser(uid: string, enabled: boolean): boolean {
  if (!uid || typeof window === 'undefined') return false;
  try {
    const key = consentKey(uid);
    if (enabled) window.localStorage.setItem(key, 'enabled');
    else window.localStorage.removeItem(key);

    if (hasWorkspaceCloudSyncConsent(uid) !== enabled) return false;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<WorkspaceSyncConsentChange>(CHANGE_EVENT, {
        detail: { uid, enabled },
      }));
    }
    return true;
  } catch {
    return false;
  }
}

export function subscribeToWorkspaceCloudSyncConsent(
  listener: (change: WorkspaceSyncConsentChange) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleChange = (event: Event) => {
    const detail = (event as CustomEvent<WorkspaceSyncConsentChange>).detail;
    if (detail && typeof detail.uid === 'string' && typeof detail.enabled === 'boolean') {
      listener(detail);
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith(CONSENT_PREFIX)) return;
    try {
      listener({
        uid: decodeURIComponent(event.key.slice(CONSENT_PREFIX.length)),
        enabled: event.newValue === 'enabled',
      });
    } catch {
      // An invalid local key is ignored; consent remains fail-closed on reload.
    }
  };
  window.addEventListener(CHANGE_EVENT, handleChange);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handleChange);
    window.removeEventListener('storage', handleStorage);
  };
}

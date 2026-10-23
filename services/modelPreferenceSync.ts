import type { UserSettings } from '../types';

export const MODEL_PREFERENCE_FIELDS = [
  'preferred_model',
  'preferred_reasoning_level',
  'preferred_live_model',
  'preferred_live_reasoning_level',
] as const;

const REMOVED_LOCATION_SETTING_FIELDS = ['home_location', 'travel_preferences'] as const;

/** Remove retired location/travel preferences from legacy local or cloud settings. */
export function stripRemovedLocationSettings<T extends Record<string, unknown>>(settings: T): T {
  const sanitized = { ...settings };
  for (const key of REMOVED_LOCATION_SETTING_FIELDS) delete sanitized[key];
  const settingsRecord = sanitized as Record<string, unknown>;
  const privacy = settingsRecord.privacy_preferences;
  if (privacy && typeof privacy === 'object' && !Array.isArray(privacy)) {
    const privacyPreferences = { ...(privacy as Record<string, unknown>) };
    const capabilities = privacyPreferences.capabilities;
    if (capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)) {
      const safeCapabilities = { ...(capabilities as Record<string, unknown>) };
      delete safeCapabilities.device_location;
      privacyPreferences.capabilities = safeCapabilities;
    }
    settingsRecord.privacy_preferences = privacyPreferences;
  }
  return sanitized;
}

/** Apply synced model choices only after this account has an explicit opt-in. */
export function mergeCloudSettings(
  local: Partial<UserSettings>,
  remote: Partial<UserSettings>,
): Partial<UserSettings> {
  const merged = stripRemovedLocationSettings({ ...local, ...remote } as Partial<UserSettings> & Record<string, unknown>);
  if (remote.sync_ai_preferences !== true) {
    for (const key of MODEL_PREFERENCE_FIELDS) {
      if (local[key] !== undefined) (merged as Record<string, unknown>)[key] = local[key];
      else delete (merged as Record<string, unknown>)[key];
    }
    if (remote.sync_ai_preferences === false) merged.sync_ai_preferences = false;
  }
  return merged;
}

import type { UserSettings } from '../types';

export const MODEL_PREFERENCE_FIELDS = [
  'preferred_model',
  'preferred_reasoning_level',
  'preferred_live_model',
  'preferred_live_reasoning_level',
] as const;

/** Apply synced model choices only after this account has an explicit opt-in. */
export function mergeCloudSettings(
  local: Partial<UserSettings>,
  remote: Partial<UserSettings>,
): Partial<UserSettings> {
  const merged: Partial<UserSettings> = { ...local, ...remote };
  if (remote.sync_ai_preferences !== true) {
    for (const key of MODEL_PREFERENCE_FIELDS) {
      if (local[key] !== undefined) (merged as Record<string, unknown>)[key] = local[key];
      else delete (merged as Record<string, unknown>)[key];
    }
    if (remote.sync_ai_preferences === false) merged.sync_ai_preferences = false;
  }
  return merged;
}

import { describe, expect, it } from 'vitest';
import { mergeCloudSettings } from '../services/modelPreferenceSync';

describe('AI model preference cloud-consent boundary', () => {
  it('keeps remote model choices out when the account has not opted in', () => {
    const merged = mergeCloudSettings(
      { timezone: 'Asia/Kolkata', preferred_model: 'gemini-3.8-flash', preferred_reasoning_level: 'low' },
      { timezone: 'UTC', preferred_model: 'gemini-4-argon', preferred_reasoning_level: 'high' },
    );
    expect(merged.timezone).toBe('UTC');
    expect(merged.preferred_model).toBe('gemini-3.8-flash');
    expect(merged.preferred_reasoning_level).toBe('low');
  });

  it('restores cloud preferences only when the persisted account opt-in is true', () => {
    const merged = mergeCloudSettings(
      { preferred_model: 'gemini-3.8-flash', sync_ai_preferences: false },
      { preferred_model: 'gemini-4-argon', preferred_reasoning_level: 'high', sync_ai_preferences: true },
    );
    expect(merged.preferred_model).toBe('gemini-4-argon');
    expect(merged.preferred_reasoning_level).toBe('high');
    expect(merged.sync_ai_preferences).toBe(true);
  });

  it('retains local choices when consent is revoked remotely', () => {
    const merged = mergeCloudSettings(
      { preferred_live_model: 'gemini-3.8-live-extended-thinking', sync_ai_preferences: true },
      { preferred_model: 'gemini-3.8-flash', preferred_live_model: 'gemini-3.8-live', sync_ai_preferences: false },
    );
    expect(merged.preferred_live_model).toBe('gemini-3.8-live-extended-thinking');
    expect(merged.preferred_model).toBeUndefined();
    expect(merged.sync_ai_preferences).toBe(false);
  });
});

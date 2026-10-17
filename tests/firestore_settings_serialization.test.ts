import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserSettings } from '../types';

const mocks = vi.hoisted(() => ({
  setDoc: vi.fn(),
  deleteField: vi.fn(() => ({ firestoreSentinel: 'deleteField' })),
  serverTimestamp: vi.fn(() => ({ firestoreSentinel: 'serverTimestamp' })),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  collection: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  setDoc: mocks.setDoc,
  deleteField: mocks.deleteField,
  serverTimestamp: mocks.serverTimestamp,
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
}));
vi.mock('../services/firebase', () => ({ db: { test: true }, isFirebaseConfigured: () => true }));
vi.mock('../services/syncManager', () => ({ isDemoSyncBlocked: () => false }));
vi.mock('../services/legacySyntheticEntity', () => ({ isLegacySyntheticEntity: () => false }));

import { saveUserConfig } from '../services/firestoreSync';

describe('Firestore user settings serialization', () => {
  beforeEach(() => {
    mocks.setDoc.mockReset().mockResolvedValue(undefined);
    mocks.deleteField.mockReset().mockImplementation(() => ({ firestoreSentinel: 'deleteField' }));
  });

  it('omits undefined optional settings without changing defined values or the server timestamp', async () => {
    const settings = {
      timezone: 'Asia/Kolkata',
      preferred_model: 'gemini-3.8-flash',
      sync_enabled: true,
      sync_ai_preferences: true,
      debug_mode: false,
      feature_toggles: { food_tracking: true, attendance_tracking: true, people_tracking: true },
      home_location: undefined,
    } as unknown as Partial<UserSettings>;

    await expect(saveUserConfig('synthetic-user', { settings })).resolves.toBe(true);

    const [reference, payload, options] = mocks.setDoc.mock.calls[0] as [
      { path: string }, Record<string, unknown>, { merge: boolean },
    ];
    expect(reference.path).toBe('users/synthetic-user');
    expect(payload.settings).toEqual({
      timezone: 'Asia/Kolkata',
      preferred_model: 'gemini-3.8-flash',
      sync_enabled: true,
      sync_ai_preferences: true,
      debug_mode: false,
      feature_toggles: { food_tracking: true, attendance_tracking: true, people_tracking: true },
    });
    expect(payload.lastSyncedAt).toBe(mocks.serverTimestamp.mock.results[0]?.value);
    expect(payload.schemaVersion).toBe(2);
    expect(options).toEqual({ merge: true });
  });

  it('clears previously synced AI preferences when the user revokes cloud-sync consent', async () => {
    await expect(saveUserConfig('synthetic-user', { settings: {
      preferred_model: 'gemini-3.8-flash', sync_ai_preferences: false,
    } as unknown as Partial<UserSettings> })).resolves.toBe(true);
    const [, payload] = mocks.setDoc.mock.calls[0] as [unknown, { settings: Record<string, unknown> }];
    expect(payload.settings.preferred_model).toEqual({ firestoreSentinel: 'deleteField' });
    expect(payload.settings.sync_ai_preferences).toBe(false);
  });
});

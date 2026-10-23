import { beforeEach, describe, expect, it } from 'vitest';
import {
  asyncStorage,
  beginWorkspaceStorageIdentitySwitch,
  finishWorkspaceStorageIdentitySwitch,
  readWorkspaceStorageSnapshot,
  summarizeWorkspaceStorageSnapshot,
} from '../services/storage';

describe('identity-scoped workspace storage', () => {
  beforeEach(() => {
    localStorage.clear();
    beginWorkspaceStorageIdentitySwitch('legacy');
    finishWorkspaceStorageIdentitySwitch();
  });

  it('keeps account snapshots isolated and preserves the legacy local snapshot', async () => {
    await asyncStorage.setItem('flowmate-storage', JSON.stringify({ state: { entities: [{ id: 'local' }], messages: [], chatSessions: [] } }));
    beginWorkspaceStorageIdentitySwitch('account-a');
    expect(await asyncStorage.getItem('flowmate-storage')).toBeNull();
    await asyncStorage.setItem('flowmate-storage', JSON.stringify({ state: { entities: [{ id: 'a' }], messages: [], chatSessions: [] } }));
    finishWorkspaceStorageIdentitySwitch();

    await asyncStorage.setItem('flowmate-storage', JSON.stringify({ state: { entities: [{ id: 'a' }], messages: [], chatSessions: [] } }));
    beginWorkspaceStorageIdentitySwitch('account-b');
    expect(await asyncStorage.getItem('flowmate-storage')).toBeNull();
    finishWorkspaceStorageIdentitySwitch();

    expect(summarizeWorkspaceStorageSnapshot('legacy')).toEqual({ entities: 1, relationships: 0, messages: 0, chatSessions: 0, otherItems: 0, preferencesChanged: false, hasContent: true });
    expect(JSON.parse(readWorkspaceStorageSnapshot('account-a')!).state.entities).toEqual([{ id: 'a' }]);
    expect(readWorkspaceStorageSnapshot('account-b')).toBeNull();
  });

  it('blocks persistence during an identity transition and only copies into an empty account namespace', async () => {
    await asyncStorage.setItem('flowmate-storage', JSON.stringify({ state: { entities: [{ id: 'legacy' }] } }));
    beginWorkspaceStorageIdentitySwitch('account-a');
    await asyncStorage.setItem('flowmate-storage', JSON.stringify({ state: { entities: [{ id: 'must-not-write' }] } }));
    finishWorkspaceStorageIdentitySwitch();
    expect(readWorkspaceStorageSnapshot('account-a')).toBeNull();

    localStorage.setItem('flowmate-storage:identity:account-a', JSON.stringify({ state: { entities: [] } }));
    const { copyWorkspaceStorageSnapshot } = await import('../services/storage');
    expect(copyWorkspaceStorageSnapshot('legacy', 'account-a')).toBe(false);
    expect(copyWorkspaceStorageSnapshot('legacy', 'account-b')).toBe(true);
    expect(summarizeWorkspaceStorageSnapshot('account-b').entities).toBe(1);
  });

  it('rejects a delayed snapshot from the prior identity after the active account changes', async () => {
    beginWorkspaceStorageIdentitySwitch('account-a');
    finishWorkspaceStorageIdentitySwitch('account-a');
    const accountASnapshot = JSON.stringify({ state: {
      workspaceStorageIdentity: 'account-a',
      entities: [{ id: 'account-a-only' }], messages: [], chatSessions: [],
    }, version: 17 });
    await asyncStorage.setItem('flowmate-storage', accountASnapshot);

    beginWorkspaceStorageIdentitySwitch('account-b');
    finishWorkspaceStorageIdentitySwitch('account-b');
    await asyncStorage.setItem('flowmate-storage', accountASnapshot);

    expect(await asyncStorage.getItem('flowmate-storage')).toBeNull();
    expect(JSON.parse(readWorkspaceStorageSnapshot('account-a')!).state.entities).toEqual([{ id: 'account-a-only' }]);
    expect(readWorkspaceStorageSnapshot('account-b')).toBeNull();
  });

  it('does not expose or overwrite a snapshot explicitly owned by another identity', async () => {
    localStorage.setItem('flowmate-storage:identity:account-b', JSON.stringify({ state: {
      workspaceStorageIdentity: 'account-a',
      entities: [{ id: 'account-a-only' }],
    }, version: 17 }));
    beginWorkspaceStorageIdentitySwitch('account-b');
    finishWorkspaceStorageIdentitySwitch('account-b');

    expect(await asyncStorage.getItem('flowmate-storage')).toBeNull();
    await asyncStorage.setItem('flowmate-storage', JSON.stringify({ state: {
      workspaceStorageIdentity: 'account-a', entities: [{ id: 'late-account-a-write' }],
    }, version: 17 }));
    expect(readWorkspaceStorageSnapshot('account-b')).toBeNull();
    expect(localStorage.getItem('flowmate-storage:identity:account-b')).toContain('account-a-only');
  });

  it('treats changed local preferences as recoverable workspace data', async () => {
    await asyncStorage.setItem('flowmate-storage', JSON.stringify({ state: {
      entities: [], messages: [], chatSessions: [], settings: { theme: 'dark' },
    } }));
    expect(summarizeWorkspaceStorageSnapshot('legacy', { theme: 'light' }).hasContent).toBe(true);
  });

  it('does not mistake the seeded welcome message and empty general session for user content', async () => {
    await asyncStorage.setItem('flowmate-storage', JSON.stringify({ state: {
      entities: [], relationships: [],
      messages: [{ id: 'init-1', role: 'assistant', text: 'Welcome to Flowmate. What would you like to talk through or work on?' }],
      chatSessions: [{ id: 'general', title: 'General Chat' }],
      settings: { theme: 'light' },
    } }));
    expect(summarizeWorkspaceStorageSnapshot('legacy', { theme: 'light' })).toEqual({
      entities: 0, relationships: 0, messages: 0, chatSessions: 0, otherItems: 0, preferencesChanged: false, hasContent: false,
    });
  });

  it('counts workspace data beyond entities and chats in the recovery summary', async () => {
    await asyncStorage.setItem('flowmate-storage', JSON.stringify({ state: {
      entities: [], relationships: [{ id: 'edge' }], messages: [], chatSessions: [],
      foodLogs: [{ id: 'meal' }], unsentDrafts: { main: { text: 'draft' } },
    } }));
    expect(summarizeWorkspaceStorageSnapshot('legacy')).toMatchObject({ relationships: 1, otherItems: 2, hasContent: true });
  });
});

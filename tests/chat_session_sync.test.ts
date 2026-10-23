import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  doc: vi.fn(() => ({ path: 'users/synthetic-user/meta/chat_sessions' })),
  collection: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocFromServer: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-time'),
  Timestamp: class Timestamp {},
  deleteField: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestoreMocks);
vi.mock('../services/firebase', () => ({ db: {}, isFirebaseConfigured: () => true }));
vi.mock('../services/syncManager', () => ({ isDemoSyncBlocked: () => false }));

import { saveChatSessions } from '../services/firestoreSync';
import type { ChatSession } from '../types';

const session = (id: string, updatedAt: string, overrides: Partial<ChatSession> = {}): ChatSession => ({
  id,
  title: id,
  created_at: updatedAt,
  updated_at: updatedAt,
  ...overrides,
});

describe('concurrent chat-session persistence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transactionally preserves sessions created by another device', async () => {
    const remote = session('remote-session', '2026-10-23T10:00:00.000Z');
    const local = session('local-session', '2026-10-23T10:01:00.000Z');
    const set = vi.fn();
    firestoreMocks.runTransaction.mockImplementation(async (_db, operation) => operation({
      get: async () => ({ exists: () => true, data: () => ({ sessions: [remote] }) }),
      set,
    }));

    await expect(saveChatSessions('synthetic-user', [local])).resolves.toBe(true);

    expect(firestoreMocks.runTransaction).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledOnce();
    expect(set.mock.calls[0][1].sessions.map((item: ChatSession) => item.id).sort())
      .toEqual(['local-session', 'remote-session']);
  });

  it('does not rewrite an unchanged session list and keeps a remote deletion tombstone', async () => {
    const deleted = session('deleted-session', '2026-10-23T10:00:00.000Z', {
      deleted: true,
      deleted_at: '2026-10-23T10:00:00.000Z',
    });
    const set = vi.fn();
    firestoreMocks.runTransaction.mockImplementation(async (_db, operation) => operation({
      get: async () => ({ exists: () => true, data: () => ({ sessions: [deleted] }) }),
      set,
    }));

    await expect(saveChatSessions('synthetic-user', [deleted])).resolves.toBe(true);
    expect(set).not.toHaveBeenCalled();

    const stale = session('deleted-session', '2026-10-23T11:00:00.000Z');
    firestoreMocks.runTransaction.mockImplementationOnce(async (_db, operation) => operation({
      get: async () => ({ exists: () => true, data: () => ({ sessions: [deleted] }) }),
      set,
    }));
    await expect(saveChatSessions('synthetic-user', [stale])).resolves.toBe(true);
    expect(set).not.toHaveBeenCalled();
  });
});

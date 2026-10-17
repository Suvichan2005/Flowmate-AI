import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/syncManager', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/syncManager')>();
  return { ...actual, syncMessage: vi.fn().mockResolvedValue(true) };
});

import { syncMessage } from '../services/syncManager';
import { useStore } from '../store';

describe('completed assistant message persistence', () => {
  beforeEach(() => {
    vi.mocked(syncMessage).mockClear();
    vi.mocked(syncMessage).mockResolvedValue(true);
    useStore.setState({
      messages: [],
      chatSessions: [{ id: 'sync-session', title: 'Sync test', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
      activeSessionId: 'sync-session',
      activeBranchId: 'b_main_sync-session',
      branches: [{
        id: 'b_main_sync-session', conversation_id: 'sync-session', name: 'Main',
        head_message_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }],
      branchQueues: {},
      isDemoMode: false,
      activeLease: null,
      isStreaming: false,
      streamingMessageId: null,
    });
  });

  it('writes the completed assistant text after the empty placeholder write', async () => {
    const state = useStore.getState();
    const userMessageId = state.addMessage('user', 'Give me a concise answer', undefined, null, 'sync-session');
    const userMessage = useStore.getState().messages.find(message => message.id === userMessageId)!;
    useStore.setState({
      branchQueues: {
        'b_main_sync-session': [{
          id: 'queue-sync-test', branch_id: 'b_main_sync-session', user_message: userMessage,
          owner_uid: 'local', status: 'queued', enqueued_at: Date.now(),
        }],
      },
    });
    useStore.getState().registerTurnExecutor(async ({ assistantMessageId }) => {
      useStore.getState().updateMessageText(assistantMessageId, 'Gemini says 4.');
    });

    await useStore.getState().processBranchQueue('b_main_sync-session');

    const writes = vi.mocked(syncMessage).mock.calls
      .map(([message]) => message)
      .filter(message => message.role === 'assistant');
    expect(writes.map(message => message.text)).toEqual(['', 'Gemini says 4.']);
    expect(writes[1].status).toBe('completed');
    expect(useStore.getState().messages.find(message => message.id === writes[1].id)?.text).toBe('Gemini says 4.');
  });
});

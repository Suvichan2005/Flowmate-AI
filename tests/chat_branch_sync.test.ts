import { describe, expect, it } from 'vitest';
import { mergeConversationBranches, sameConversationBranches } from '../services/chatBranchSync';
import { repairStaleConversationBranchHeads } from '../utils/conversationGraph';
import type { ConversationBranch, Message } from '../types';

const branch = (overrides: Partial<ConversationBranch> = {}): ConversationBranch => ({
  id: 'branch-1',
  conversation_id: 'chat-1',
  name: 'Main',
  head_message_id: 'message-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('conversation branch sync merge', () => {
  it('unions branch creation from independent devices', () => {
    const local = branch({ id: 'branch-local', name: 'Local' });
    const remote = branch({ id: 'branch-cloud', name: 'Cloud' });
    expect(mergeConversationBranches([local], [remote]).map(item => item.id).sort())
      .toEqual(['branch-cloud', 'branch-local']);
  });

  it('keeps the newer branch head and label metadata', () => {
    const older = branch({ head_message_id: 'old', updated_at: '2026-01-01T00:00:00.000Z' });
    const newer = branch({ head_message_id: 'new', name: 'Edited', updated_at: '2026-01-02T00:00:00.000Z' });
    expect(mergeConversationBranches([older], [newer])[0]).toMatchObject({ head_message_id: 'new', name: 'Edited' });
  });

  it('does not let a newly timestamped welcome placeholder replace restored cloud history', () => {
    const localWelcome = branch({
      id: 'b_main_general', conversation_id: 'general', head_message_id: 'init-1',
      created_at: '2026-10-24T00:00:00.000Z', updated_at: '2026-10-24T00:00:00.000Z',
    });
    const remoteHistory = branch({
      id: 'b_main_general', conversation_id: 'general', head_message_id: 'seed-root',
      created_at: '2026-10-20T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z',
    });

    expect(mergeConversationBranches([localWelcome], [remoteHistory])[0].head_message_id)
      .toBe('seed-root');
  });

  it('preserves deletion against stale replicas and accepts an explicit later restore', () => {
    const deleted = branch({ deleted_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' });
    const stale = branch({ updated_at: '2026-01-04T00:00:00.000Z', head_message_id: 'stale-write' });
    expect(mergeConversationBranches([stale], [deleted])[0].deleted_at).toBe(deleted.deleted_at);

    const restored = branch({ restored_at: '2026-01-03T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z' });
    expect(mergeConversationBranches([restored], [deleted])[0].deleted_at).toBeUndefined();
    expect(mergeConversationBranches([deleted], [restored])[0].deleted_at).toBeUndefined();
  });

  it('compares branch snapshots by ID rather than array order', () => {
    const first = branch();
    const second = branch({ id: 'branch-2', name: 'Alternative' });
    expect(sameConversationBranches([first, second], [second, first])).toBe(true);
    expect(sameConversationBranches([first], [branch({ head_message_id: 'changed' })])).toBe(false);
  });

  it('repairs stale branch heads from persisted message descendants without promoting rejected placeholders', () => {
    const stale = branch({ conversation_id: 'chat-1', head_message_id: 'root' });
    const messages: Message[] = [
      { id: 'root', role: 'assistant', text: 'Welcome', channelId: 'chat-1', branch_id: stale.id, created_at: '2026-01-01T00:00:00.000Z', status: 'completed' },
      { id: 'user-old', role: 'user', text: 'First device', channelId: 'chat-1', branch_id: stale.id, parent_id: 'root', created_at: '2026-01-01T00:01:00.000Z', status: 'failed' },
      { id: 'placeholder-old', role: 'assistant', text: '', channelId: 'chat-1', branch_id: stale.id, parent_id: 'user-old', created_at: '2026-01-01T00:01:01.000Z', status: 'failed', turn_metadata: { response_source: 'unavailable' } },
      { id: 'user-new', role: 'user', text: 'Second device', channelId: 'chat-1', branch_id: stale.id, parent_id: 'root', created_at: '2026-01-01T00:02:00.000Z', status: 'failed' },
      { id: 'placeholder-new', role: 'assistant', text: '', channelId: 'chat-1', branch_id: stale.id, parent_id: 'user-new', created_at: '2026-01-01T00:02:01.000Z', status: 'failed', turn_metadata: { response_source: 'unavailable' } },
    ];

    expect(repairStaleConversationBranchHeads([stale], messages, '2026-01-01T00:03:00.000Z')[0])
      .toMatchObject({ head_message_id: 'user-new', updated_at: '2026-01-01T00:03:00.000Z' });
    expect(repairStaleConversationBranchHeads([branch({ head_message_id: null })], messages)[0].head_message_id).toBeNull();
    expect(repairStaleConversationBranchHeads([branch({ head_message_id: 'root', deleted_at: '2026-01-01T00:03:00.000Z' })], messages)[0].head_message_id).toBe('root');
  });
});

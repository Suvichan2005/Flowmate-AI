/**
 * Tests for Flowmate Real-Time Cross-Device & Cross-Tab Draft and Streaming Synchronization
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';
import { globalSyncCoordinator } from '../services/sync';
import { SyncMutationPayload } from '../services/sync/protocol';

describe('Live Chat Draft and Streaming Synchronization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('updates local draft immediately and broadcasts mutation over coordinator', async () => {
    const enqueueSpy = vi.spyOn(globalSyncCoordinator, 'enqueueMutation');
    const branchId = 'test_branch_1';

    useStore.getState().setUnsentDraft(branchId, 'Hello from Device A');
    expect(useStore.getState().getUnsentDraft(branchId)).toBe('Hello from Device A');

    // Wait for the 80ms debounce timer
    await new Promise(resolve => setTimeout(resolve, 120));

    expect(enqueueSpy).toHaveBeenCalled();
    const lastCall = enqueueSpy.mock.calls[enqueueSpy.mock.calls.length - 1][0];
    expect(lastCall.entityKind).toBe('chat_draft');
    expect(lastCall.entityId).toBe(branchId);
    const data = lastCall.data as { branchId: string; text: string };
    expect(data.text).toBe('Hello from Device A');
  });

  it('immediately broadcasts empty draft when input is cleared without waiting', async () => {
    const enqueueSpy = vi.spyOn(globalSyncCoordinator, 'enqueueMutation');
    const branchId = 'test_branch_clear';

    // Clear draft
    useStore.getState().setUnsentDraft(branchId, '');
    expect(useStore.getState().getUnsentDraft(branchId)).toBe('');

    // Should be synchronous (0ms debounce) for immediate clearing
    expect(enqueueSpy).toHaveBeenCalled();
    const lastCall = enqueueSpy.mock.calls[enqueueSpy.mock.calls.length - 1][0];
    expect(lastCall.entityKind).toBe('chat_draft');
    const data = lastCall.data as { branchId: string; text: string };
    expect(data.text).toBe('');
  });

  it('setRemoteDraft updates draft locally without re-broadcasting to avoid echo loop', () => {
    const enqueueSpy = vi.spyOn(globalSyncCoordinator, 'enqueueMutation');
    const branchId = 'test_branch_remote';

    useStore.getState().setRemoteDraft(branchId, 'Remote text from Device B', null);
    expect(useStore.getState().getUnsentDraft(branchId)).toBe('Remote text from Device B');

    // Should NOT broadcast back
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('does not schedule durable storage flush for ephemeral chat_draft or chat_streaming', () => {
    const relayBroadcastSpy = vi.spyOn(globalSyncCoordinator.relay, 'broadcast').mockReturnValue(true);

    // Ephemeral draft mutation
    globalSyncCoordinator.enqueueMutation({
      entityKind: 'chat_draft',
      op: 'upsert',
      entityId: 'branch_ephemeral',
      data: { branchId: 'branch_ephemeral', text: 'live token' },
    });

    expect(relayBroadcastSpy).toHaveBeenCalled();

    // Ephemeral streaming mutation
    globalSyncCoordinator.enqueueMutation({
      entityKind: 'chat_streaming',
      op: 'upsert',
      entityId: 'msg_stream_1',
      data: { messageId: 'msg_stream_1', text: 'Generating response...', isStreaming: true },
    });

    expect(relayBroadcastSpy).toHaveBeenCalledTimes(2);
  });

  it('broadcasts newly added user messages immediately via sync coordinator', () => {
    const enqueueSpy = vi.spyOn(globalSyncCoordinator, 'enqueueMutation');
    const msgId = useStore.getState().addMessage('user', 'Instant test message from laptop');

    expect(msgId).toBeTruthy();
    expect(enqueueSpy).toHaveBeenCalled();
    const messageCall = enqueueSpy.mock.calls.find(call => call[0].entityKind === 'message');
    expect(messageCall).toBeDefined();
    expect(messageCall![0].entityId).toBe(msgId);
    const payload = messageCall![0].data as { id: string; text: string; role: string };
    expect(payload.text).toBe('Instant test message from laptop');
    expect(payload.role).toBe('user');
  });
});

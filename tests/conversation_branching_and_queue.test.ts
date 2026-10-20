/**
 * Conversation Branching, Persistent Queue & Developer Diagnostics Tests
 *
 * Verifies Phase 3 Production Integration:
 * 1. addMessage parent_id & branch_id automatic linking
 * 2. editAndBranchMessage creates a new branch without mutating original branch
 * 3. getSiblingVersions correctly computes 1/N indices and sibling alternative sets
 * 4. switchSiblingVersion shifts active branch and ancestry paths
 * 5. resolveBranchHistory resolves deterministic linear ancestry without cross-branch contamination
 * 6. Non-blocking queue operations (enqueue, cancel)
 * 7. Draft OCC revision tracking
 * 8. sanitizeSecrets redacts sensitive credentials
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../store';
import { resolveBranchHistory, getSiblingVersions, findLeafMessage, sanitizeSecrets } from '../utils/conversationGraph';
import { Message } from '../types';

describe('Phase 3: Conversation Branching & Graph DAG', () => {
  beforeEach(() => {
    // Reset store state to clean baseline
    useStore.setState({
      messages: [],
      chatSessions: [{ id: 'test-session', title: 'Test Session', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
      activeSessionId: 'test-session',
      branches: [{
        id: 'b_main_test-session',
        conversation_id: 'test-session',
        name: 'Main',
        head_message_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }],
      activeBranchId: 'b_main_test-session',
      branchQueues: {},
      unsentDrafts: {},
      currentUser: null,
      developerModeEnabled: false,
    });
  });

  it('addMessage automatically tracks parent_id, branch_id and updates branch head', () => {
    const { addMessage } = useStore.getState();

    const m1Id = addMessage('user', 'First user message', undefined, null, 'test-session');
    const m2Id = addMessage('assistant', 'First assistant response', undefined, null, 'test-session');

    const state = useStore.getState();
    const m1 = state.messages.find(m => m.id === m1Id);
    const m2 = state.messages.find(m => m.id === m2Id);
    const branch = state.branches.find(b => b.id === state.activeBranchId);

    expect(m1).toBeDefined();
    expect(m2).toBeDefined();
    expect(m1?.parent_id).toBeNull();
    expect(m1?.branch_id).toBe('b_main_test-session');
    expect(m2?.parent_id).toBe(m1Id);
    expect(m2?.branch_id).toBe('b_main_test-session');
    expect(branch?.head_message_id).toBe(m2Id);
  });

  it('editAndBranchMessage creates a new branch and leaves original history intact', () => {
    const { addMessage, editAndBranchMessage } = useStore.getState();

    const m1Id = addMessage('user', 'Original message', undefined, null, 'test-session');
    const m2Id = addMessage('assistant', 'Original reply', undefined, null, 'test-session');

    // User edits m1
    const m1ForkId = editAndBranchMessage(m1Id, 'Edited message');

    const state = useStore.getState();
    const originalM1 = state.messages.find(m => m.id === m1Id);
    const forkedM1 = state.messages.find(m => m.id === m1ForkId);

    expect(forkedM1).toBeDefined();
    expect(forkedM1?.text).toBe('Edited message');
    expect(forkedM1?.parent_id).toBe(originalM1?.parent_id); // Same parent (null)
    expect(forkedM1?.branch_id).not.toBe('b_main_test-session');
    expect(state.activeBranchId).toBe(forkedM1?.branch_id);

    // Verify original branch was not mutated
    const originalBranch = state.branches.find(b => b.id === 'b_main_test-session');
    expect(originalBranch?.head_message_id).toBe(m2Id);
  });

  it('getSiblingVersions identifies sibling versions and computes correct index', () => {
    const { addMessage, editAndBranchMessage } = useStore.getState();

    const m1Id = addMessage('user', 'Draft prompt 1', undefined, null, 'test-session');
    addMessage('assistant', 'Reply 1', undefined, null, 'test-session');

    const m1ForkId = editAndBranchMessage(m1Id, 'Draft prompt 2');

    const state = useStore.getState();
    const sibOriginal = getSiblingVersions(state.messages, m1Id);
    const sibFork = getSiblingVersions(state.messages, m1ForkId);

    expect(sibOriginal.totalCount).toBe(2);
    expect(sibOriginal.currentIndex).toBe(1);

    expect(sibFork.totalCount).toBe(2);
    expect(sibFork.currentIndex).toBe(2);
    expect(sibFork.siblings.map(s => s.id)).toContain(m1Id);
    expect(sibFork.siblings.map(s => s.id)).toContain(m1ForkId);
  });

  it('resolveBranchHistory resolves strictly linear ancestry along the active branch DAG', () => {
    const { addMessage, editAndBranchMessage } = useStore.getState();

    const u1 = addMessage('user', 'U1', undefined, null, 'test-session');
    const a1 = addMessage('assistant', 'A1', undefined, null, 'test-session');
    const u2 = addMessage('user', 'U2', undefined, null, 'test-session');
    const a2 = addMessage('assistant', 'A2', undefined, null, 'test-session');

    // Fork from u2
    const u2Fork = editAndBranchMessage(u2, 'U2 Alternative');
    const a2Fork = addMessage('assistant', 'A2 Alternative', undefined, null, 'test-session');

    const state = useStore.getState();

    // History for fork branch
    const forkHist = resolveBranchHistory(state.messages, a2Fork, 'test-session');
    expect(forkHist.map(m => m.id)).toEqual([u1, a1, u2Fork, a2Fork]);

    // History for original branch
    const origHist = resolveBranchHistory(state.messages, a2, 'test-session');
    expect(origHist.map(m => m.id)).toEqual([u1, a1, u2, a2]);
  });

  it('switchSiblingVersion switches active branch seamlessly', () => {
    const { addMessage, editAndBranchMessage, switchSiblingVersion } = useStore.getState();

    const u1 = addMessage('user', 'U1', undefined, null, 'test-session');
    addMessage('assistant', 'A1', undefined, null, 'test-session');

    const u1Fork = editAndBranchMessage(u1, 'U1 Forked');
    expect(useStore.getState().activeBranchId).not.toBe('b_main_test-session');

    // Switch back to original u1
    switchSiblingVersion(u1);
    expect(useStore.getState().activeBranchId).toBe('b_main_test-session');

    // Switch back to u1Fork
    switchSiblingVersion(u1Fork);
    expect(useStore.getState().activeBranchId).not.toBe('b_main_test-session');
  });

  it('enqueueUserMessage and cancelQueuedItem manage branch queue safely', () => {
    const { enqueueUserMessage, cancelQueuedItem } = useStore.getState();

    const q1 = enqueueUserMessage('Queued thought 1', 'b_main_test-session', 'test-session');
    const q2 = enqueueUserMessage('Queued thought 2', 'b_main_test-session', 'test-session');

    let state = useStore.getState();
    expect(state.branchQueues['b_main_test-session']).toHaveLength(2);
    expect(state.branchQueues['b_main_test-session'][0].id).toBe(q1.id);

    cancelQueuedItem(q1.id, 'b_main_test-session');
    state = useStore.getState();
    expect(state.branchQueues['b_main_test-session']).toHaveLength(1);
    expect(state.branchQueues['b_main_test-session'][0].id).toBe(q2.id);
  });

  it('setUnsentDraft updates draft with optimistic concurrency revisions', () => {
    const { setUnsentDraft, getUnsentDraft } = useStore.getState();

    setUnsentDraft('b_main_test-session', 'First draft text');
    expect(getUnsentDraft('b_main_test-session')).toBe('First draft text');

    let state = useStore.getState();
    expect(state.unsentDrafts['b_main_test-session'].current_revision).toBe(1);
    expect(state.unsentDrafts['b_main_test-session'].base_revision).toBe(0);

    setUnsentDraft('b_main_test-session', 'Second draft text');
    state = useStore.getState();
    expect(state.unsentDrafts['b_main_test-session'].current_revision).toBe(2);
    expect(state.unsentDrafts['b_main_test-session'].base_revision).toBe(1);
  });

  it('sanitizeSecrets redacts API keys and bearer tokens in diagnostics strings', () => {
    const raw = 'Calling model with API key AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6 and token Bearer ya29.v8fakeToken123456';
    const sanitized = sanitizeSecrets(raw);

    expect(sanitized).not.toContain('AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6');
    expect(sanitized).not.toContain('ya29.v8fakeToken123456');
    expect(sanitized).toContain('[REDACTED_API_KEY]');
    expect(sanitized).toContain('[REDACTED_OAUTH_TOKEN]');
  });

  it('Regression 1: Fork & Send creates a branch and submits the edited message', async () => {
    const { addMessage, forkAndSendMessage } = useStore.getState();

    const u1 = addMessage('user', 'Initial prompt', undefined, null, 'test-session');
    const a1 = addMessage('assistant', 'Initial answer', undefined, null, 'test-session');

    let executedTurnCount = 0;
    useStore.getState().registerTurnExecutor(async ({ branchId, userMessage, assistantMessageId }) => {
      executedTurnCount++;
      useStore.getState().updateMessageText(assistantMessageId, `Response for ${userMessage.text}`);
    });

    const res = await forkAndSendMessage(u1, 'Edited prompt');
    expect(res).not.toBeNull();
    expect(executedTurnCount).toBe(1);

    const state = useStore.getState();
    const newBranch = state.branches.find(b => b.id === res?.branchId);
    expect(newBranch).toBeDefined();
    expect(state.activeBranchId).toBe(res?.branchId);

    // Edited user message exists on new branch
    const editedUserMsg = state.messages.find(m => m.id === res?.userMessageId);
    expect(editedUserMsg).toBeDefined();
    expect(editedUserMsg?.text).toBe('Edited prompt');
    expect(editedUserMsg?.branch_id).toBe(newBranch?.id);
    expect(editedUserMsg?.parent_id).toBeNull(); // same parent as u1

    // Assistant message exists on new branch
    const assistantMsg = state.messages.find(m => m.id === res?.assistantMessageId);
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.text).toBe('Response for Edited prompt');
    expect(assistantMsg?.branch_id).toBe(newBranch?.id);
    expect(assistantMsg?.parent_id).toBe(editedUserMsg?.id);
    expect(newBranch?.head_message_id).toBe(assistantMsg?.id);
  });

  it('Regression 2: Fork alone creates a branch without submitting', () => {
    const { addMessage, forkBranch } = useStore.getState();

    const u1 = addMessage('user', 'U1', undefined, null, 'test-session');
    const a1 = addMessage('assistant', 'A1', undefined, null, 'test-session');
    const u2 = addMessage('user', 'U2', undefined, null, 'test-session');
    const a2 = addMessage('assistant', 'A2', undefined, null, 'test-session');

    const messageCountBefore = useStore.getState().messages.length;

    const newBranchId = forkBranch(u2);
    expect(newBranchId).toBeTruthy();

    const state = useStore.getState();
    expect(state.activeBranchId).toBe(newBranchId);

    const newBranch = state.branches.find(b => b.id === newBranchId);
    expect(newBranch).toBeDefined();
    expect(newBranch?.diverged_from_message_id).toBe(u2); // Continue after the chosen message.
    expect(newBranch?.head_message_id).toBe(u2);

    // No new messages added
    expect(state.messages.length).toBe(messageCountBefore);

    // Queue for new branch is empty
    expect(state.branchQueues[newBranchId] || []).toHaveLength(0);
  });

  it('Regression 3: Failed queue admission can be retried without duplicate messages', async () => {
    const { addMessage, forkAndSendMessage, retryQueuedUserMessage } = useStore.getState();

    const u1 = addMessage('user', 'Original', undefined, null, 'test-session');
    addMessage('assistant', 'Reply', undefined, null, 'test-session');

    let executionCount = 0;
    useStore.getState().registerTurnExecutor(async ({ assistantMessageId }) => {
      executionCount++;
      useStore.getState().updateMessageText(assistantMessageId, 'Success after retry');
    });

    // 1. Simulate failed queue admission with stable submission ID
    const durableSubId = 'msg-durable-retry-123';
    const failedRes = await forkAndSendMessage(u1, 'Failing prompt', {
      submissionId: durableSubId,
      simulatedFailure: true
    });
    expect(failedRes).toBeNull();
    expect(executionCount).toBe(0);

    let state = useStore.getState();
    const failedMsg = state.messages.find(m => m.id === durableSubId);
    expect(failedMsg).toBeDefined();
    expect(failedMsg?.status).toBe('failed');
    const branchId = failedMsg?.branch_id!;
    expect(branchId).toBeDefined();

    // Only 1 user message created (plus original 2 = 3 total messages)
    expect(state.messages.filter(m => m.id === durableSubId)).toHaveLength(1);
    expect(state.messages).toHaveLength(3);

    // 2. Retry sending
    const retrySuccess = await retryQueuedUserMessage(durableSubId);
    expect(retrySuccess).toBe(true);
    expect(executionCount).toBe(1);

    state = useStore.getState();
    // Still exactly 1 user message with this ID (no duplicates!)
    const matchingUserMsgs = state.messages.filter(m => m.id === durableSubId);
    expect(matchingUserMsgs).toHaveLength(1);
    expect(matchingUserMsgs[0].status).toBe('completed');

    // Assistant response was generated on the branch
    const assistantMsg = state.messages.find(m => m.branch_id === branchId && m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.text).toBe('Success after retry');
  });

  it('Regression 4: Double-click and network retry do not execute the same turn twice', async () => {
    const { addMessage, forkAndSendMessage } = useStore.getState();

    const u1 = addMessage('user', 'Double click target', undefined, null, 'test-session');
    addMessage('assistant', 'Initial reply', undefined, null, 'test-session');

    let executionCount = 0;
    useStore.getState().registerTurnExecutor(async ({ assistantMessageId }) => {
      executionCount++;
      await new Promise(r => setTimeout(r, 20));
      useStore.getState().updateMessageText(assistantMessageId, 'Double click executed');
    });

    // Simulate simultaneous rapid double-click
    const submissionId = 'rapid-double-click-id';
    const [res1, res2] = await Promise.all([
      forkAndSendMessage(u1, 'Rapid click prompt', { submissionId }),
      forkAndSendMessage(u1, 'Rapid click prompt', { submissionId })
    ]);

    // Exactly one executes
    expect(executionCount).toBe(1);
    expect(res1 || res2).toBeTruthy();

    const state = useStore.getState();
    const userMsgs = state.messages.filter(m => m.id === submissionId);
    expect(userMsgs).toHaveLength(1);
  });

  it('keeps a denied request retryable without inserting an assistant response', async () => {
    const seedUser = useStore.getState().addMessage('user', 'Seed request', undefined, null, 'test-session');
    useStore.getState().addMessage('assistant', 'Seed response', undefined, null, 'test-session');
    useStore.getState().registerTurnExecutor(async ({ branchId, userMessage, assistantMessageId }) => {
      useStore.setState(state => ({
        messages: state.messages.map(message => message.id === assistantMessageId
          ? { ...message, text: '', status: 'failed' as const, turn_metadata: { response_source: 'unavailable' } }
          : message.id === userMessage.id ? { ...message, status: 'failed' as const } : message),
        branches: state.branches.map(branch => branch.id === branchId
          ? { ...branch, head_message_id: userMessage.id }
          : branch),
      }));
    });

    const result = await useStore.getState().forkAndSendMessage(seedUser, 'Request over the managed cost cap', {
      submissionId: 'managed-cost-rejected-0001',
    });
    expect(result).toBeTruthy();
    const state = useStore.getState();
    const userMessage = state.messages.find(message => message.id === 'managed-cost-rejected-0001');
    expect(userMessage?.text).toBe('Request over the managed cost cap');
    expect(userMessage?.status).toBe('failed');
    const assistantReplies = state.messages.filter(message => message.parent_id === userMessage?.id && message.role === 'assistant' && message.status !== 'failed');
    expect(assistantReplies).toHaveLength(0);
    expect(state.branchQueues[userMessage!.branch_id!]?.some(item => item.user_message.id === userMessage.id && item.status === 'failed')).toBe(true);
    expect(state.branches.find(branch => branch.id === userMessage!.branch_id)?.head_message_id).toBe(userMessage?.id);
  });

  it('retries with recent context as a separate branch and preserves the original request and attachment', async () => {
    const originalId = useStore.getState().addMessage('user', 'Analyze this image with the full conversation context.', undefined, null, 'test-session');
    const original = useStore.getState().messages.find(message => message.id === originalId)!;
    useStore.setState(state => ({
      messages: state.messages.map(message => message.id === originalId
        ? { ...message, attachment: 'data:image/png;base64,c2FtcGxl', status: 'failed' as const, turn_metadata: { managed_failure: { code: 'MODEL_CONTEXT_LIMIT', outcome: 'not_sent' } } }
        : message),
    }));
    useStore.getState().registerTurnExecutor(async ({ branchId, userMessage, assistantMessageId }) => {
      useStore.setState(state => ({
        messages: state.messages.map(message => message.id === assistantMessageId
          ? { ...message, text: 'Recovered with recent context.', status: 'completed' as const }
          : message.id === userMessage.id ? { ...message, status: 'completed' as const } : message),
        branches: state.branches.map(branch => branch.id === branchId
          ? { ...branch, head_message_id: assistantMessageId }
          : branch),
      }));
    });

    await useStore.getState().forkAndSendMessage(originalId, original.text, { contextRecovery: 'recent' });

    const state = useStore.getState();
    const retry = state.messages.find(message => message.id !== originalId && message.role === 'user');
    expect(state.messages.find(message => message.id === originalId)?.turn_metadata?.managed_failure?.code).toBe('MODEL_CONTEXT_LIMIT');
    expect(state.messages.find(message => message.id === originalId)?.attachment).toBe('data:image/png;base64,c2FtcGxl');
    expect(retry?.text).toBe(original.text);
    expect(retry?.attachment).toBe('data:image/png;base64,c2FtcGxl');
    expect(retry?.turn_metadata?.context_recovery).toBe('recent');
    expect(retry?.parent_id).toBe(original.parent_id);
  });

  it('retries with essential workspace context as a separate branch without changing the full transcript', async () => {
    const originalId = useStore.getState().addMessage('user', 'Use my complete chat history and attached document.', undefined, null, 'test-session');
    const original = useStore.getState().messages.find(message => message.id === originalId)!;
    useStore.setState(state => ({
      messages: state.messages.map(message => message.id === originalId
        ? { ...message, attachment: 'data:image/png;base64,c2FtcGxl', status: 'failed' as const, turn_metadata: { managed_failure: { code: 'MODEL_CONTEXT_LIMIT', outcome: 'not_sent' } } }
        : message),
    }));
    useStore.getState().registerTurnExecutor(async ({ branchId, userMessage, assistantMessageId }) => {
      useStore.setState(state => ({
        messages: state.messages.map(message => message.id === assistantMessageId
          ? { ...message, text: 'Recovered with essential workspace context.', status: 'completed' as const }
          : message.id === userMessage.id ? { ...message, status: 'completed' as const } : message),
        branches: state.branches.map(branch => branch.id === branchId
          ? { ...branch, head_message_id: assistantMessageId }
          : branch),
      }));
    });

    await useStore.getState().forkAndSendMessage(originalId, original.text, { contextRecovery: 'essentials' });

    const state = useStore.getState();
    const retry = state.messages.find(message => message.id !== originalId && message.role === 'user');
    const preservedOriginal = state.messages.find(message => message.id === originalId);
    expect(preservedOriginal?.text).toBe(original.text);
    expect(preservedOriginal?.attachment).toBe('data:image/png;base64,c2FtcGxl');
    expect(preservedOriginal?.turn_metadata?.managed_failure?.code).toBe('MODEL_CONTEXT_LIMIT');
    expect(retry?.text).toBe(original.text);
    expect(retry?.attachment).toBe('data:image/png;base64,c2FtcGxl');
    expect(retry?.turn_metadata?.context_recovery).toBe('essentials');
    expect(retry?.parent_id).toBe(original.parent_id);
  });

  it('can explicitly remove an attachment from a retry without changing the historical message', async () => {
    const originalId = useStore.getState().addMessage('user', 'Please inspect this image.', undefined, null, 'test-session');
    useStore.setState(state => ({
      messages: state.messages.map(message => message.id === originalId
        ? { ...message, attachment: 'data:image/png;base64,c2FtcGxl', status: 'failed' as const }
        : message),
    }));
    useStore.getState().registerTurnExecutor(async ({ branchId, userMessage, assistantMessageId }) => {
      useStore.setState(state => ({
        messages: state.messages.map(message => message.id === assistantMessageId
          ? { ...message, text: 'Text-only retry completed.', status: 'completed' as const }
          : message.id === userMessage.id ? { ...message, status: 'completed' as const } : message),
        branches: state.branches.map(branch => branch.id === branchId
          ? { ...branch, head_message_id: assistantMessageId }
          : branch),
      }));
    });

    await useStore.getState().forkAndSendMessage(originalId, 'Please inspect this image.', { removeAttachment: true });

    const state = useStore.getState();
    const retry = state.messages.find(message => message.id !== originalId && message.role === 'user');
    expect(retry?.attachment).toBeNull();
    expect(state.messages.find(message => message.id === originalId)?.attachment).toBe('data:image/png;base64,c2FtcGxl');
  });

  it('does not automatically replay an expired provider lease after a tab interruption', async () => {
    const userMessageId = useStore.getState().addMessage('user', 'A request with an uncertain outcome', undefined, null, 'test-session');
    const userMessage = useStore.getState().messages.find(message => message.id === userMessageId)!;
    const assistantMessageId = useStore.getState().addMessage('assistant', '', undefined, null, 'test-session');
    useStore.setState(state => ({
      messages: state.messages.map(message => message.id === assistantMessageId ? { ...message, parent_id: userMessageId, status: 'streaming' } : message),
      branchQueues: {
        'b_main_test-session': [{
          id: 'expired-lease', branch_id: 'b_main_test-session', user_message: userMessage,
          owner_uid: 'local', status: 'leased', enqueued_at: Date.now() - 120_000, lease_expires_at: Date.now() - 1,
        }],
      },
      activeLease: null,
    }));
    const execute = vi.fn();
    useStore.getState().registerTurnExecutor(execute);

    await useStore.getState().processBranchQueue('b_main_test-session');

    expect(execute).not.toHaveBeenCalled();
    expect(useStore.getState().branchQueues['b_main_test-session'][0].status).toBe('needs_action');
    expect(useStore.getState().messages.find(message => message.id === userMessageId)?.status).toBe('interrupted');
    expect(useStore.getState().messages.find(message => message.id === assistantMessageId)?.status).toBe('interrupted');
  });

  it('holds queued sends for explicit review when the Firebase identity changes', async () => {
    useStore.setState({ currentUser: { uid: 'account-A' } as any });
    const queued = useStore.getState().enqueueUserMessage('Private draft from account A');
    const execute = vi.fn();
    useStore.getState().registerTurnExecutor(execute);

    useStore.setState({ currentUser: { uid: 'account-B' } as any });
    await useStore.getState().processBranchQueue('b_main_test-session');

    const state = useStore.getState();
    const held = state.branchQueues['b_main_test-session'].find(item => item.id === queued.id);
    expect(execute).not.toHaveBeenCalled();
    expect(held?.owner_uid).toBe('account-A');
    expect(held?.status).toBe('needs_action');
    expect(held?.error).toContain('different or unknown account');
  });

  it('Regression 5: The original branch and its descendants remain unchanged', async () => {
    const { addMessage, forkAndSendMessage } = useStore.getState();

    const u1 = addMessage('user', 'U1 Original', undefined, null, 'test-session');
    const a1 = addMessage('assistant', 'A1 Original', undefined, null, 'test-session');
    const u2 = addMessage('user', 'U2 Original', undefined, null, 'test-session');
    const a2 = addMessage('assistant', 'A2 Original', undefined, null, 'test-session');

    const origBranchBefore = useStore.getState().branches.find(b => b.id === 'b_main_test-session');
    expect(origBranchBefore?.head_message_id).toBe(a2);

    await forkAndSendMessage(u2, 'U2 Forked Alternative');

    const state = useStore.getState();
    // Original messages unchanged
    expect(state.messages.find(m => m.id === u1)?.text).toBe('U1 Original');
    expect(state.messages.find(m => m.id === a1)?.text).toBe('A1 Original');
    expect(state.messages.find(m => m.id === u2)?.text).toBe('U2 Original');
    expect(state.messages.find(m => m.id === a2)?.text).toBe('A2 Original');

    // Original branch head untouched
    const origBranchAfter = state.branches.find(b => b.id === 'b_main_test-session');
    expect(origBranchAfter?.head_message_id).toBe(a2);

    // Resolved history on original branch remains [u1, a1, u2, a2]
    const origHistory = resolveBranchHistory(state.messages, a2, 'test-session');
    expect(origHistory.map(m => m.id)).toEqual([u1, a1, u2, a2]);
  });

  it('Regression 6: The edited message and streaming response appear on the correct branch', async () => {
    const { addMessage, forkAndSendMessage } = useStore.getState();

    const u1 = addMessage('user', 'Base User', undefined, null, 'test-session');
    addMessage('assistant', 'Base Reply', undefined, null, 'test-session');

    useStore.getState().registerTurnExecutor(async ({ assistantMessageId }) => {
      useStore.getState().updateMessageText(assistantMessageId, 'Branched Streamed Reply');
    });

    const res = await forkAndSendMessage(u1, 'Branched User Message');
    expect(res).toBeTruthy();

    const state = useStore.getState();
    const branchHistory = resolveBranchHistory(state.messages, res?.assistantMessageId, 'test-session');

    // History should contain: edited user message followed by branched assistant reply
    expect(branchHistory.map(m => m.id)).toEqual([res?.userMessageId, res?.assistantMessageId]);
    expect(branchHistory[0].text).toBe('Branched User Message');
    expect(branchHistory[1].text).toBe('Branched Streamed Reply');
    expect(branchHistory[0].branch_id).toBe(res?.branchId);
    expect(branchHistory[1].branch_id).toBe(res?.branchId);
  });
});

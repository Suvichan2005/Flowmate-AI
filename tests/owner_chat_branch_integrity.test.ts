import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { resolveBranchHistory } from '../utils/conversationGraph';
import type { Message } from '../types';

describe('Owner chat branch integrity', () => {
  beforeEach(() => {
    useStore.setState({ messages: [], chatSessions: [], branches: [], branchQueues: {}, unsentDrafts: {}, currentUser: null, isDemoMode: false });
    useStore.getState().createChatSession('Parent conversation');
  });
  it('forks inclusively, preserves the parent, isolates continuations, switches and survives rehydration', async () => {
    const main = useStore.getState().activeBranchId;
    const session = useStore.getState().activeSessionId;
    const first = useStore.getState().addMessage('user', 'Original question');
    const reply = useStore.getState().addMessage('assistant', 'Original answer');
    const later = useStore.getState().addMessage('user', 'Parent continuation');
    const branch = useStore.getState().forkBranch(reply);
    expect(resolveBranchHistory(useStore.getState().messages, reply, session).map(m => m.id)).toEqual([first, reply]);
    const child = useStore.getState().addMessage('user', 'Child continuation');
    useStore.getState().setUnsentDraft(branch, 'Child draft');
    useStore.getState().setActiveBranchId(main);
    expect(useStore.getState().branches.find(b => b.id === main)?.head_message_id).toBe(later);
    expect(resolveBranchHistory(useStore.getState().messages, later, session).map(m => m.id)).not.toContain(child);
    const secondSession = useStore.getState().createChatSession('Other');
    useStore.getState().setActiveSessionId(session);
    expect(useStore.getState().activeBranchId).toBe(main);
    useStore.getState().setActiveBranchId(branch);
    useStore.getState().setActiveSessionId(secondSession);
    useStore.getState().setActiveSessionId(session);
    expect(useStore.getState().activeBranchId).toBe(branch);
    await useStore.persist.rehydrate();
    expect(useStore.getState().activeBranchId).toBe(branch);
    expect(useStore.getState().getUnsentDraft(branch)).toBe('Child draft');
    expect(useStore.getState().messages.some(m => m.id === later)).toBe(true);
  });
  it('soft-deletes a child, retains shared ancestry and restores it after reload', async () => {
    const root = useStore.getState().activeBranchId;
    const message = useStore.getState().addMessage('user', 'Keep me');
    const branch = useStore.getState().forkBranch(message);
    const childMessage = useStore.getState().addMessage('assistant', 'Keep child too');
    useStore.getState().deleteBranch(branch);
    expect(useStore.getState().activeBranchId).toBe(root);
    expect(useStore.getState().messages.map(m => m.id)).toContain(childMessage);
    await useStore.persist.rehydrate();
    useStore.getState().restoreBranch(branch);
    expect(useStore.getState().activeBranchId).toBe(branch);
    expect(useStore.getState().branches.find(b => b.id === branch)?.head_message_id).toBe(childMessage);
    useStore.getState().deleteBranch(root);
    expect(useStore.getState().branches.find(b => b.id === root)?.deleted_at).toBeFalsy();
  });
  it('renames live branches without accepting blank or deleted-branch names', () => {
    const branch = useStore.getState().activeBranchId;
    useStore.getState().renameBranch(branch, '  Focused review  ');
    expect(useStore.getState().branches.find(b => b.id === branch)?.name).toBe('Focused review');

    useStore.getState().renameBranch(branch, '   ');
    expect(useStore.getState().branches.find(b => b.id === branch)?.name).toBe('Focused review');

    useStore.setState(state => ({ branches: state.branches.map(b => b.id === branch ? { ...b, deleted_at: new Date().toISOString() } : b) }));
    useStore.getState().renameBranch(branch, 'Should not change');
    expect(useStore.getState().branches.find(b => b.id === branch)?.name).toBe('Focused review');
  });
  it('does not merge siblings into an empty or missing branch head', () => {
    const message = useStore.getState().addMessage('user', 'Other branch');
    expect(resolveBranchHistory(useStore.getState().messages, null, useStore.getState().activeSessionId)).toEqual([]);
    expect(resolveBranchHistory(useStore.getState().messages, 'missing', useStore.getState().activeSessionId)).toEqual([]);
    expect(resolveBranchHistory(useStore.getState().messages, undefined, useStore.getState().activeSessionId).map(m => m.id)).toEqual([message]);
  });
  it('switches same-branch message versions to the selected persisted path', () => {
    const state = useStore.getState();
    const channelId = state.activeSessionId;
    const branchId = state.activeBranchId;
    const messages: Message[] = [
      { id: 'root', role: 'assistant', text: 'Welcome', channelId, branch_id: branchId, created_at: '2026-01-01T00:00:00.000Z', status: 'completed' },
      { id: 'version-old', role: 'user', text: 'Older device message', channelId, branch_id: branchId, parent_id: 'root', created_at: '2026-01-01T00:01:00.000Z', status: 'failed' },
      { id: 'failed-placeholder', role: 'assistant', text: '', channelId, branch_id: branchId, parent_id: 'version-old', created_at: '2026-01-01T00:01:01.000Z', status: 'failed', turn_metadata: { response_source: 'unavailable' } },
      { id: 'version-new', role: 'user', text: 'Newer device message', channelId, branch_id: branchId, parent_id: 'root', created_at: '2026-01-01T00:02:00.000Z', status: 'failed' },
    ];
    useStore.setState({
      messages,
      branches: state.branches.map(branch => branch.id === branchId ? { ...branch, head_message_id: 'version-new' } : branch),
    });

    useStore.getState().switchSiblingVersion('version-old');

    const updated = useStore.getState();
    expect(updated.activeBranchId).toBe(branchId);
    expect(updated.branches.find(branch => branch.id === branchId)?.head_message_id).toBe('version-old');
    expect(resolveBranchHistory(updated.messages, 'version-old', channelId).map(message => message.id))
      .toEqual(['root', 'version-old']);
  });
  it('rejects foreign/deleted branch activation', () => {
    const active = useStore.getState().activeBranchId;
    useStore.getState().setActiveBranchId('missing');
    expect(useStore.getState().activeBranchId).toBe(active);
  });
});

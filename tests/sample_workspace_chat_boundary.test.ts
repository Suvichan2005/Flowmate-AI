import { beforeEach, describe, it, expect } from 'vitest';
import { useStore } from '../store';
import { generateSyntheticDemoEntities } from './fixtures/syntheticWorkspaceData';

describe('Synthetic workspace conversation and undo boundary', () => {
  beforeEach(() => {
    useStore.setState({ isDemoMode: false, personalSnapshot: null, currentUser: null, activeLease: null, isStreaming: false,
      messages: [], branches: [], chatSessions: [], unsentDrafts: {}, history: [], historyPointer: -1 });
    useStore.getState().createChatSession('Personal conversation');
    useStore.getState().addMessage('user', 'Private synthetic message');
    useStore.getState().setUnsentDraft(useStore.getState().activeBranchId, 'Private synthetic draft');
  });
  it('isolates messages drafts ancestry undo and restores the personal branch exactly', async () => {
    const personal = useStore.getState().activeBranchId;
    useStore.getState().enterDemoMode(generateSyntheticDemoEntities());
    expect(useStore.getState().messages).toEqual([]);
    expect(useStore.getState().chatSessions.map(s => s.id)).toEqual(['sample']);
    expect(useStore.getState().getUnsentDraft(personal)).toBe('');
    expect(useStore.getState().canUndo()).toBe(false);
    useStore.getState().setUnsentDraft('b_main_sample', 'Sample draft');
    useStore.getState().addMessage('user', 'Sample-only message');
    // Storage adapter writes asynchronously; rehydration waits for its pending write queue.
    await useStore.persist.rehydrate();
    await useStore.getState().exitDemoMode();
    expect(useStore.getState().activeBranchId).toBe(personal);
    expect(useStore.getState().getUnsentDraft(personal)).toBe('Private synthetic draft');
    expect(useStore.getState().messages.map(m => m.text)).toContain('Private synthetic message');
    expect(useStore.getState().messages.map(m => m.text)).not.toContain('Sample-only message');
    expect(useStore.getState().unsentDrafts.b_main_sample).toBeUndefined();
  });
  it('refuses to reset ordinary personal state and blocks synthetic workspace entry during a response', async () => {
    const before = useStore.getState().messages;
    useStore.getState().resetDemoWorkspace(generateSyntheticDemoEntities());
    expect(useStore.getState().messages).toBe(before);
    useStore.setState({ isStreaming: true });
    useStore.getState().enterDemoMode(generateSyntheticDemoEntities());
    expect(useStore.getState().isDemoMode).toBe(false);
    expect(useStore.getState().messages).toBe(before);
  });
});

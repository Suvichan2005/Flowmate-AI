import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { setDemoModeSyncBlock } from '../services/syncManager';

const initial = useStore.getState();
beforeEach(() => {
  useStore.setState({ ...initial, isDemoMode: false, personalSnapshot: null,
    branches: [], activeBranchId: 'main', currentUser: { uid: 'synthetic-A' } as any,
    messages: [{ id: 'personal-A', role: 'user', text: 'Synthetic account A', created_at: '2026-10-15T00:00:00Z' }] });
  setDemoModeSyncBlock(false);
});
afterEach(() => { useStore.setState(initial); setDemoModeSyncBlock(false); });

describe('Release demo transition acceptance', () => {
  it('does not persist a branch created inside the demo into personal storage', async () => {
    useStore.getState().enterDemoMode({});
    const id = useStore.getState().createBranch('Synthetic demo branch');
    const persisted = useStore.persist.getOptions().partialize!(useStore.getState()) as any;
    expect(persisted.branches.some((branch: any) => branch.id === id)).toBe(false);
  });
  it('restores personal branch state on demo exit', async () => {
    useStore.getState().enterDemoMode({});
    useStore.getState().createBranch('Synthetic demo branch');
    await useStore.getState().exitDemoMode();
    expect(useStore.getState().branches).toEqual([]);
    expect(useStore.getState().activeBranchId).toBe('main');
  });
  it('does not attach account A snapshot to account B after a demo account switch', async () => {
    useStore.getState().enterDemoMode({});
    useStore.getState().setCurrentUser({ uid: 'synthetic-B' } as any);
    await useStore.getState().exitDemoMode();
    expect(useStore.getState().messages.some(message => message.id === 'personal-A')).toBe(false);
  });
});

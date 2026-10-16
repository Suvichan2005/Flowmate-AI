import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asyncStorage } from '../services/storage/asyncStorageAdapter';

const post = vi.fn();
beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('BroadcastChannel', class {
        postMessage = post;
        close() {}
    });
    post.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('Cross-tab persistence notification quiescence', () => {
    it('does not rebroadcast an identical hydration snapshot', async () => {
        const snapshot = JSON.stringify({ state: { kernelEntities: {}, messages: [], settings: {} }, version: 17 });
        await asyncStorage.setItem('flowmate-storage', snapshot);
        // A peer rehydrate calls setHydrated; Zustand persists the same partialized bytes.
        await asyncStorage.setItem('flowmate-storage', snapshot);
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('still commits and notifies genuinely changed personal state', async () => {
        await asyncStorage.setItem('flowmate-storage', JSON.stringify({ state: { kernelEntities: {}, messages: [] }, version: 17 }));
        await asyncStorage.setItem('flowmate-storage', JSON.stringify({ state: { kernelEntities: {}, messages: [{ id: 'synthetic', text: 'new' }] }, version: 17 }));
        expect(post).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem('flowmate-storage')).toContain('synthetic');
    });
});

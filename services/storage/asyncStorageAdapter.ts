// Async Storage Adapter for Zustand
// Wraps our cross-platform storage for use with Zustand persist middleware

import { StateStorage } from 'zustand/middleware';
import { createStorageAdapter } from './storageFactory';
import { IStorageAdapter } from './IStorageAdapter';

let adapter: IStorageAdapter | null = null;
let initPromise: Promise<IStorageAdapter> | null = null;

async function getAdapter(): Promise<IStorageAdapter> {
    if (adapter) return adapter;

    if (!initPromise) {
        initPromise = createStorageAdapter().then(a => {
            adapter = a;
            return a;
        });
    }

    return initPromise;
}

// Zustand-compatible async storage
export const asyncStorage: StateStorage = {
    getItem: async (name: string): Promise<string | null> => {
        const storage = await getAdapter();
        return storage.getItem(name);
    },
    setItem: async (name: string, value: string): Promise<void> => {
        const storage = await getAdapter();
        return storage.setItem(name, value);
    },
    removeItem: async (name: string): Promise<void> => {
        const storage = await getAdapter();
        return storage.removeItem(name);
    },
};

// Export factory for direct use
export { createStorageAdapter, getAdapter };

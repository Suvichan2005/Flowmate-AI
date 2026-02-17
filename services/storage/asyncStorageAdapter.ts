// Async Storage Adapter for Zustand
// Wraps localStorage in the StateStorage interface for Zustand persist middleware

import { StateStorage } from 'zustand/middleware';

export const asyncStorage: StateStorage = {
    getItem: async (name: string): Promise<string | null> => {
        return localStorage.getItem(name);
    },
    setItem: async (name: string, value: string): Promise<void> => {
        localStorage.setItem(name, value);
    },
    removeItem: async (name: string): Promise<void> => {
        localStorage.removeItem(name);
    },
};

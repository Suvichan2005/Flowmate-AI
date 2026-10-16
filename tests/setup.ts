import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';

// Real in-memory store for localStorage mock
let storageStore: Record<string, string> = {};

const localStorageMock = {
    getItem: vi.fn((key: string) => storageStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
        try {
            Storage.prototype.setItem.call(localStorageMock, key, value);
        } catch (e: any) {
            if (e?.name === 'SecurityError' || e instanceof DOMException) {
                throw e;
            }
        }
        storageStore[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => { delete storageStore[key]; }),
    clear: vi.fn(() => { storageStore = {}; }),
};
Object.setPrototypeOf(localStorageMock, Storage.prototype);
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock crypto.randomUUID for uuid generation
Object.defineProperty(globalThis, 'crypto', {
    value: {
        randomUUID: () => 'mock-uuid-' + Math.random().toString(36).substring(2, 9),
    },
});

// Reset all mocks before each test
beforeEach(() => {
    vi.clearAllMocks();
    storageStore = {};
});

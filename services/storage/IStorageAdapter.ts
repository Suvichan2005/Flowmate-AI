// Storage Adapter Interface
// Abstract interface for cross-platform storage (SQLite on native, localStorage on web)

export interface IStorageAdapter {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
    isReady(): Promise<boolean>;
}

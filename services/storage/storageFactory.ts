// Storage Factory
// Platform-aware factory that returns the appropriate storage adapter

import { Capacitor } from '@capacitor/core';
import { IStorageAdapter } from './IStorageAdapter';

let storageInstance: IStorageAdapter | null = null;

export async function createStorageAdapter(): Promise<IStorageAdapter> {
    if (storageInstance) {
        return storageInstance;
    }

    if (Capacitor.isNativePlatform()) {
        console.log('[StorageFactory] Native platform detected, using SQLite');
        const { SqliteAdapter } = await import('./SqliteAdapter');
        storageInstance = new SqliteAdapter();
    } else {
        console.log('[StorageFactory] Web platform detected, using localStorage');
        const { LocalStorageAdapter } = await import('./LocalStorageAdapter');
        storageInstance = new LocalStorageAdapter();
    }

    return storageInstance;
}

export function getStorageAdapter(): IStorageAdapter | null {
    return storageInstance;
}

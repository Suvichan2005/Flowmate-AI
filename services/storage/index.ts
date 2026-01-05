// Storage Module Barrel Export
export type { IStorageAdapter } from './IStorageAdapter';
export { LocalStorageAdapter } from './LocalStorageAdapter';
export { SqliteAdapter } from './SqliteAdapter';
export { createStorageAdapter, getStorageAdapter } from './storageFactory';
export { asyncStorage, getAdapter } from './asyncStorageAdapter';

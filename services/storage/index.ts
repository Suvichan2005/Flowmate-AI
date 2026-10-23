// Storage Module Barrel Export
export {
  asyncStorage,
  setupCrossTabSync,
  reconcileStorageSnapshot,
  beginWorkspaceStorageIdentitySwitch,
  finishWorkspaceStorageIdentitySwitch,
  getActiveWorkspaceStorageIdentity,
  getWorkspaceStorageKey,
  readWorkspaceStorageSnapshot,
  copyWorkspaceStorageSnapshot,
  summarizeWorkspaceStorageSnapshot,
} from './asyncStorageAdapter';
export { LocalStorageAdapter } from './LocalStorageAdapter';

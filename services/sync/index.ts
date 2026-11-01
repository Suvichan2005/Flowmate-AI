/**
 * Flowmate Synchronization & Conflict Engine (P1-09 / P1-10)
 *
 * Platform-independent synchronization, deterministic conflict resolution,
 * monotonic revisions, mutation idempotency, durable pending queues,
 * multi-transport WebSocket real-time relays, and pluggable storage backends (Firebase & Google Drive BYOS).
 *
 * STRICT INVARIANT: ZERO `any`
 */

export * from './types';
export * from './idempotency';
export * from './reconciler';
export * from './pendingQueue';
export * from './protocol';
export * from './providers/websocketRelayProvider';
export * from './providers/googleDriveProvider';
export * from './providers/firestoreSyncProvider';
export * from './syncCoordinator';

/**
 * Flowmate Synchronization & Conflict Engine (P1-09)
 *
 * Platform-independent synchronization, deterministic conflict resolution,
 * monotonic revisions, mutation idempotency, and durable pending queues.
 *
 * STRICT INVARIANT: ZERO `any`
 */

export * from './types';
export * from './idempotency';
export * from './reconciler';
export * from './pendingQueue';

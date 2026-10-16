/**
 * Flowmate Synchronization & Conflict Engine — Durable Pending Mutation Queue (P1-09)
 *
 * Implements a durable queue of uncommitted entity mutations to support
 * true offline operation, retry with exponential backoff, and reconciliation on reconnect.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { PendingMutation, PendingMutationStatus } from './types';
import { Entity as KernelEntity } from '../kernel/types';

const STORAGE_KEY = 'flowmate_pending_mutation_queue_v1';

export class PendingMutationQueue {
  private queue: PendingMutation[] = [];
  private readonly storage: Storage | null;

  constructor(customStorage?: Storage) {
    if (customStorage) {
      this.storage = customStorage;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      this.storage = window.localStorage;
    } else {
      this.storage = null;
    }
    this.hydrate();
  }

  /**
   * Rehydrates queue from durable storage.
   */
  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.queue = parsed.filter(
            (item): item is PendingMutation =>
              typeof item === 'object' &&
              item !== null &&
              typeof (item as PendingMutation).mutation_id === 'string' &&
              typeof (item as PendingMutation).entity_id === 'string'
          );
        }
      }
    } catch (e) {
      console.warn('[PendingMutationQueue] Failed to hydrate pending queue:', e);
    }
  }

  /**
   * Persists current queue to durable storage.
   */
  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.warn('[PendingMutationQueue] Failed to persist pending queue:', e);
    }
  }

  /**
   * Enqueues a new pending mutation.
   */
  enqueue(
    mutation_id: string,
    entity_id: string,
    base_revision: number,
    op_type: 'upsert_entity' | 'soft_delete_entity' | 'restore_entity',
    entity: KernelEntity,
    created_at = new Date().toISOString()
  ): PendingMutation {
    // Remove any older uncommitted pending mutation for the same entity to collapse state
    this.queue = this.queue.filter(m => m.entity_id !== entity_id || m.status === 'in_flight');

    const item: PendingMutation = {
      mutation_id,
      entity_id,
      base_revision,
      op_type,
      entity,
      created_at,
      status: 'pending',
      retry_count: 0,
    };

    this.queue.push(item);
    this.persist();
    return item;
  }

  /**
   * Returns all mutations currently in the queue.
   */
  getAll(): readonly PendingMutation[] {
    return [...this.queue];
  }

  /**
   * Returns only mutations ready to be dispatched ('pending').
   */
  getPending(): PendingMutation[] {
    return this.queue.filter(m => m.status === 'pending');
  }

  /**
   * Finds the pending mutation for a given entity, if one exists.
   */
  getByEntityId(entityId: string): PendingMutation | undefined {
    return this.queue.find(m => m.entity_id === entityId);
  }

  /**
   * Marks a mutation as 'in_flight'.
   */
  markInFlight(mutationId: string): void {
    const idx = this.queue.findIndex(m => m.mutation_id === mutationId);
    if (idx >= 0) {
      const prev = this.queue[idx];
      this.queue[idx] = {
        ...prev,
        status: 'in_flight',
        retry_count: prev.retry_count + 1,
      };
      this.persist();
    }
  }

  /**
   * Marks a mutation as 'committed' and removes it from the active queue.
   */
  markCommitted(mutationId: string): void {
    this.queue = this.queue.filter(m => m.mutation_id !== mutationId);
    this.persist();
  }

  /**
   * Marks a mutation as 'rejected' with an error message.
   */
  markRejected(mutationId: string, error?: string): void {
    const idx = this.queue.findIndex(m => m.mutation_id === mutationId);
    if (idx >= 0) {
      this.queue[idx] = {
        ...this.queue[idx],
        status: 'rejected',
        error: error || 'Mutation rejected',
      };
      this.persist();
    }
  }

  /**
   * Resets an in_flight mutation back to 'pending' after a network transient failure.
   */
  retry(mutationId: string): void {
    const idx = this.queue.findIndex(m => m.mutation_id === mutationId);
    if (idx >= 0) {
      this.queue[idx] = {
        ...this.queue[idx],
        status: 'pending',
      };
      this.persist();
    }
  }

  /**
   * Removes a specific mutation from the queue.
   */
  remove(mutationId: string): void {
    this.queue = this.queue.filter(m => m.mutation_id !== mutationId);
    this.persist();
  }

  /**
   * Clears all items in the queue.
   */
  clear(): void {
    this.queue = [];
    this.persist();
  }

  /**
   * Number of items currently in the queue.
   */
  size(): number {
    return this.queue.length;
  }
}

export const globalPendingMutationQueue = new PendingMutationQueue();

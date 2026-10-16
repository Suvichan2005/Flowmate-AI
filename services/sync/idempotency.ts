/**
 * Flowmate Synchronization & Conflict Engine — Idempotency Tracker (P1-09)
 *
 * Tracks processed mutation IDs in a bounded LRU/FIFO set to guarantee
 * that duplicate network deliveries or retried operations are safely no-oped.
 *
 * STRICT INVARIANT: ZERO `any`
 */

export class IdempotencyTracker {
  private readonly maxEntries: number;
  private readonly entries: Set<string>;
  private readonly order: string[];

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
    this.entries = new Set();
    this.order = [];
  }

  /**
   * Checks whether a mutation_id has already been processed.
   */
  has(mutationId: string): boolean {
    if (!mutationId) return false;
    return this.entries.has(mutationId);
  }

  /**
   * Records a mutation_id as processed, evicting the oldest entries if capacity is reached.
   */
  record(mutationId: string): void {
    if (!mutationId || this.entries.has(mutationId)) return;

    if (this.order.length >= this.maxEntries) {
      const oldest = this.order.shift();
      if (oldest) {
        this.entries.delete(oldest);
      }
    }

    this.entries.add(mutationId);
    this.order.push(mutationId);
  }

  /**
   * Resets all tracked entries.
   */
  clear(): void {
    this.entries.clear();
    this.order.length = 0;
  }

  /**
   * Returns current count of tracked mutation IDs.
   */
  size(): number {
    return this.entries.size;
  }
}

export const globalIdempotencyTracker = new IdempotencyTracker();

import { beforeEach, describe, expect, it } from 'vitest';
import { PendingMutationQueue } from '../services/sync/pendingQueue';
import type { Entity as KernelEntity } from '../services/kernel/types';

describe('identity-scoped pending mutation queue', () => {
  beforeEach(() => localStorage.clear());

  it('does not expose one account pending mutations to another account', () => {
    const queue = new PendingMutationQueue(localStorage);
    const entity = { id: 'entity-a', version: 1 } as KernelEntity;
    queue.enqueue('mutation-a', 'entity-a', 0, 'upsert_entity', entity);
    expect(queue.size()).toBe(1);

    queue.setStorageIdentity('account-b');
    expect(queue.size()).toBe(0);
    queue.enqueue('mutation-b', 'entity-b', 0, 'upsert_entity', { id: 'entity-b', version: 1 } as KernelEntity);

    queue.setStorageIdentity('legacy');
    expect(queue.getAll().map(item => item.mutation_id)).toEqual(['mutation-a']);
    queue.setStorageIdentity('account-b');
    expect(queue.getAll().map(item => item.mutation_id)).toEqual(['mutation-b']);
  });
});

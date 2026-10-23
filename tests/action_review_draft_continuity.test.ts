import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveReviewDraft,
  getReviewDraft,
  getLatestReviewDraft,
  deleteReviewDraft,
  clearAllReviewDrafts,
  revalidateReviewDraft
} from '../services/action-review';
import type { Entity as KernelEntity } from '../services/kernel/types';
import type { ToonOperation } from '../types';

function createMockKernelEntity(id: string, title: string, version = 1, updatedAt = '2026-10-12T04:00:00Z'): KernelEntity {
  return {
    id,
    schema_id: 'flowmate.task',
    version,
    title,
    attributes: {
      status: 'pending',
      priority: 'high'
    },
    lifecycle: {
      status: 'active',
      created_at: '2026-10-12T04:00:00Z',
      updated_at: updatedAt,
      deleted_at: null
    },
    provenance: {
      source_type: 'user',
      observed_at: '2026-10-12T04:00:00Z',
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true
    }
  };
}

describe('Action Review Draft Continuity & Current-State Revalidation', () => {
  beforeEach(async () => {
    await clearAllReviewDrafts();
  });

  it('persists and retrieves unconfirmed review drafts across lifecycle', async () => {
    const kernelEntities: Record<string, KernelEntity> = {
      'tsk-101': createMockKernelEntity('tsk-101', 'Prepare Quarterly Review', 1)
    };

    const ops: ToonOperation[] = [
      {
        type: 'update_entity',
        payload: { id: 'tsk-101', title: 'Prepare Q4 Review with Charts' }
      }
    ];

    const draft = await saveReviewDraft(
      'natural_intent',
      'Update Quarterly Review with charts',
      ops,
      kernelEntities,
      { intentKind: 'task_update' }
    );

    expect(draft.id).toBeDefined();
    expect(draft.ops.length).toBe(1);
    expect(draft.targetSnapshots['tsk-101']).toBeDefined();
    expect(draft.targetSnapshots['tsk-101'].version).toBe(1);

    const retrieved = await getReviewDraft(draft.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.rawInput).toBe('Update Quarterly Review with charts');

    const latest = await getLatestReviewDraft();
    expect(latest?.id).toBe(draft.id);

    await deleteReviewDraft(draft.id);
    expect(await getReviewDraft(draft.id)).toBeNull();
  });

  it('keeps recoverable proposals scoped to the account that created them', async () => {
    const uidA = `draft-owner-a-${Date.now()}`;
    const uidB = `draft-owner-b-${Date.now()}`;
    const draft = await saveReviewDraft('manual_edit', 'Account A proposal', [], {}, undefined, uidA);

    expect(await getLatestReviewDraft(uidB)).toBeNull();
    expect((await getLatestReviewDraft(uidA))?.id).toBe(draft.id);

    await deleteReviewDraft(draft.id, uidA);
    await clearAllReviewDrafts(uidA);
    await clearAllReviewDrafts(uidB);
  });

  it('successfully validates clean drafts when kernel state is unchanged', async () => {
    const kernelEntities: Record<string, KernelEntity> = {
      'tsk-201': createMockKernelEntity('tsk-201', 'Write Architecture Spec', 1)
    };

    const ops: ToonOperation[] = [
      {
        type: 'update_entity',
        payload: { id: 'tsk-201', priority: 'critical' }
      },
      {
        type: 'create_entity',
        payload: { id: 'tsk-202', title: 'Submit PR for Review' }
      }
    ];

    const draft = await saveReviewDraft(
      'natural_intent',
      'Make Architecture Spec critical and create PR task',
      ops,
      kernelEntities
    );

    const result = revalidateReviewDraft(draft, kernelEntities);

    expect(result.isValid).toBe(true);
    expect(result.hasConflicts).toBe(false);
    expect(result.validOpCount).toBe(2);
    expect(result.conflictCount).toBe(0);
    expect(result.items[0].status).toBe('valid');
    expect(result.items[1].status).toBe('valid');
  });

  it('detects external modification conflict when entity is modified by peer tab', async () => {
    const initialEntities: Record<string, KernelEntity> = {
      'tsk-301': createMockKernelEntity('tsk-301', 'Design System Spec', 1, '2026-10-12T04:00:00Z')
    };

    const ops: ToonOperation[] = [
      {
        type: 'update_entity',
        payload: { id: 'tsk-301', title: 'Design System Tokens Spec' }
      }
    ];

    const draft = await saveReviewDraft(
      'natural_intent',
      'Update token specs',
      ops,
      initialEntities
    );

    // Simulate external change in peer tab: version increments from 1 -> 2
    const currentEntities: Record<string, KernelEntity> = {
      'tsk-301': createMockKernelEntity('tsk-301', 'Design System Spec [Edited in Tab B]', 2, '2026-10-12T04:05:00Z')
    };

    const result = revalidateReviewDraft(draft, currentEntities);

    expect(result.isValid).toBe(false);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflictCount).toBe(1);
    expect(result.items[0].status).toBe('conflict_modified');
    expect(result.items[0].snapshotVersion).toBe(1);
    expect(result.items[0].currentVersion).toBe(2);
    expect(result.items[0].reason).toContain('modified externally');
  });

  it('detects stale deletion when target entity is removed or tombstoned in interim', async () => {
    const initialEntities: Record<string, KernelEntity> = {
      'tsk-401': createMockKernelEntity('tsk-401', 'Temporary Bug Fix', 1)
    };

    const ops: ToonOperation[] = [
      {
        type: 'delete_entity',
        payload: { id: 'tsk-401' }
      }
    ];

    const draft = await saveReviewDraft(
      'natural_intent',
      'Delete temporary bug fix',
      ops,
      initialEntities
    );

    // Simulate deletion: entity removed completely from store
    const emptyStore: Record<string, KernelEntity> = {};
    const resultMissing = revalidateReviewDraft(draft, emptyStore);

    expect(resultMissing.isValid).toBe(false);
    expect(resultMissing.items[0].status).toBe('stale_deleted');

    // Simulate tombstone deletion: deleted_at set
    const tombstonedStore: Record<string, KernelEntity> = {
      'tsk-401': {
        ...createMockKernelEntity('tsk-401', 'Temporary Bug Fix', 2),
        lifecycle: {
          status: 'deleted',
          created_at: '2026-10-12T04:00:00Z',
          updated_at: '2026-10-12T04:02:00Z',
          deleted_at: '2026-10-12T04:02:00Z'
        }
      }
    };
    const resultTombstoned = revalidateReviewDraft(draft, tombstonedStore);

    expect(resultTombstoned.isValid).toBe(false);
    expect(resultTombstoned.items[0].status).toBe('stale_deleted');
  });

  it('detects ID collision if create operation targets an ID that already exists', async () => {
    const draftOps: ToonOperation[] = [
      {
        type: 'create_entity',
        payload: { id: 'tsk-501', title: 'New Task Collision' }
      }
    ];

    const draft = await saveReviewDraft(
      'natural_intent',
      'Create new task',
      draftOps,
      {}
    );

    // Current store already has an entity with this ID
    const currentStore: Record<string, KernelEntity> = {
      'tsk-501': createMockKernelEntity('tsk-501', 'Pre-existing Task', 1)
    };

    const result = revalidateReviewDraft(draft, currentStore);

    expect(result.isValid).toBe(false);
    expect(result.items[0].status).toBe('id_collision');
    expect(result.items[0].reason).toContain('already exists');
  });

  it('guarantees zero state mutations during draft persistence and revalidation', async () => {
    const kernelEntities: Record<string, KernelEntity> = {
      'tsk-601': createMockKernelEntity('tsk-601', 'Immutable Store Check', 1)
    };

    const initialSnapshot = JSON.stringify(kernelEntities);

    const draft = await saveReviewDraft(
      'natural_intent',
      'Test zero mutation',
      [{ type: 'update_entity', payload: { id: 'tsk-601', title: 'Mutate Attempt' } }],
      kernelEntities
    );

    revalidateReviewDraft(draft, kernelEntities);

    // The live entities object must not have been touched
    expect(JSON.stringify(kernelEntities)).toBe(initialSnapshot);
  });
});

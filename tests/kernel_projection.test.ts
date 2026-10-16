/**
 * Flowmate Greenfield Domain Kernel — Kernel to Legacy Projection Tests
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect } from 'vitest';
import {
  projectKernelToLegacyEntity,
  projectKernelEntitiesToLegacy,
} from '../store/kernelProjection';
import { Entity as KernelEntity } from '../services/kernel';
import { EntityKind, EntityStatus } from '../types';

describe('Stage 2: Kernel to Legacy Projection', () => {
  const sampleKernelTask: KernelEntity = {
    id: 'task_kernel_1',
    schema_id: 'system/task',
    version: 1,
    title: 'Deploy Production Release',
    attributes: {
      priority: 1,
      deadline: '2026-10-08T18:00:00.000Z',
      notes: 'Prepare release notes and run smoke test',
      tags: ['release', 'prod'],
      subtasks: [
        { id: 'st_1', title: 'Smoke test', completed: true },
        { id: 'st_2', title: 'Verify metrics', completed: false },
      ],
    },
    lifecycle: {
      status: 'in_progress',
      created_at: '2026-10-07T10:00:00.000Z',
      updated_at: '2026-10-07T12:00:00.000Z',
      deleted_at: null,
    },
    provenance: {
      source_type: 'user',
      observed_at: '2026-10-07T10:00:00.000Z',
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
  };

  it('projects a canonical KernelEntity into a frozen legacy Entity shape', () => {
    const legacy = projectKernelToLegacyEntity(sampleKernelTask);

    expect(legacy.id).toBe('task_kernel_1');
    expect(legacy.kind).toBe(EntityKind.TASK);
    expect(legacy.title).toBe('Deploy Production Release');
    expect(legacy.status).toBe(EntityStatus.IN_PROGRESS);
    expect(legacy.priority).toBe(1);
    expect(legacy.deadline).toBe('2026-10-08T18:00:00.000Z');
    expect(legacy.description).toBe('Prepare release notes and run smoke test');
    expect(legacy.canonical_tags).toEqual(['release', 'prod']);

    // Provenance preserved losslessly in metadata
    expect(legacy.metadata._provenance).toEqual(sampleKernelTask.provenance);

    // Enforces runtime immutability: Object must be frozen
    expect(Object.isFrozen(legacy)).toBe(true);
    expect(() => {
      // @ts-expect-error mutating frozen object
      legacy.title = 'Hacked';
    }).toThrow();
  });

  it('projects a dictionary of kernel entities, preserving soft-deleted tombstones with metadata.deleted', () => {
    const deletedKernelTask: KernelEntity = {
      ...sampleKernelTask,
      id: 'task_deleted',
      lifecycle: {
        ...sampleKernelTask.lifecycle,
        deleted_at: '2026-10-07T14:00:00.000Z',
      },
    };

    const dict: Record<string, KernelEntity> = {
      task_kernel_1: sampleKernelTask,
      task_deleted: deletedKernelTask,
    };

    const legacyList = projectKernelEntitiesToLegacy(dict);

    expect(legacyList.length).toBe(2);
    const tombstone = legacyList.find(e => e.id === 'task_deleted');
    expect(tombstone).toBeDefined();
    expect(tombstone?.metadata?.deleted).toBe(true);
    expect(tombstone?.metadata?.deleted_at).toBe('2026-10-07T14:00:00.000Z');
    expect(Object.isFrozen(legacyList)).toBe(true);

    expect(() => {
      legacyList.push(legacyList[0]);
    }).toThrow();
  });
});

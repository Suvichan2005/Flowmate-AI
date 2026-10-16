/**
 * Flowmate Greenfield Domain Kernel — Legacy & Batch Migration Tests
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isLegacyEntityDocument,
  mapLegacyKindToSchemaId,
  upgradeLegacyEntityToKernel,
  upgradeLegacyMealLogToKernel,
  upgradeLegacyAttendanceLogToKernel,
  quarantineCorruptDocument,
  executeBatchMigrationToKernel,
  rollbackBatchMigration,
  getMigrationStatus,
} from '../services/persistence';
import type { Firestore, DocumentData } from 'firebase/firestore';
import { InMemoryPersistenceAdapter } from '../services/kernel';

// Mock Firestore for batch migration tests
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase/firestore', () => {
  return {
    doc: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
    collection: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    setDoc: (...args: unknown[]) => mockSetDoc(...args),
    writeBatch: vi.fn(() => ({
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
  };
});

describe('Stage 1 Audit: Explicit Legacy Migration Engine', () => {
  it('correctly distinguishes legacy vs kernel v5 documents', () => {
    expect(isLegacyEntityDocument({ id: '1', kind: 'TASK', title: 'Legacy' })).toBe(true);
    expect(isLegacyEntityDocument({ id: '2', kind: 'TASK', schema_version: 4 })).toBe(true);
    expect(
      isLegacyEntityDocument({
        id: '3',
        schema_id: 'system/task',
        schema_version: 5,
        title: 'Modern',
      })
    ).toBe(false);
  });

  it('maps legacy EntityKind to appropriate system baseline schema', () => {
    expect(mapLegacyKindToSchemaId('TASK')).toBe('system/task');
    expect(mapLegacyKindToSchemaId('PROJECT')).toBe('system/task');
    expect(mapLegacyKindToSchemaId('GOAL')).toBe('system/goal');
    expect(mapLegacyKindToSchemaId('HABIT')).toBe('system/habit');
    expect(mapLegacyKindToSchemaId('EVENT')).toBe('system/event');
    expect(mapLegacyKindToSchemaId('NOTE')).toBe('system/note');
    expect(mapLegacyKindToSchemaId('PERSON')).toBe('system/person');
    expect(mapLegacyKindToSchemaId('UNKNOWN_ALIEN')).toBe('system/unstructured_item');
  });

  it('upgrades legacy task entity losslessly into Kernel Entity', () => {
    const legacyDoc = {
      id: 'task_legacy_101',
      kind: 'TASK',
      title: 'Complete physics assignment',
      description: 'Chapter 4 problems 1-10',
      status: 'ACTIVE',
      priority: 1,
      deadline: '2026-10-10T23:59:00.000Z',
      duration_minutes: 90,
      canonical_tags: ['homework', 'physics'],
      metadata: {
        custom_difficulty: 'hard',
        subtasks: [{ id: 'sub_1', title: 'Part A', completed: true }],
      },
      created_at: '2026-10-01T10:00:00.000Z',
      updated_at: '2026-10-02T12:00:00.000Z',
      deleted_at: null,
    };

    const kernelEntity = upgradeLegacyEntityToKernel(legacyDoc);

    expect(kernelEntity.id).toBe('task_legacy_101');
    expect(kernelEntity.schema_id).toBe('system/task');
    expect(kernelEntity.version).toBe(1);
    expect(kernelEntity.title).toBe('Complete physics assignment');
    expect(kernelEntity.lifecycle.status).toBe('active');
    expect(kernelEntity.provenance.source_type).toBe('user');
    expect(kernelEntity.provenance.confidence).toBe(1.0);

    // Attributes verification
    expect(kernelEntity.attributes.priority).toBe(1);
    expect(kernelEntity.attributes.deadline).toBe('2026-10-10T23:59:00.000Z');
    expect(kernelEntity.attributes.duration_minutes).toBe(90);
    expect(kernelEntity.attributes.notes).toBe('Chapter 4 problems 1-10');
    expect(kernelEntity.attributes.tags).toEqual(['homework', 'physics']);
    expect(kernelEntity.attributes.custom_difficulty).toBe('hard');
    expect(kernelEntity.attributes.subtasks).toBeDefined();
  });

  it('upgrades legacy food log entry into system/meal_log', () => {
    const legacyFood = {
      id: 'meal_301',
      food_name: 'Paneer Butter Masala & Roti',
      meal_type: 'dinner',
      calories: 650,
      protein_g: 22,
      carbs_g: 75,
      fat_g: 28,
      cost: 180,
      source: 'outside',
      vendor: 'Royal Dhaba',
      rating: 5,
      timestamp: '2026-10-06T20:30:00.000Z',
    };

    const mealEntity = upgradeLegacyMealLogToKernel(legacyFood);

    expect(mealEntity.id).toBe('meal_301');
    expect(mealEntity.schema_id).toBe('system/meal_log');
    expect(mealEntity.title).toBe('Paneer Butter Masala & Roti');
    expect(mealEntity.attributes.calories).toBe(650);
    expect(mealEntity.attributes.cost).toEqual({ amount: 180, currency: 'INR' });
    expect(mealEntity.attributes.vendor).toBe('Royal Dhaba');
    expect(mealEntity.lifecycle.status).toBe('active');
  });

  it('upgrades legacy attendance log entry into system/attendance_record', () => {
    const legacyAttendance = {
      id: 'att_501',
      subject_id: 'CS301',
      date: '2026-10-07',
      status: 'present',
    };

    const attEntity = upgradeLegacyAttendanceLogToKernel(legacyAttendance, {
      CS301: 'Operating Systems',
    });

    expect(attEntity.id).toBe('att_501');
    expect(attEntity.schema_id).toBe('system/attendance_record');
    expect(attEntity.title).toBe('Operating Systems (2026-10-07)');
    expect(attEntity.attributes.subject_name).toBe('Operating Systems');
    expect(attEntity.attributes.status).toBe('present');
  });

  it('quarantines corrupt or malformed documents into system/unstructured_item without data loss', () => {
    const malformed = {
      id: 'corrupt_99',
      kind: 'CORRUPT_UNKNOWN_BLOB',
      mystery_key: 12345,
    };

    const quarantined = quarantineCorruptDocument(malformed, 'Unrecognized kind');

    expect(quarantined.schema_id).toBe('system/unstructured_item');
    expect(quarantined.lifecycle.status).toBe('quarantined');
    expect(quarantined.attributes.quarantine_reason).toBe('Unrecognized kind');
    expect(quarantined.attributes.raw_payload).toEqual(malformed);
  });
});

describe('Stage 1 Audit: Authoritative Batch Migration & Rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes batch migration with pre-migration backup and idempotency', async () => {
    const mockDb = { type: 'mock_firestore' } as unknown as Firestore;
    const persistenceAdapter = new InMemoryPersistenceAdapter();

    // 1. Mock status: not yet migrated
    mockGetDoc.mockResolvedValueOnce({
      exists: () => false,
      data: () => ({}),
    });

    // 2. Mock legacy entities
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: 'task_legacy_1',
          data: () => ({
            id: 'task_legacy_1',
            kind: 'TASK',
            title: 'Legacy Task 1',
            status: 'ACTIVE',
          }),
        },
      ],
    });

    // 3. Mock food meta doc
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        foodLogs: [
          {
            id: 'meal_1',
            food_name: 'Oatmeal',
            calories: 300,
            timestamp: '2026-10-07T08:00:00.000Z',
          },
        ],
      }),
    });

    // 4. Mock attendance meta doc
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        subjects: [{ id: 'MATH', name: 'Mathematics' }],
        attendanceLogs: [
          {
            id: 'att_1',
            subject_id: 'MATH',
            date: '2026-10-07',
            status: 'present',
          },
        ],
      }),
    });

    const result = await executeBatchMigrationToKernel(mockDb, 'usr_batch_test', persistenceAdapter);

    expect(result.success).toBe(true);
    expect(result.alreadyMigrated).toBe(false);
    expect(result.migratedCount).toBe(3); // 1 task + 1 meal + 1 attendance

    // Verify backup was written to /users/usr_batch_test/meta/backup_pre_v5
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/usr_batch_test/meta/backup_pre_v5' }),
      expect.objectContaining({
        entities: expect.any(Array),
        food: expect.any(Object),
        attendance: expect.any(Object),
      })
    );

    // Verify migration status was written
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/usr_batch_test/meta/migration_v5_status' }),
      expect.objectContaining({
        status: 'completed',
        version: 5,
        total_entities: 3,
      })
    );

    // Verify migrated entities are accessible in persistence adapter
    const migratedTask = await persistenceAdapter.getEntity('task_legacy_1');
    expect(migratedTask).not.toBeNull();
    expect(migratedTask?.schema_id).toBe('system/task');

    const migratedMeal = await persistenceAdapter.getEntity('meal_1');
    expect(migratedMeal).not.toBeNull();
    expect(migratedMeal?.schema_id).toBe('system/meal_log');
  });

  it('skips migration when user is already marked as completed version 5', async () => {
    const mockDb = { type: 'mock_firestore' } as unknown as Firestore;
    const persistenceAdapter = new InMemoryPersistenceAdapter();

    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ status: 'completed', version: 5 }),
    });

    const result = await executeBatchMigrationToKernel(mockDb, 'usr_batch_test', persistenceAdapter);
    expect(result.alreadyMigrated).toBe(true);
    expect(result.migratedCount).toBe(0);
  });

  it('rolls back batch migration using pre-v5 snapshot', async () => {
    const mockDb = { type: 'mock_firestore' } as unknown as Firestore;

    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        created_at: '2026-10-07T00:00:00.000Z',
        entities: [
          { id: 'task_legacy_1', kind: 'TASK', title: 'Original Legacy Task' },
        ],
      }),
    });

    const rollbackResult = await rollbackBatchMigration(mockDb, 'usr_batch_test');

    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.restoredCount).toBe(1);

    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/usr_batch_test/entities/task_legacy_1' }),
      expect.objectContaining({ title: 'Original Legacy Task' })
    );

    // Verify status was set to rolled_back
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/usr_batch_test/meta/migration_v5_status' }),
      expect.objectContaining({
        status: 'rolled_back',
        restored_entities: 1,
      })
    );
  });
});

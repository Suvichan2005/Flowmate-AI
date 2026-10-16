/**
 * Flowmate Greenfield Domain Kernel — Stage 1: Persistence Port & Bootstrap Engine Tests
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SchemaRegistry,
  CapabilityRegistry,
  bootstrapKernel,
  registerSystemSchemas,
  registerSystemCapabilities,
  BASELINE_SYSTEM_SCHEMAS,
  SCHEDULABLE_CAPABILITY,
  TRACKABLE_PROGRESS_CAPABILITY,
  EVALUABLE_STATE_CAPABILITY,
  RECURRENT_CAPABILITY,
  Entity,
  KernelAuthorizer,
} from '../services/kernel';
import {
  FirestorePersistenceAdapter,
  encodeSchemaDocId,
  decodeSchemaDocId,
} from '../services/persistence';
import type { Firestore, DocumentData } from 'firebase/firestore';

// Mock firebase/firestore module
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => {
  return {
    doc: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
    collection: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    writeBatch: vi.fn(() => ({
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
  };
});

describe('Stage 1: Bootstrap Engine', () => {
  let schemaRegistry: SchemaRegistry;
  let capabilityRegistry: CapabilityRegistry;

  beforeEach(() => {
    schemaRegistry = new SchemaRegistry();
    capabilityRegistry = new CapabilityRegistry();
  });

  it('validates and registers all baseline system schemas without errors', () => {
    for (const schema of BASELINE_SYSTEM_SCHEMAS) {
      const validation = schemaRegistry.validateSchemaDefinition(schema);
      expect(
        validation.valid,
        `Schema ${schema.id} failed validation: ${validation.errors.join(', ')}`
      ).toBe(true);
    }

    registerSystemSchemas(schemaRegistry);
    const registered = schemaRegistry.list();
    expect(registered.length).toBe(BASELINE_SYSTEM_SCHEMAS.length);

    // Verify key schemas exist
    expect(schemaRegistry.get('system/task')).toBeDefined();
    expect(schemaRegistry.get('system/event')).toBeDefined();
    expect(schemaRegistry.get('system/note')).toBeDefined();
    expect(schemaRegistry.get('system/person')).toBeDefined();
    expect(schemaRegistry.get('system/meal_log')).toBeDefined();
    expect(schemaRegistry.get('system/attendance_record')).toBeDefined();
    expect(schemaRegistry.get('system/unstructured_item')).toBeDefined();
  });

  it('registers all baseline capabilities and verifies contract extraction', () => {
    registerSystemCapabilities(capabilityRegistry);

    expect(capabilityRegistry.get('schedulable')).toBeDefined();
    expect(capabilityRegistry.get('trackable_progress')).toBeDefined();
    expect(capabilityRegistry.get('evaluable_state')).toBeDefined();
    expect(capabilityRegistry.get('recurrent')).toBeDefined();
    expect(capabilityRegistry.get('locational')).toBeDefined();
    expect(capabilityRegistry.get('metric')).toBeDefined();
  });

  it('satisfies schedulable capability with deadline or start/end times', () => {
    const taskEntity: Entity = {
      id: 'task_1',
      schema_id: 'system/task',
      version: 1,
      title: 'Submit quarterly tax report',
      attributes: {
        deadline: '2026-10-15T18:00:00.000Z',
        priority: 1,
      },
      lifecycle: {
        status: 'active',
        created_at: '2026-10-07T00:00:00.000Z',
        updated_at: '2026-10-07T00:00:00.000Z',
        deleted_at: null,
      },
      provenance: {
        source_type: 'user',
        observed_at: '2026-10-07T00:00:00.000Z',
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    };

    expect(SCHEDULABLE_CAPABILITY.is_satisfied_by(taskEntity)).toBe(true);
    const contract = SCHEDULABLE_CAPABILITY.extract_contract(taskEntity);
    expect(contract.deadline).toBe('2026-10-15T18:00:00.000Z');
  });

  it('satisfies trackable_progress capability with subtasks', () => {
    const projectEntity: Entity = {
      id: 'proj_1',
      schema_id: 'system/task',
      version: 1,
      title: 'Build Greenfield Domain Kernel',
      attributes: {
        subtasks: [
          { id: '1', title: 'Phase 0 Spike', completed: true },
          { id: '2', title: 'Stage 1 Bootstrap', completed: true },
          { id: '3', title: 'Stage 2 Inversion', completed: false },
          { id: '4', title: 'Stage 3 Pipeline', completed: false },
        ],
      },
      lifecycle: {
        status: 'in_progress',
        created_at: '2026-10-07T00:00:00.000Z',
        updated_at: '2026-10-07T00:00:00.000Z',
        deleted_at: null,
      },
      provenance: {
        source_type: 'user',
        observed_at: '2026-10-07T00:00:00.000Z',
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    };

    expect(TRACKABLE_PROGRESS_CAPABILITY.is_satisfied_by(projectEntity)).toBe(true);
    const contract = TRACKABLE_PROGRESS_CAPABILITY.extract_contract(projectEntity);
    expect(contract.current).toBe(2);
    expect(contract.target).toBe(4);
    expect(contract.percentage).toBe(50);
  });

  it('satisfies evaluable_state capability', () => {
    const completedEntity: Entity = {
      id: 'task_completed',
      schema_id: 'system/task',
      version: 1,
      title: 'Archived task',
      attributes: {},
      lifecycle: {
        status: 'completed',
        created_at: '2026-10-07T00:00:00.000Z',
        updated_at: '2026-10-07T00:00:00.000Z',
        deleted_at: null,
      },
      provenance: {
        source_type: 'user',
        observed_at: '2026-10-07T00:00:00.000Z',
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    };

    expect(EVALUABLE_STATE_CAPABILITY.is_satisfied_by(completedEntity)).toBe(true);
    const contract = EVALUABLE_STATE_CAPABILITY.extract_contract(completedEntity);
    expect(contract.is_completed).toBe(true);
  });

  it('satisfies recurrent capability with cadence rule', () => {
    const habitEntity: Entity = {
      id: 'habit_1',
      schema_id: 'user/cadence_commitment',
      version: 1,
      title: 'Work on Flowmate weekly',
      attributes: {
        cadence_rrule: 'FREQ=WEEKLY;INTERVAL=1',
      },
      lifecycle: {
        status: 'active',
        created_at: '2026-10-07T00:00:00.000Z',
        updated_at: '2026-10-07T00:00:00.000Z',
        deleted_at: null,
      },
      provenance: {
        source_type: 'user',
        observed_at: '2026-10-07T00:00:00.000Z',
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    };

    expect(RECURRENT_CAPABILITY.is_satisfied_by(habitEntity)).toBe(true);
    const contract = RECURRENT_CAPABILITY.extract_contract(habitEntity);
    expect(contract.rrule).toBe('FREQ=WEEKLY;INTERVAL=1');
  });

  it('bootstraps both schemas and capabilities via bootstrapKernel helper', () => {
    bootstrapKernel({ schemas: schemaRegistry, capabilities: capabilityRegistry });
    expect(schemaRegistry.list().length).toBeGreaterThanOrEqual(7);
    expect(capabilityRegistry.list().length).toBeGreaterThanOrEqual(6);
  });
});

describe('Stage 1: Firestore Persistence Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly encodes and decodes schema IDs for Firestore document keys', () => {
    expect(encodeSchemaDocId('system/task')).toBe('system__task');
    expect(decodeSchemaDocId('system__task')).toBe('system/task');

    expect(encodeSchemaDocId('user/cadence_commitment')).toBe('user__cadence_commitment');
    expect(decodeSchemaDocId('user__cadence_commitment')).toBe('user/cadence_commitment');
  });

  it('fails fast on mutations when database is uninitialized or user is unauthenticated', async () => {
    const unauthedAdapter = new FirestorePersistenceAdapter({
      db: {} as Firestore,
      getUserId: () => null,
    });

    await expect(
      unauthedAdapter.commitBatch([
        {
          type: 'soft_delete_entity',
          id: 'ent_1',
        },
      ])
    ).rejects.toThrow('No authenticated user context available');

    const uninitAdapter = new FirestorePersistenceAdapter({
      db: null,
      getUserId: () => 'usr_1',
    });

    await expect(
      uninitAdapter.commitBatch([
        {
          type: 'soft_delete_entity',
          id: 'ent_1',
        },
      ])
    ).rejects.toThrow('Firebase Firestore is not initialized');
  });

  it('returns null / empty arrays gracefully on reads when unauthenticated or uninitialized', async () => {
    const unauthedAdapter = new FirestorePersistenceAdapter({
      db: null,
      getUserId: () => null,
    });

    expect(await unauthedAdapter.getEntity('ent_1')).toBeNull();
    expect(await unauthedAdapter.queryEntities({})).toEqual([]);
    expect(await unauthedAdapter.getSchema('system/task')).toBeNull();
    expect(await unauthedAdapter.listSchemas()).toEqual([]);
    expect(await unauthedAdapter.getAuditLogs()).toEqual([]);
  });

  it('commits a multi-mutation batch with schema_version: 5 and read mirrors', async () => {
    const mockDb = { type: 'mock_firestore' } as unknown as Firestore;
    const adapter = new FirestorePersistenceAdapter({
      db: mockDb,
      getUserId: () => 'usr_test_123',
    });

    const testEntity: Entity = {
      id: 'task_abc',
      schema_id: 'system/task',
      version: 1,
      title: 'Conduct Q4 Planning',
      attributes: {
        priority: 2,
        notes: 'Draft OKRs',
      },
      lifecycle: {
        status: 'active',
        created_at: '2026-10-07T00:00:00.000Z',
        updated_at: '2026-10-07T00:00:00.000Z',
        deleted_at: null,
      },
      provenance: {
        source_type: 'user',
        observed_at: '2026-10-07T00:00:00.000Z',
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    };

    const testSchema = BASELINE_SYSTEM_SCHEMAS[0];

    await adapter.commitBatch([
      { type: 'set_entity', entity: testEntity },
      { type: 'soft_delete_entity', id: 'task_old' },
      { type: 'set_schema', schema: testSchema },
      {
        type: 'append_audit_log',
        entry: {
          id: 'log_1',
          timestamp: '2026-10-07T12:00:00.000Z',
          source: 'user_ui',
          intent: 'Created Task and Schema',
          mutation_count: 3,
        },
      },
    ]);

    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(mockBatchSet).toHaveBeenCalledTimes(4);

    // Verify entity write payload contains schema_version: 5 and legacy mirrors
    const entityCallPayload = mockBatchSet.mock.calls[0][1] as Record<string, unknown>;
    expect(entityCallPayload.schema_version).toBe(5);
    expect(entityCallPayload.title).toBe('Conduct Q4 Planning');
    expect(entityCallPayload.status).toBe('active');
    expect(entityCallPayload.kind).toBe('TASK');

    // Verify soft delete sets deleted_at
    const softDeletePayload = mockBatchSet.mock.calls[1][1] as Record<string, unknown>;
    expect(softDeletePayload['lifecycle.deleted_at']).toBeDefined();

    // Verify schema write
    const schemaCallPayload = mockBatchSet.mock.calls[2][1] as Record<string, unknown>;
    expect(schemaCallPayload.id).toBe('system/task');

    // Verify audit log write
    const auditCallPayload = mockBatchSet.mock.calls[3][1] as Record<string, unknown>;
    expect(auditCallPayload.id).toBe('log_1');
    expect(auditCallPayload.mutation_count).toBe(3);
  });

  it('reads and parses entity from Firestore snapshot', async () => {
    const mockDb = { type: 'mock_firestore' } as unknown as Firestore;
    const adapter = new FirestorePersistenceAdapter({
      db: mockDb,
      getUserId: () => 'usr_test_123',
    });

    const mockDocData: DocumentData = {
      schema_id: 'system/task',
      version: 2,
      title: 'Review PR #42',
      attributes: { priority: 1 },
      lifecycle: {
        status: 'active',
        created_at: '2026-10-07T01:00:00.000Z',
        updated_at: '2026-10-07T02:00:00.000Z',
        deleted_at: null,
      },
      provenance: {
        source_type: 'agent',
        observed_at: '2026-10-07T01:00:00.000Z',
        confidence: 0.95,
        is_inferred: true,
        user_confirmed: false,
      },
    };

    mockGetDoc.mockResolvedValueOnce({
      id: 'task_pr',
      exists: () => true,
      data: () => mockDocData,
    });

    const entity = await adapter.getEntity('task_pr');
    expect(entity).not.toBeNull();
    expect(entity?.id).toBe('task_pr');
    expect(entity?.schema_id).toBe('system/task');
    expect(entity?.version).toBe(2);
    expect(entity?.provenance.is_inferred).toBe(true);
    expect(entity?.provenance.confidence).toBe(0.95);
  });

  it('queries entities, filtering by schema_id and status while excluding soft-deleted', async () => {
    const mockDb = { type: 'mock_firestore' } as unknown as Firestore;
    const adapter = new FirestorePersistenceAdapter({
      db: mockDb,
      getUserId: () => 'usr_test_123',
    });

    const activeTask: DocumentData = {
      schema_id: 'system/task',
      version: 1,
      title: 'Active Task',
      attributes: {},
      lifecycle: { status: 'active', deleted_at: null },
      provenance: { source_type: 'user', confidence: 1 },
    };

    const completedTask: DocumentData = {
      schema_id: 'system/task',
      version: 1,
      title: 'Completed Task',
      attributes: {},
      lifecycle: { status: 'completed', deleted_at: null },
      provenance: { source_type: 'user', confidence: 1 },
    };

    const deletedTask: DocumentData = {
      schema_id: 'system/task',
      version: 1,
      title: 'Deleted Task',
      attributes: {},
      lifecycle: { status: 'active', deleted_at: '2026-10-07T00:00:00.000Z' },
      provenance: { source_type: 'user', confidence: 1 },
    };

    const eventDoc: DocumentData = {
      schema_id: 'system/event',
      version: 1,
      title: 'Team Sync',
      attributes: {},
      lifecycle: { status: 'active', deleted_at: null },
      provenance: { source_type: 'user', confidence: 1 },
    };

    mockGetDocs.mockResolvedValueOnce({
      docs: [
        { id: '1', data: () => activeTask },
        { id: '2', data: () => completedTask },
        { id: '3', data: () => deletedTask },
        { id: '4', data: () => eventDoc },
      ],
    });

    // Query for active tasks only
    const results = await adapter.queryEntities({
      schema_id: 'system/task',
      status: 'active',
    });

    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Active Task');
  });

  it('lists schemas and audit logs sorted by timestamp descending', async () => {
    const mockDb = { type: 'mock_firestore' } as unknown as Firestore;
    const adapter = new FirestorePersistenceAdapter({
      db: mockDb,
      getUserId: () => 'usr_test_123',
    });

    // Mock audit logs
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: 'log_older',
          data: () => ({
            timestamp: '2026-10-07T10:00:00.000Z',
            source: 'user_ui',
            intent: 'Old action',
            mutation_count: 1,
          }),
        },
        {
          id: 'log_newer',
          data: () => ({
            timestamp: '2026-10-07T14:00:00.000Z',
            source: 'ai_agent',
            intent: 'New action',
            mutation_count: 2,
          }),
        },
      ],
    });

    const logs = await adapter.getAuditLogs();
    expect(logs.length).toBe(2);
    expect(logs[0].id).toBe('log_newer');
    expect(logs[1].id).toBe('log_older');
  });

  it('enforces query authorization boundaries and clamps AI agent scope/privacy tier', () => {
    const authorizer = new KernelAuthorizer();

    // 1. Unauthenticated query rejected
    const unauthed = authorizer.authorizeQuery(
      { actor: 'ai_agent', authenticated_user_id: '' },
      'all'
    );
    expect(unauthed.authorized).toBe(false);

    // 2. AI agent requesting 'all' is strictly clamped to system and user, and max_privacy_tier 'private'
    const aiQuery = authorizer.authorizeQuery(
      { actor: 'ai_agent', authenticated_user_id: 'usr_ai_test' },
      'all'
    );
    expect(aiQuery.authorized).toBe(true);
    expect(aiQuery.effective_scopes).toEqual(['system', 'user']);
    expect(aiQuery.max_privacy_tier).toBe('private');

    // 3. Authenticated user UI has full clearance including device_local
    const userQuery = authorizer.authorizeQuery(
      { actor: 'user_ui', authenticated_user_id: 'usr_owner' },
      'all'
    );
    expect(userQuery.authorized).toBe(true);
    expect(userQuery.effective_scopes).toEqual(['system', 'user', 'module']);
    expect(userQuery.max_privacy_tier).toBe('device_local');
  });
});

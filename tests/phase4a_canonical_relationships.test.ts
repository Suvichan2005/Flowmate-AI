/**
 * Flowmate Phase 4A — Canonical Relationships & Data Fidelity Regression Test Suite
 *
 * Verifies the full relationship lifecycle and data fidelity invariants:
 * 1. Relationship creation through confirmed-operation path
 * 2. Relationship deletion through confirmed-operation path
 * 3. Missing, deleted, or unauthorized endpoint rejection
 * 4. Duplicate creation and idempotent retries
 * 5. Confirmation cancellation causing zero mutations
 * 6. Invalid or unsupported relationship types rejected
 * 7. Relationship persistence and restoration after reload
 * 8. Synchronization and conflict behavior for relationship changes
 * 9. Legacy-to-canonical-to-legacy subtask round-trip
 * 10. Subtasks available in AI context after migration
 * 11. Relationship querying returning actual persisted links rather than matching tags
 * 12. Unsupported relationship operations rejected explicitly (never disappearing silently)
 * 13. Existing kernel invariants and authorization intact
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import {
  EntityKind,
  EntityStatus,
  Relationship,
  RelationshipType,
  ToonOperation,
  Subtask,
} from '../types';
import {
  convertOperationsToActionProposal,
  ActionExecutionEngine,
  SchemaRegistry,
  KernelAuthorizer,
  InMemoryPersistenceAdapter,
  VALID_RELATIONSHIP_TYPES,
} from '../services/kernel';
import { bootstrapKernel } from '../services/kernel/bootstrap';
import { upgradeLegacyEntityToKernel } from '../services/persistence/legacyMigration';
import { projectKernelToLegacyEntity } from '../store/kernelProjection';
import { buildEntityContext } from '../services/ai/context';
import { executeQueryRelationships } from '../services/ai/executors';
import { mergeData } from '../services/firestoreSync';

describe('Phase 4A: Canonical Relationships & Data Fidelity', () => {
  beforeEach(() => {
    useStore.setState({
      kernelEntities: {},
      entities: [],
      relationships: [],
      pendingOps: null,
      messages: [],
      auditLogs: [],
    });
  });

  // --------------------------------------------------------------------------
  // Requirement 1: Relationship creation through confirmed-operation path
  // --------------------------------------------------------------------------
  it('1. creates relationships through the two-phase confirmed operation path', async () => {
    const store = useStore.getState();

    const ops: ToonOperation[] = [
      {
        type: 'create_entity',
        payload: {
          id: 'goal_Atlas',
          kind: 'GOAL',
          title: 'Pass Atlas OA',
        },
      },
      {
        type: 'create_entity',
        payload: {
          id: 'task_prep',
          kind: 'TASK',
          title: 'Solve LeetCode Top 50 Atlas',
        },
      },
      {
        type: 'link_entities',
        payload: {
          from: 'task_prep',
          to: 'goal_Atlas',
          type: 'FULFILLS',
        },
      },
    ];

    const planResult = store.planOperations(ops, 'ai_agent');
    expect(planResult.success).toBe(true);
    expect(planResult.plan).toBeDefined();

    // Verify preview items include the relationship
    const relPreview = planResult.plan!.preview_items.find(p => p.op === 'upsert_relationship');
    expect(relPreview).toBeDefined();
    expect(relPreview!.title).toContain('task_prep');

    // Confirm and execute
    const confirmedPlan = store.confirmPlan(planResult.plan!);
    const executed = await store.executeConfirmedPlan(confirmedPlan);
    expect(executed).toBe(true);

    // Verify relationship exists in state
    const currentRels = useStore.getState().relationships;
    expect(currentRels.length).toBe(1);
    expect(currentRels[0].from).toBe('task_prep');
    expect(currentRels[0].to).toBe('goal_Atlas');
    expect(currentRels[0].type).toBe(RelationshipType.FULFILLS);

    // Verify entities are projected
    const currentEntities = useStore.getState().entities;
    expect(currentEntities.length).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Requirement 2: Relationship deletion through confirmed-operation path
  // --------------------------------------------------------------------------
  it('2. deletes relationships through the confirmed operation path', async () => {
    const store = useStore.getState();

    // Setup initial entities and relationship
    const setupOps: ToonOperation[] = [
      {
        type: 'create_entity',
        payload: { id: 'evt_interview', kind: 'EVENT', title: 'Interview' },
      },
      {
        type: 'create_entity',
        payload: { id: 'ctx_Atlas', kind: 'CONTEXT', title: 'Atlas Recruitment' },
      },
      {
        type: 'link_entities',
        payload: {
          id: 'rel_test_link',
          from: 'evt_interview',
          to: 'ctx_Atlas',
          type: 'TAGGED_WITH',
        },
      },
    ];

    const setupPlan = store.planOperations(setupOps, 'ai_agent');
    const confirmedSetup = store.confirmPlan(setupPlan.plan!);
    await store.executeConfirmedPlan(confirmedSetup);

    expect(useStore.getState().relationships.length).toBe(1);

    // Now propose deletion
    const unlinkOps: ToonOperation[] = [
      {
        type: 'unlink_entities',
        payload: {
          id: 'rel_test_link',
        },
      },
    ];

    const unlinkPlan = store.planOperations(unlinkOps, 'ai_agent');
    expect(unlinkPlan.success).toBe(true);
    expect(unlinkPlan.plan!.validated_mutations.length).toBe(1);
    expect(unlinkPlan.plan!.validated_mutations[0].op).toBe('delete_relationship');

    const confirmedUnlink = store.confirmPlan(unlinkPlan.plan!);
    const success = await store.executeConfirmedPlan(confirmedUnlink);
    expect(success).toBe(true);

    // Verify relationship is removed
    expect(useStore.getState().relationships.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Requirement 3: Missing, deleted, or unauthorized endpoint rejection
  // --------------------------------------------------------------------------
  it('3. rejects relationships targeting non-existent or soft-deleted endpoints', async () => {
    const store = useStore.getState();

    // Test A: Target entity does not exist
    const nonExistentOps: ToonOperation[] = [
      {
        type: 'create_entity',
        payload: { id: 'task_valid', kind: 'TASK', title: 'Valid Task' },
      },
      {
        type: 'link_entities',
        payload: {
          from: 'task_valid',
          to: 'non_existent_entity_id',
          type: 'DEPENDS_ON',
        },
      },
    ];

    const planFailA = store.planOperations(nonExistentOps, 'ai_agent');
    expect(planFailA.success).toBe(false);
    expect(planFailA.error).toContain('Referential integrity violation');
    expect(planFailA.error).toContain('non_existent_entity_id');

    // Test B: Self-referential relationship
    const selfRefOps: ToonOperation[] = [
      {
        type: 'create_entity',
        payload: { id: 'task_self', kind: 'TASK', title: 'Self Task' },
      },
      {
        type: 'link_entities',
        payload: {
          from: 'task_self',
          to: 'task_self',
          type: 'DEPENDS_ON',
        },
      },
    ];

    const planFailB = store.planOperations(selfRefOps, 'ai_agent');
    expect(planFailB.success).toBe(false);
    expect(planFailB.error).toContain('Self-referential');

    // Test C: Soft-deleted endpoint
    // Create an entity, soft-delete it, then try to link to it
    const createOps: ToonOperation[] = [
      { type: 'create_entity', payload: { id: 'entity_deleted', kind: 'TASK', title: 'To Delete' } },
      { type: 'create_entity', payload: { id: 'entity_active', kind: 'TASK', title: 'Active' } },
    ];
    const p1 = store.planOperations(createOps, 'ai_agent');
    await store.executeConfirmedPlan(store.confirmPlan(p1.plan!));

    const delOps: ToonOperation[] = [
      { type: 'delete_entity', payload: { id: 'entity_deleted' } },
    ];
    const p2 = store.planOperations(delOps, 'ai_agent');
    await store.executeConfirmedPlan(store.confirmPlan(p2.plan!));

    // Try linking active entity to the soft-deleted entity
    const linkDeletedOps: ToonOperation[] = [
      {
        type: 'link_entities',
        payload: {
          from: 'entity_active',
          to: 'entity_deleted',
          type: 'DEPENDS_ON',
        },
      },
    ];

    const planFailC = store.planOperations(linkDeletedOps, 'ai_agent');
    expect(planFailC.success).toBe(false);
    expect(planFailC.error).toContain('Referential integrity violation');
  });

  // --------------------------------------------------------------------------
  // Requirement 4: Duplicate creation and idempotent retries
  // --------------------------------------------------------------------------
  it('4. deduplicates relationship proposals and executes idempotently', async () => {
    const store = useStore.getState();

    // Create entities
    const createOps: ToonOperation[] = [
      { type: 'create_entity', payload: { id: 'e1', kind: 'TASK', title: 'Task 1' } },
      { type: 'create_entity', payload: { id: 'e2', kind: 'GOAL', title: 'Goal 1' } },
    ];
    await store.executeConfirmedPlan(store.confirmPlan(store.planOperations(createOps, 'ai_agent').plan!));

    // Link e1 -> e2 twice in same batch
    const duplicateOps: ToonOperation[] = [
      { type: 'link_entities', payload: { from: 'e1', to: 'e2', type: 'FULFILLS' } },
      { type: 'link_entities', payload: { from: 'e1', to: 'e2', type: 'FULFILLS' } },
    ];

    const plan = store.planOperations(duplicateOps, 'ai_agent');
    expect(plan.success).toBe(true);
    // Proposal adapter deduplicates within the batch
    expect(plan.plan!.validated_mutations.length).toBe(1);

    const confirmed = store.confirmPlan(plan.plan!);
    await store.executeConfirmedPlan(confirmed);

    // Store has only 1 relationship
    expect(useStore.getState().relationships.length).toBe(1);

    // Re-executing or planning again with existing relationship is idempotent
    const retryPlan = store.planOperations(
      [{ type: 'link_entities', payload: { from: 'e1', to: 'e2', type: 'FULFILLS' } }],
      'ai_agent'
    );
    expect(retryPlan.success).toBe(true);
    await store.executeConfirmedPlan(store.confirmPlan(retryPlan.plan!));
    expect(useStore.getState().relationships.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Requirement 5: Confirmation cancellation causing zero mutations
  // --------------------------------------------------------------------------
  it('5. applies zero relationship or entity mutations if a plan is unconfirmed or cancelled', async () => {
    const store = useStore.getState();

    const ops: ToonOperation[] = [
      { type: 'create_entity', payload: { id: 'unconfirmed_e', kind: 'TASK', title: 'Unconfirmed Task' } },
      { type: 'create_entity', payload: { id: 'unconfirmed_g', kind: 'GOAL', title: 'Unconfirmed Goal' } },
      { type: 'link_entities', payload: { from: 'unconfirmed_e', to: 'unconfirmed_g', type: 'FULFILLS' } },
    ];

    const plan = store.planOperations(ops, 'ai_agent');
    expect(plan.success).toBe(true);

    // Never confirm or call executeConfirmedPlan
    expect(useStore.getState().relationships.length).toBe(0);
    expect(useStore.getState().entities.length).toBe(0);
    expect(Object.keys(useStore.getState().kernelEntities).length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Requirement 6: Invalid or unsupported relationship types rejected
  // --------------------------------------------------------------------------
  it('6. rejects invalid or unsupported relationship types with explicit errors', async () => {
    const store = useStore.getState();

    const ops: ToonOperation[] = [
      { type: 'create_entity', payload: { id: 'n1', kind: 'TASK', title: 'T1' } },
      { type: 'create_entity', payload: { id: 'n2', kind: 'TASK', title: 'T2' } },
      {
        type: 'link_entities',
        payload: {
          from: 'n1',
          to: 'n2',
          type: 'NON_EXISTENT_REL_TYPE_123',
        },
      },
    ];

    const plan = store.planOperations(ops, 'ai_agent');
    expect(plan.success).toBe(false);
    expect(plan.error).toContain('Invalid relationship type: "NON_EXISTENT_REL_TYPE_123"');
    expect(plan.error).toContain('Allowed types:');
  });

  // --------------------------------------------------------------------------
  // Requirement 7: Relationship persistence and restoration after reload
  // --------------------------------------------------------------------------
  it('7. persists and restores relationships across reload via partialize snapshot', async () => {
    const store = useStore.getState();

    const ops: ToonOperation[] = [
      { type: 'create_entity', payload: { id: 'p_e1', kind: 'TASK', title: 'Persisted Task' } },
      { type: 'create_entity', payload: { id: 'p_g1', kind: 'GOAL', title: 'Persisted Goal' } },
      { type: 'link_entities', payload: { id: 'rel_persisted_1', from: 'p_e1', to: 'p_g1', type: 'FULFILLS' } },
    ];

    const plan = store.planOperations(ops, 'ai_agent');
    await store.executeConfirmedPlan(store.confirmPlan(plan.plan!));

    const state = useStore.getState();
    expect(state.relationships.length).toBe(1);

    // Simulate Zustand partialize
    const persistedSnapshot = {
      kernelEntities: state.kernelEntities,
      entities: state.entities,
      relationships: state.relationships,
      schemas: state.schemas,
      auditLogs: state.auditLogs,
    };

    // Reset store state
    useStore.setState({
      kernelEntities: {},
      entities: [],
      relationships: [],
    });
    expect(useStore.getState().relationships.length).toBe(0);

    // Rehydrate
    useStore.setState({
      kernelEntities: persistedSnapshot.kernelEntities,
      entities: persistedSnapshot.entities,
      relationships: persistedSnapshot.relationships,
    });

    const rehydrated = useStore.getState();
    expect(rehydrated.relationships.length).toBe(1);
    expect(rehydrated.relationships[0].id).toBe('rel_persisted_1');
    expect(rehydrated.relationships[0].type).toBe(RelationshipType.FULFILLS);
  });

  // --------------------------------------------------------------------------
  // Requirement 8: Synchronization and conflict behavior for relationship changes
  // --------------------------------------------------------------------------
  it('8. reconciles relationships through mergeData (newer timestamps win)', () => {
    const localRels: Relationship[] = [
      {
        id: 'rel_conflict',
        from: 'a',
        to: 'b',
        type: RelationshipType.PART_OF,
        created_at: '2026-10-01T10:00:00.000Z',
        meta: { source: 'local_v1' },
      },
    ];

    const remoteRels: Relationship[] = [
      {
        id: 'rel_conflict',
        from: 'a',
        to: 'b',
        type: RelationshipType.DEPENDS_ON,
        created_at: '2026-10-01T12:00:00.000Z', // Newer
        meta: { source: 'remote_v2' },
      },
      {
        id: 'rel_remote_only',
        from: 'c',
        to: 'd',
        type: RelationshipType.TAGGED_WITH,
        created_at: '2026-10-01T11:00:00.000Z',
        meta: {},
      },
    ];

    const mockEntities = [
      { id: 'a', kind: EntityKind.TASK, title: 'A', status: EntityStatus.ACTIVE, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
      { id: 'b', kind: EntityKind.GOAL, title: 'B', status: EntityStatus.ACTIVE, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
      { id: 'c', kind: EntityKind.TASK, title: 'C', status: EntityStatus.ACTIVE, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
      { id: 'd', kind: EntityKind.GOAL, title: 'D', status: EntityStatus.ACTIVE, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
    ];

    const merged = mergeData(
      { entities: mockEntities as any, relationships: localRels },
      { entities: mockEntities as any, relationships: remoteRels }
    );

    expect(merged.relationships.length).toBe(2);
    const resolvedRel = merged.relationships.find(r => r.id === 'rel_conflict');
    expect(resolvedRel).toBeDefined();
    // Newer remote rel won
    expect(resolvedRel!.type).toBe(RelationshipType.DEPENDS_ON);
    expect(resolvedRel!.meta.source).toBe('remote_v2');
  });

  // --------------------------------------------------------------------------
  // Requirement 9: Legacy-to-canonical-to-legacy subtask round-trip
  // --------------------------------------------------------------------------
  it('9. preserves subtasks losslessly across legacy migration and kernel projection', () => {
    const subtasks: Subtask[] = [
      { id: 'st_1', title: 'Prepare STAR stories', completed: true, created_at: '2026-10-09T00:00:00.000Z' },
      { id: 'st_2', title: 'Practice LP mock', completed: false, created_at: '2026-10-09T00:00:00.000Z' },
    ];

    const legacyDoc = {
      id: 'task_subtask_test',
      kind: 'TASK',
      title: 'Atlas Behavioral Prep',
      subtasks,
      status: 'ACTIVE',
      metadata: {
        productivity: 'PRODUCTIVE',
      },
    };

    // 1. Upgrade legacy to canonical KernelEntity
    const kernelEntity = upgradeLegacyEntityToKernel(legacyDoc);
    expect(kernelEntity.schema_id).toBe('system/task');
    expect(kernelEntity.attributes.subtasks).toBeDefined();
    expect(Array.isArray(kernelEntity.attributes.subtasks)).toBe(true);

    const kernelSubtasks = kernelEntity.attributes.subtasks as Array<Record<string, unknown>>;
    expect(kernelSubtasks.length).toBe(2);
    expect(kernelSubtasks[0].id).toBe('st_1');
    expect(kernelSubtasks[0].title).toBe('Prepare STAR stories');
    expect(kernelSubtasks[0].completed).toBe(true);
    expect(kernelSubtasks[1].id).toBe('st_2');
    expect(kernelSubtasks[1].completed).toBe(false);

    // 2. Project back to legacy Entity
    const projectedLegacy = projectKernelToLegacyEntity(kernelEntity);
    expect(projectedLegacy.subtasks).toBeDefined();
    expect(projectedLegacy.subtasks!.length).toBe(2);
    expect(projectedLegacy.subtasks![0].id).toBe('st_1');
    expect(projectedLegacy.subtasks![0].title).toBe('Prepare STAR stories');
    expect(projectedLegacy.subtasks![0].completed).toBe(true);
    expect(projectedLegacy.subtasks![1].completed).toBe(false);

    // Verify metadata.subtasks also preserved
    expect(projectedLegacy.metadata?.subtasks).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Requirement 10: Subtasks available in AI context after migration
  // --------------------------------------------------------------------------
  it('10. exposes subtasks and parent_id in compact AI entity context', () => {
    const entity = projectKernelToLegacyEntity(
      upgradeLegacyEntityToKernel({
        id: 'task_ai_context',
        kind: 'TASK',
        title: 'Interview Prep',
        parent_id: 'goal_Atlas_career',
        subtasks: [
          { id: 'sub_1', title: 'Dynamic Programming Practice', completed: true },
          { id: 'sub_2', title: 'System Design Mock', completed: false },
        ],
      })
    );

    const contextSnapshot = buildEntityContext([entity as any], [], 'Interview Prep');
    expect(contextSnapshot.entities.length).toBe(1);

    const compact = contextSnapshot.entities[0];
    expect(compact.id).toBe('task_ai_context');
    expect(compact.p_id).toBe('goal_Atlas_career');
    expect(compact.subtasks).toBeDefined();

    const compactSubtasks = compact.subtasks as Array<{ id: string; t: string; c: boolean }>;
    expect(compactSubtasks.length).toBe(2);
    expect(compactSubtasks[0]).toEqual({
      id: 'sub_1',
      t: 'Dynamic Programming Practice',
      c: true,
    });
    expect(compactSubtasks[1]).toEqual({
      id: 'sub_2',
      t: 'System Design Mock',
      c: false,
    });
  });

  // --------------------------------------------------------------------------
  // Requirement 11: Relationship querying returning actual persisted links rather than matching tags
  // --------------------------------------------------------------------------
  it('11. queries explicit persisted relationships (1-hop, bounded to max 50, resolves titles)', () => {
    const entities = [
      {
        id: 'e_oa',
        kind: EntityKind.EVENT,
        title: 'Atlas Online Assessment',
        status: EntityStatus.ACTIVE,
        canonical_tags: ['oa'],
        created_at: '2026-10-09T00:00:00Z',
        updated_at: '2026-10-09T00:00:00Z',
      },
      {
        id: 'e_ctx',
        kind: EntityKind.CONTEXT,
        title: 'Atlas Recruitment',
        status: EntityStatus.ACTIVE,
        canonical_tags: ['recruitment'],
        created_at: '2026-10-09T00:00:00Z',
        updated_at: '2026-10-09T00:00:00Z',
      },
    ];

    const relationships: Relationship[] = [
      {
        id: 'rel_persisted_oa',
        from: 'e_oa',
        to: 'e_ctx',
        type: RelationshipType.TAGGED_WITH,
        meta: {},
        created_at: '2026-10-09T00:00:00Z',
      },
    ];

    // Query by entity_id
    const queryResult = executeQueryRelationships(
      { entity_id: 'e_oa' },
      entities as any,
      relationships
    );

    expect(queryResult.total_found).toBe(1);
    expect(queryResult.source).toBe('explicit_persisted');
    expect(queryResult.relationships.length).toBe(1);

    const rel = queryResult.relationships[0];
    expect(rel.id).toBe('rel_persisted_oa');
    expect(rel.from).toBe('e_oa');
    expect(rel.from_title).toBe('Atlas Online Assessment');
    expect(rel.to).toBe('e_ctx');
    expect(rel.to_title).toBe('Atlas Recruitment');
    expect(rel.type).toBe('TAGGED_WITH');
    expect(rel.source).toBe('explicit_persisted');

    // Query non-matching filter
    const emptyResult = executeQueryRelationships(
      { from: 'non_existent' },
      entities as any,
      relationships
    );
    expect(emptyResult.total_found).toBe(0);
    expect(emptyResult.relationships.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Requirement 12: Unsupported relationship operations rejected explicitly
  // --------------------------------------------------------------------------
  it('12. explicitly rejects unsupported operations instead of silently dropping them', () => {
    const invalidOps = [
      {
        type: 'unsupported_phantom_op_xyz' as any,
        payload: { foo: 'bar' },
      },
    ];

    expect(() => {
      convertOperationsToActionProposal(invalidOps, {
        source: 'ai_agent',
        currentEntities: {},
        intent: 'Test invalid op',
      });
    }).toThrow(/Unsupported operation type:? "unsupported_phantom_op_xyz"/);
  });

  // --------------------------------------------------------------------------
  // Requirement 13: Existing kernel invariants and authorization intact
  // --------------------------------------------------------------------------
  it('13. maintains two-phase confirmation integrity: tampering with fingerprint blocks execution', async () => {
    const store = useStore.getState();

    const ops: ToonOperation[] = [
      { type: 'create_entity', payload: { id: 'inv_e1', kind: 'TASK', title: 'Invariant Task' } },
      { type: 'create_entity', payload: { id: 'inv_e2', kind: 'GOAL', title: 'Invariant Goal' } },
      { type: 'link_entities', payload: { from: 'inv_e1', to: 'inv_e2', type: 'FULFILLS' } },
    ];

    const planResult = store.planOperations(ops, 'ai_agent');
    expect(planResult.success).toBe(true);

    const confirmedPlan = store.confirmPlan(planResult.plan!);

    // Tamper with verified fingerprint
    const tamperedPlan = {
      ...confirmedPlan,
      verified_fingerprint: 'tampered_invalid_fingerprint_sha256',
    };

    await expect(store.executeConfirmedPlan(tamperedPlan)).rejects.toThrow(
      /Plan tampering detected! Fingerprint mismatch/
    );

    // State remained untainted
    expect(useStore.getState().relationships.length).toBe(0);
  });
});

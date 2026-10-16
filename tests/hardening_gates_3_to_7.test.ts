/**
 * Hardening Acceptance Tests for Gates 3 to 7:
 * - Gate 3: Confirmation Security Boundary & Invariants
 * - Gate 4: Query Authorization Order, Candidate Isolation, & Ceiling Constraints
 * - Gate 6: Unified 9-Schema Baseline Reconciliation & Capability Extraction
 * - Gate 7: Lossless Provenance Round-Trip & Trust Integrity
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Entity,
  SchemaRegistry,
  KernelAuthorizer,
  ActionExecutionEngine,
  ActionProposal,
  InMemoryPersistenceAdapter,
  BASELINE_SYSTEM_SCHEMAS,
  SYSTEM_TASK_SCHEMA,
  SYSTEM_EVENT_SCHEMA,
  SYSTEM_GOAL_SCHEMA,
  SYSTEM_HABIT_SCHEMA,
  SYSTEM_NOTE_SCHEMA,
  SYSTEM_PERSON_SCHEMA,
  SYSTEM_MEAL_LOG_SCHEMA,
  SYSTEM_ATTENDANCE_RECORD_SCHEMA,
  SYSTEM_UNSTRUCTURED_ITEM_SCHEMA,
  TRACKABLE_PROGRESS_CAPABILITY,
  SCHEDULABLE_CAPABILITY,
  convertOperationsToActionProposal,
} from '../services/kernel';
import { executeQueryEntities } from '../services/ai/executors';
import { useStore } from '../store';
import {
  projectKernelToLegacyEntity,
  projectKernelEntitiesToLegacy,
} from '../store/kernelProjection';
import {
  upgradeLegacyEntityToKernel,
  mapLegacyKindToSchemaId,
} from '../services/persistence/legacyMigration';
import { User } from '../services/firebase';

describe('Gate 6: Baseline Schema Reconciliation (All 9 Canonical Schemas)', () => {
  it('registers exactly all 9 baseline system schemas', () => {
    const registry = new SchemaRegistry();
    for (const s of BASELINE_SYSTEM_SCHEMAS) {
      registry.register(s);
    }
    const ids = registry.list().map(s => s.id);
    expect(ids).toHaveLength(9);
    expect(ids).toContain('system/task');
    expect(ids).toContain('system/event');
    expect(ids).toContain('system/note');
    expect(ids).toContain('system/person');
    expect(ids).toContain('system/goal');
    expect(ids).toContain('system/habit');
    expect(ids).toContain('system/meal_log');
    expect(ids).toContain('system/attendance_record');
    expect(ids).toContain('system/unstructured_item');
  });

  it('maps legacy kind GOAL to system/goal and HABIT to system/habit', () => {
    expect(mapLegacyKindToSchemaId('GOAL')).toBe('system/goal');
    expect(mapLegacyKindToSchemaId('HABIT')).toBe('system/habit');
    expect(mapLegacyKindToSchemaId('MINI_STREAK')).toBe('system/habit');
    expect(mapLegacyKindToSchemaId('TASK')).toBe('system/task');
    expect(mapLegacyKindToSchemaId('EVENT')).toBe('system/event');
    expect(mapLegacyKindToSchemaId('NOTE')).toBe('system/note');
    expect(mapLegacyKindToSchemaId('PERSON')).toBe('system/person');
  });

  it('extracts trackable_progress capability contract correctly for goals and habits', () => {
    const goalEntity: Entity = {
      id: 'g-test-1',
      schema_id: 'system/goal',
      version: 1,
      title: 'Complete System Refactor',
      attributes: {
        progress: 75,
        target_count: 100,
        unit: '%',
      },
      lifecycle: {
        status: 'active',
        created_at: '2026-10-07T00:00:00Z',
        updated_at: '2026-10-07T00:00:00Z',
        deleted_at: null,
      },
      provenance: {
        source_type: 'user',
        observed_at: '2026-10-07T00:00:00Z',
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    };

    expect(TRACKABLE_PROGRESS_CAPABILITY.is_satisfied_by(goalEntity)).toBe(true);
    const contract = TRACKABLE_PROGRESS_CAPABILITY.extract_contract(goalEntity);
    expect(contract.percentage).toBe(75);
    expect(contract.current).toBe(75);
    expect(contract.target).toBe(100);
  });
});

describe('Gate 3: Confirmation Security Audit & Boundary Invariants', () => {
  let registry: SchemaRegistry;
  let authorizer: KernelAuthorizer;
  let persistence: InMemoryPersistenceAdapter;
  let engine: ActionExecutionEngine;

  beforeEach(() => {
    registry = new SchemaRegistry();
    for (const s of BASELINE_SYSTEM_SCHEMAS) {
      registry.register(s);
    }
    authorizer = new KernelAuthorizer();
    persistence = new InMemoryPersistenceAdapter();
    engine = new ActionExecutionEngine(registry, authorizer, persistence);
  });

  it('rejects execution when confirmation token is already consumed (replay attack prevention)', async () => {
    const proposal: ActionProposal = {
      id: 'prop_replay_test',
      source: 'ai_agent',
      intent: 'Create task from AI',
      mutations: [
        {
          op: 'upsert_entity',
          entity: {
            id: 'task_replay_1',
            schema_id: 'system/task',
            version: 1,
            title: 'AI Scheduled Task',
            attributes: { priority: 2 },
            lifecycle: {
              status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              deleted_at: null,
            },
            provenance: {
              source_type: 'agent',
              observed_at: new Date().toISOString(),
              confidence: 0.95,
              is_inferred: true,
              user_confirmed: false,
            },
          },
        },
      ],
    };

    const planRes = engine.plan(proposal, {
      actor: 'ai_agent',
      authenticated_user_id: 'user_alice',
    });
    expect(planRes.success).toBe(true);
    expect(planRes.plan?.requires_confirmation).toBe(true);

    const confirmed = engine.confirm(planRes.plan!, {
      actor: 'user_ui',
      authenticated_user_id: 'user_alice',
    });

    // First execution succeeds
    const firstExec = await engine.execute(confirmed, 'user_alice');
    expect(firstExec).toBe(true);

    // Second execution with same confirmed token must fail with replay error
    await expect(engine.execute(confirmed, 'user_alice')).rejects.toThrow(
      /replay attack detected/
    );
  });

  it('rejects execution when executing user does not match the confirming user', async () => {
    const proposal: ActionProposal = {
      id: 'prop_user_binding_test',
      source: 'ai_agent',
      intent: 'AI Task',
      mutations: [
        {
          op: 'upsert_entity',
          entity: {
            id: 'task_binding_1',
            schema_id: 'system/task',
            version: 1,
            title: 'Bound Task',
            attributes: {},
            lifecycle: {
              status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              deleted_at: null,
            },
            provenance: {
              source_type: 'agent',
              observed_at: new Date().toISOString(),
              confidence: 0.9,
              is_inferred: true,
              user_confirmed: false,
            },
          },
        },
      ],
    };

    const planRes = engine.plan(proposal, {
      actor: 'ai_agent',
      authenticated_user_id: 'user_alice',
    });
    const confirmedByAlice = engine.confirm(planRes.plan!, {
      actor: 'user_ui',
      authenticated_user_id: 'user_alice',
    });

    // Bob tries to execute Alice's confirmed plan -> rejected!
    await expect(engine.execute(confirmedByAlice, 'user_bob')).rejects.toThrow(
      /cannot execute plan confirmed by/
    );
  });

  it('forces requires_confirmation = true when an entity has is_inferred = true without user confirmation', () => {
    // Even if an actor claims to be user_ui, if the mutation contains an unverified inference, confirmation is MANDATORY
    const proposal: ActionProposal = {
      id: 'prop_inferred_check',
      source: 'user_ui',
      intent: 'Submit inferred mutation',
      mutations: [
        {
          op: 'upsert_entity',
          entity: {
            id: 'inferred_task_1',
            schema_id: 'system/task',
            version: 1,
            title: 'Inferred Task',
            attributes: {},
            lifecycle: {
              status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              deleted_at: null,
            },
            provenance: {
              source_type: 'agent',
              observed_at: new Date().toISOString(),
              confidence: 0.8,
              is_inferred: true,
              user_confirmed: false,
            },
          },
        },
      ],
    };

    const planRes = engine.plan(proposal, {
      actor: 'user_ui',
      authenticated_user_id: 'user_alice',
    });

    expect(planRes.success).toBe(true);
    expect(planRes.plan?.requires_confirmation).toBe(true);
  });

  it('rejects confirmation if plan mutations are tampered with', () => {
    const proposal: ActionProposal = {
      id: 'prop_tamper_test',
      source: 'ai_agent',
      intent: 'Delete item',
      mutations: [
        {
          op: 'soft_delete_entity',
          entity_id: 'entity_to_delete',
        },
      ],
    };

    const planRes = engine.plan(proposal, {
      actor: 'ai_agent',
      authenticated_user_id: 'user_alice',
    });

    const tamperedPlan = {
      ...planRes.plan!,
      validated_mutations: [], // Tampered!
    };

    expect(() =>
      engine.confirm(tamperedPlan, {
        actor: 'user_ui',
        authenticated_user_id: 'user_alice',
      })
    ).toThrow(/Plan has been modified since generation/);
  });
});

describe('Gate 4: Query Authorization Order, Candidate Isolation, & Ceiling Constraints', () => {
  beforeEach(() => {
    useStore.setState({
      currentUser: {
        uid: 'user_alice',
        email: 'alice@flowmate.ai',
        displayName: 'Alice',
      } as unknown as User,
      kernelEntities: {},
      schemas: Object.fromEntries(BASELINE_SYSTEM_SCHEMAS.map(s => [s.id, s])),
    });
  });

  it('rejects unauthenticated queries immediately before reading entities', () => {
    useStore.setState({ currentUser: null });
    const res = executeQueryEntities({ limit: 10 });
    expect(res.total_matched).toBe(0);
    expect(res.error).toBeDefined();
    expect(res.error).toContain('Unauthenticated query');
  });

  it('strictly isolates candidates by user_id attribute preventing cross-tenant leakage', () => {
    const entities: Entity[] = [
      {
        id: 'alice_task',
        schema_id: 'system/task',
        version: 1,
        title: 'Alice Task',
        attributes: { user_id: 'user_alice' },
        lifecycle: {
          status: 'active',
          created_at: '2026-10-07T00:00:00Z',
          updated_at: '2026-10-07T00:00:00Z',
          deleted_at: null,
        },
        provenance: {
          source_type: 'user',
          observed_at: '2026-10-07T00:00:00Z',
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
      },
      {
        id: 'bob_task',
        schema_id: 'system/task',
        version: 1,
        title: 'Bob Secret Task',
        attributes: { user_id: 'user_bob' }, // Belongs to Bob!
        lifecycle: {
          status: 'active',
          created_at: '2026-10-07T00:00:00Z',
          updated_at: '2026-10-07T00:00:00Z',
          deleted_at: null,
        },
        provenance: {
          source_type: 'user',
          observed_at: '2026-10-07T00:00:00Z',
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
      },
    ];

    useStore.setState({
      kernelEntities: {
        alice_task: entities[0],
        bob_task: entities[1],
      },
    });

    const res = executeQueryEntities({ limit: 10 });
    expect(res.total_matched).toBe(1);
    expect(res.entities[0].id).toBe('alice_task');
    expect(res.entities.some(e => e.id === 'bob_task')).toBe(false);
  });

  it('strictly excludes soft-deleted tombstones', () => {
    const deletedEntity: Entity = {
      id: 'del_task_1',
      schema_id: 'system/task',
      version: 2,
      title: 'Deleted Task',
      attributes: { deleted: true },
      lifecycle: {
        status: 'deleted',
        created_at: '2026-10-07T00:00:00Z',
        updated_at: '2026-10-07T00:00:00Z',
        deleted_at: '2026-10-07T01:00:00Z',
      },
      provenance: {
        source_type: 'user',
        observed_at: '2026-10-07T00:00:00Z',
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    };

    useStore.setState({
      kernelEntities: { del_task_1: deletedEntity },
    });

    const res = executeQueryEntities({ limit: 10 });
    expect(res.total_matched).toBe(0);
    expect(res.entities).toHaveLength(0);
  });

  it('clamps query limit strictly between 1 and 25', () => {
    const items: Record<string, Entity> = {};
    for (let i = 0; i < 40; i++) {
      items[`task_${i}`] = {
        id: `task_${i}`,
        schema_id: 'system/task',
        version: 1,
        title: `Task ${i}`,
        attributes: {},
        lifecycle: {
          status: 'active',
          created_at: '2026-10-07T00:00:00Z',
          updated_at: '2026-10-07T00:00:00Z',
          deleted_at: null,
        },
        provenance: {
          source_type: 'user',
          observed_at: '2026-10-07T00:00:00Z',
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
      };
    }
    useStore.setState({ kernelEntities: items });

    // Request limit of 100 -> clamped to 25
    const resOver = executeQueryEntities({ limit: 100 });
    expect(resOver.limit).toBe(25);
    expect(resOver.entities.length).toBe(25);

    // Request limit of 0 -> clamped to 1
    const resUnder = executeQueryEntities({ limit: 0 });
    expect(resUnder.limit).toBe(1);
    expect(resUnder.entities.length).toBe(1);
  });
});

describe('Gate 7: Provenance Round-Trip & Trust Integrity', () => {
  it('losslessly preserves complete provenance across KernelEntity -> Legacy projection -> Upgrade', () => {
    const original: Entity = {
      id: 'prov_test_1',
      schema_id: 'system/task',
      version: 3,
      title: 'Provenance Check Task',
      attributes: {
        priority: 1,
        notes: 'Critical task',
      },
      lifecycle: {
        status: 'active',
        created_at: '2026-10-06T12:00:00.000Z',
        updated_at: '2026-10-07T12:00:00.000Z',
        deleted_at: null,
      },
      provenance: {
        source_type: 'agent',
        source_id: 'agent_gemini_flash',
        observed_at: '2026-10-06T12:00:00.000Z',
        confidence: 0.88,
        is_inferred: true,
        user_confirmed: false,
      },
    };

    // 1. Project to legacy
    const projectedLegacy = projectKernelToLegacyEntity(original);
    expect(projectedLegacy.metadata._provenance).toBeDefined();

    // 2. Upgrade back to kernel
    const upgraded = upgradeLegacyEntityToKernel(projectedLegacy as unknown as Record<string, unknown>);

    // 3. Verify exact lossless provenance preservation
    expect(upgraded.provenance.source_type).toBe('agent');
    expect(upgraded.provenance.source_id).toBe('agent_gemini_flash');
    expect(upgraded.provenance.observed_at).toBe('2026-10-06T12:00:00.000Z');
    expect(upgraded.provenance.confidence).toBe(0.88);
    expect(upgraded.provenance.is_inferred).toBe(true);
    expect(upgraded.provenance.user_confirmed).toBe(false);
  });

  it('promotes user_confirmed to true on human UI edit, but AI update preserves unconfirmed flag', () => {
    const initialEntity: Entity = {
      id: 'task_human_edit',
      schema_id: 'system/task',
      version: 1,
      title: 'Inferred Draft',
      attributes: { priority: 3 },
      lifecycle: {
        status: 'active',
        created_at: '2026-10-07T00:00:00Z',
        updated_at: '2026-10-07T00:00:00Z',
        deleted_at: null,
      },
      provenance: {
        source_type: 'agent',
        observed_at: '2026-10-07T00:00:00Z',
        confidence: 0.7,
        is_inferred: true,
        user_confirmed: false,
      },
    };

    // 1. Human UI edits the entity
    const userProposal = convertOperationsToActionProposal(
      [
        {
          type: 'update_entity',
          payload: {
            id: 'task_human_edit',
            fields: { title: 'Human Approved Task' },
          },
        },
      ],
      {
        source: 'user_ui',
        currentEntities: { task_human_edit: initialEntity },
      }
    );

    const updatedUserEntity = (userProposal.mutations[0] as { entity: Entity }).entity;
    expect(updatedUserEntity.provenance.user_confirmed).toBe(true);

    // 2. AI agent edits the entity: cannot upgrade user_confirmed!
    const aiProposal = convertOperationsToActionProposal(
      [
        {
          type: 'update_entity',
          payload: {
            id: 'task_human_edit',
            fields: { title: 'AI Refined Title' },
          },
        },
      ],
      {
        source: 'ai_agent',
        currentEntities: { task_human_edit: initialEntity },
      }
    );

    const updatedAiEntity = (aiProposal.mutations[0] as { entity: Entity }).entity;
    expect(updatedAiEntity.provenance.user_confirmed).toBe(false);
  });
});

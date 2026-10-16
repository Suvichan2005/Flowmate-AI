/**
 * Flowmate Phase 4B — Durable Memory Lifecycle & Scheduling Certainty Regression Test Suite
 *
 * Verifies all 11 required invariants:
 * 1. Memory proposal creation, confirmation, persistence, and retrieval
 * 2. Declined proposals producing no confirmed memory
 * 3. Duplicate proposals and idempotent retries
 * 4. Memory correction and deletion (soft delete tombstone never resurrecting)
 * 5. Provenance preservation across proposal and user confirmation
 * 6. Grounded retrieval: Distinguishing saved memory from conversation-only facts
 * 7. Tentative interview status surviving reload and synchronization
 * 8. Missing certainty remaining unknown (never silently promoted to confirmed)
 * 9. Branch switching and truncated history not changing scheduling certainty
 * 10. Schedule queries returning authoritative certainty status
 * 11. Two-phase action confirmation with SHA-256 fingerprinting remaining strictly intact
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import {
  executeProposeMemoryUpdate,
  executeSearchMemory,
  executeReadCalendar,
  executeSearchEntities,
} from '../services/ai/executors';
import { convertOperationsToActionProposal } from '../services/kernel/operationAdapter';
import {
  ActionExecutionEngine,
  computePlanFingerprint,
} from '../services/kernel/actionPipeline';
import { SchemaRegistry } from '../services/kernel/schemaRegistry';
import { KernelAuthorizer } from '../services/kernel/authorization';
import { InMemoryPersistenceAdapter } from '../services/kernel/persistencePort';
import {
  upgradeLegacyEntityToKernel,
} from '../services/persistence/legacyMigration';
import {
  projectKernelToLegacyEntity,
  projectKernelEntitiesToLegacy,
} from '../store/kernelProjection';
import { ToonOperation } from '../types';
import { Entity as KernelEntity } from '../services/kernel/types';

describe('Flowmate Phase 4B: Durable Memory Lifecycle & Scheduling Certainty', () => {
  beforeEach(() => {
    useStore.setState({
      kernelEntities: {},
      entities: [],
      relationships: [],
      pendingProposal: null,
      pendingOperations: null,
      messages: [],
    } as any);
  });

  // -------------------------------------------------------------------------
  // Test 1: Memory proposal creation, confirmation, persistence, and retrieval
  // -------------------------------------------------------------------------
  it('1. correctly proposes, validates, confirms, persists, and retrieves durable memory', async () => {
    const store = useStore.getState();

    // A. Propose memory update
    const propRes = executeProposeMemoryUpdate({
      content: 'Prefers mock coding practice in Python with 45-minute focus intervals',
      category: 'preference',
      privacy_tier: 'private',
    });

    expect(propRes.evaluation).toBeDefined();
    expect(propRes.proposed_operation).toBeDefined();
    const op = propRes.proposed_operation as ToonOperation;
    expect(op.type).toBe('create_entity');
    expect((op.payload as Record<string, unknown>).schema_id).toBe('system/memory_item');

    // B. Plan action via canonical kernel action pipeline
    const planRes = store.planOperations([op], 'ai_agent');
    expect(planRes.success).toBe(true);
    expect(planRes.plan).toBeDefined();
    expect(planRes.plan!.validated_mutations.length).toBe(1);

    // C. User confirms plan via UI
    const confirmedPlan = store.confirmPlan(planRes.plan!);
    expect(confirmedPlan.confirmed_by).toBeDefined();
    expect(confirmedPlan.verified_fingerprint).toBe(planRes.plan!.plan_fingerprint);

    // D. Execute confirmed kernel plan
    const execSuccess = await store.executeConfirmedPlan(confirmedPlan);
    expect(execSuccess).toBe(true);

    // E. Retrieve via executeSearchMemory
    const searchRes = executeSearchMemory({ query: 'Python' });
    expect(searchRes.length).toBe(1);
    expect(searchRes[0].source).toBe('persisted_memory');
    expect(searchRes[0].type).toBe('persistent_memory');
    expect(searchRes[0].content).toContain('Python');
    expect(searchRes[0].category).toBe('preference');
  });

  // -------------------------------------------------------------------------
  // Test 2: Declined proposals producing no confirmed memory
  // -------------------------------------------------------------------------
  it('2. ensures declined proposals leave no confirmed memory behind', async () => {
    const store = useStore.getState();

    const propRes = executeProposeMemoryUpdate({
      content: 'Candidate might be moving to Seattle in November (unconfirmed rumour)',
      category: 'fact',
    });
    const op = propRes.proposed_operation as ToonOperation;

    const planRes = store.planOperations([op], 'ai_agent');
    expect(planRes.success).toBe(true);

    // User explicitly declines/cancels: execution plan is never confirmed or executed
    const searchRes = executeSearchMemory({ query: 'Seattle' });
    expect(searchRes.length).toBe(0);
    expect(Object.keys(useStore.getState().kernelEntities).length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: Duplicate proposals and idempotent retries
  // -------------------------------------------------------------------------
  it('3. ensures duplicate memory proposals on retry are idempotent and do not duplicate', async () => {
    const store = useStore.getState();
    const memoryContent = 'Candidate prefers evening interview slots between 6 PM and 9 PM';

    // First proposal & execution
    const prop1 = executeProposeMemoryUpdate({ content: memoryContent, category: 'preference' });
    const op1 = prop1.proposed_operation as ToonOperation;
    const planRes1 = store.planOperations([op1], 'ai_agent');
    const confirmedPlan1 = store.confirmPlan(planRes1.plan!);
    await store.executeConfirmedPlan(confirmedPlan1);

    const kernelEntitiesAfter1 = useStore.getState().kernelEntities;
    expect(Object.keys(kernelEntitiesAfter1).length).toBe(1);
    const firstEntityId = Object.keys(kernelEntitiesAfter1)[0];

    // Second proposal (retry with identical content)
    const prop2 = executeProposeMemoryUpdate({ content: memoryContent, category: 'preference' });
    const op2 = prop2.proposed_operation as ToonOperation;
    const planRes2 = store.planOperations([op2], 'ai_agent');
    const confirmedPlan2 = store.confirmPlan(planRes2.plan!);
    await store.executeConfirmedPlan(confirmedPlan2);

    // Count of memory items must still be 1 (deduped to same entity ID)
    const kernelEntitiesAfter2 = useStore.getState().kernelEntities;
    expect(Object.keys(kernelEntitiesAfter2).length).toBe(1);
    expect(Object.keys(kernelEntitiesAfter2)[0]).toBe(firstEntityId);
  });

  // -------------------------------------------------------------------------
  // Test 4: Memory correction and deletion
  // -------------------------------------------------------------------------
  it('4. supports updating and deleting memories with non-resurrecting tombstones', async () => {
    const store = useStore.getState();

    // Create initial memory
    const prop = executeProposeMemoryUpdate({ content: 'Prefers Java for coding rounds', category: 'preference' });
    const op = prop.proposed_operation as ToonOperation;
    const planRes = store.planOperations([op], 'ai_agent');
    const confirmed = store.confirmPlan(planRes.plan!);
    await store.executeConfirmedPlan(confirmed);

    const entityId = Object.keys(useStore.getState().kernelEntities)[0];

    // A. Update memory content to C++
    const updateOp: ToonOperation = {
      type: 'update_entity',
      payload: {
        id: entityId,
        content: 'Prefers C++ for coding rounds (updated preference)',
      },
    };
    const updatePlanRes = store.planOperations([updateOp], 'user_ui');
    const confirmedUpdate = store.confirmPlan(updatePlanRes.plan!);
    await store.executeConfirmedPlan(confirmedUpdate);

    expect(useStore.getState().kernelEntities[entityId].attributes.content).toBe(
      'Prefers C++ for coding rounds (updated preference)'
    );

    // B. Delete memory
    const deleteOp: ToonOperation = {
      type: 'delete_entity',
      payload: { id: entityId },
    };
    const deletePlanRes = store.planOperations([deleteOp], 'user_ui');
    const confirmedDelete = store.confirmPlan(deletePlanRes.plan!);
    await store.executeConfirmedPlan(confirmedDelete);

    // Verify soft-deleted tombstone
    const deletedEntity = useStore.getState().kernelEntities[entityId];
    expect(deletedEntity.lifecycle.status).toBe('deleted');
    expect(deletedEntity.lifecycle.deleted_at).not.toBeNull();

    // Verify memory search returns 0 results for deleted item
    const searchAfterDelete = executeSearchMemory({ query: 'coding rounds' });
    expect(searchAfterDelete.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 5: Provenance preservation
  // -------------------------------------------------------------------------
  it('5. preserves provenance: agent proposal starts is_inferred: true and user_confirmed: false, confirmed UI is user_confirmed: true', () => {
    const prop = executeProposeMemoryUpdate({ content: 'Likes solving graph traversal problems', category: 'preference' });
    const op = prop.proposed_operation as ToonOperation;

    // AI proposed
    const agentProposal = convertOperationsToActionProposal([op], { source: 'ai_agent' });
    const proposedEntity = (agentProposal.mutations[0] as { entity: KernelEntity }).entity;
    expect(proposedEntity.provenance.source_type).toBe('agent');
    expect(proposedEntity.provenance.is_inferred).toBe(true);
    expect(proposedEntity.provenance.user_confirmed).toBe(false);

    // User confirmed via UI
    const userProposal = convertOperationsToActionProposal([op], { source: 'user_ui' });
    const confirmedEntity = (userProposal.mutations[0] as { entity: KernelEntity }).entity;
    expect(confirmedEntity.provenance.source_type).toBe('user');
    expect(confirmedEntity.provenance.is_inferred).toBe(false);
    expect(confirmedEntity.provenance.user_confirmed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: Distinguishing saved memory from conversation-only facts
  // -------------------------------------------------------------------------
  it('6. distinguishes explicit persisted memory from conversation-only context', () => {
    // Add messages with unconfirmed statements to conversation history
    useStore.setState({
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          text: 'I might consider applying elsewhere next year if this opportunity does not work out.',
          created_at: new Date().toISOString(),
        },
      ],
      kernelEntities: {},
    });

    // Search memory must NOT return conversation text as confirmed memory
    const searchRes = executeSearchMemory({ query: 'Google' });
    expect(searchRes.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 7: Tentative interview status surviving reload and synchronization
  // -------------------------------------------------------------------------
  it('7. preserves tentative interview status across reload, migration, and projection', () => {
    // Simulate raw legacy document with tentative certainty
    const rawLegacyDoc = {
      id: 'event-Atlas-interview',
      kind: 'EVENT',
      title: 'Atlas Interview',
      start_time: '2026-10-16T14:00:00+05:30',
      end_time: '2026-10-16T15:00:00+05:30',
      scheduling_certainty: 'tentative',
    };

    // 1. Upgrade to Kernel
    const kernelEntity = upgradeLegacyEntityToKernel(rawLegacyDoc);
    expect(kernelEntity.attributes.scheduling_certainty).toBe('tentative');

    // 2. Project back to legacy
    const projected = projectKernelToLegacyEntity(kernelEntity);
    expect(projected.scheduling_certainty).toBe('tentative');
    expect(projected.metadata.scheduling_certainty).toBe('tentative');

    // 3. Serialize to JSON and parse back (simulating Firestore/IndexedDB sync)
    const serialized = JSON.stringify(kernelEntity);
    const deserialized = JSON.parse(serialized) as KernelEntity;
    expect(deserialized.attributes.scheduling_certainty).toBe('tentative');

    const reprojected = projectKernelToLegacyEntity(deserialized);
    expect(reprojected.scheduling_certainty).toBe('tentative');
  });

  // -------------------------------------------------------------------------
  // Test 8: Missing certainty remaining unknown
  // -------------------------------------------------------------------------
  it('8. leaves missing scheduling certainty as unknown rather than promoting to confirmed', () => {
    const rawDoc = {
      id: 'event-unspecified',
      kind: 'EVENT',
      title: 'Coffee Sync',
      start_time: '2026-10-10T10:00:00+05:30',
      end_time: '2026-10-10T11:00:00+05:30',
    };

    // Operation adapter without certainty specified
    const proposal = convertOperationsToActionProposal([
      { type: 'create_entity', payload: rawDoc },
    ], { source: 'ai_agent' });

    const entity = (proposal.mutations[0] as { entity: KernelEntity }).entity;
    expect(entity.attributes.scheduling_certainty).toBe('unknown');

    const projected = projectKernelToLegacyEntity(entity);
    expect(projected.scheduling_certainty).toBe('unknown');
    expect(projected.scheduling_certainty).not.toBe('confirmed');
  });

  // -------------------------------------------------------------------------
  // Test 9: Branch switching and truncated history not changing certainty
  // -------------------------------------------------------------------------
  it('9. entity scheduling certainty is immune to branch switching or history truncation', () => {
    const eventKernel: KernelEntity = {
      id: 'event-123',
      schema_id: 'system/event',
      version: 1,
      title: 'Atlas Online Assessment',
      attributes: {
        start_time: '2026-10-09T21:00:00+05:30',
        end_time: '2026-10-09T22:30:00+05:30',
        scheduling_certainty: 'confirmed',
      },
      lifecycle: {
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      },
      provenance: {
        source_type: 'agent',
        observed_at: new Date().toISOString(),
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    };

    useStore.setState({
      kernelEntities: { [eventKernel.id]: eventKernel },
      // Simulate switching branches with completely different or truncated messages
      messages: [],
    });

    const projectedList = projectKernelEntitiesToLegacy(useStore.getState().kernelEntities);
    const target = projectedList.find(e => e.id === 'event-123');
    expect(target).toBeDefined();
    expect(target?.scheduling_certainty).toBe('confirmed');
  });

  // -------------------------------------------------------------------------
  // Test 10: Schedule queries returning authoritative status
  // -------------------------------------------------------------------------
  it('10. schedule queries (read_calendar and search_entities) return authoritative certainty status', () => {
    const tentEvent: KernelEntity = {
      id: 'evt-tentative',
      schema_id: 'system/event',
      version: 1,
      title: 'Atlas Interview (Tentative)',
      attributes: {
        start_time: '2026-10-16T14:00:00+05:30',
        end_time: '2026-10-16T15:00:00+05:30',
        scheduling_certainty: 'tentative',
      },
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
    };

    const confEvent: KernelEntity = {
      id: 'evt-confirmed',
      schema_id: 'system/event',
      version: 1,
      title: 'Atlas Online Assessment (OA)',
      attributes: {
        start_time: '2026-10-09T21:00:00+05:30',
        end_time: '2026-10-09T22:30:00+05:30',
        scheduling_certainty: 'confirmed',
      },
      lifecycle: {
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      },
      provenance: {
        source_type: 'agent',
        observed_at: new Date().toISOString(),
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    };

    const legacyList = projectKernelEntitiesToLegacy({
      [tentEvent.id]: tentEvent,
      [confEvent.id]: confEvent,
    });

    const calendarItems = executeReadCalendar(
      { start_date: '2026-10-01', end_date: '2026-10-31' },
      legacyList
    );

    const tentItem = calendarItems.find(i => i.id === 'evt-tentative');
    const confItem = calendarItems.find(i => i.id === 'evt-confirmed');

    expect(tentItem).toBeDefined();
    expect(tentItem?.scheduling_certainty).toBe('tentative');

    expect(confItem).toBeDefined();
    expect(confItem?.scheduling_certainty).toBe('confirmed');

    // Also verify search_entities includes scheduling_certainty
    const searchRes = executeSearchEntities({ query: 'Atlas' }, legacyList);
    const searchTent = searchRes.find(i => i.id === 'evt-tentative');
    expect(searchTent?.scheduling_certainty).toBe('tentative');
  });

  // -------------------------------------------------------------------------
  // Test 11: Two-phase confirmation with SHA-256 fingerprinting
  // -------------------------------------------------------------------------
  it('11. strictly enforces two-phase action confirmation with SHA-256 fingerprinting', async () => {
    const store = useStore.getState();
    const op: ToonOperation = {
      type: 'create_entity',
      payload: {
        kind: 'TASK',
        title: 'Review System Design & Concurrency',
      },
    };

    const planRes = store.planOperations([op], 'ai_agent');
    expect(planRes.success).toBe(true);
    expect(planRes.plan).toBeDefined();
    expect(planRes.plan!.plan_fingerprint).toBeDefined();
    expect(planRes.plan!.plan_fingerprint).toMatch(/^sha256_[a-f0-9]{64}$/);

    const schemas = store.schemas;
    const schemaRegistry = new SchemaRegistry();
    for (const schema of Object.values(schemas)) {
      schemaRegistry.register(schema);
    }
    const authorizer = new KernelAuthorizer();
    const persistence = new InMemoryPersistenceAdapter();
    const engine = new ActionExecutionEngine(schemaRegistry, authorizer, persistence);

    // 1. Attempting execution without confirmation token MUST be rejected
    const unconfirmedPlan = {
      plan: planRes.plan!,
      confirmed_by: 'local_user',
      confirmed_at: new Date().toISOString(),
      confirmation_token: '',
      verified_fingerprint: planRes.plan!.plan_fingerprint,
    };
    await expect(engine.execute(unconfirmedPlan, 'local_user')).rejects.toThrow(
      'Execution rejected: A plan requiring confirmation cannot be executed as an unconfirmed ExecutionPlan'
    );

    // 2. Tampered plan (mutations modified after fingerprinting) MUST be rejected
    const confirmed = store.confirmPlan(planRes.plan!);
    const tamperedConfirmed = {
      ...confirmed,
      plan: {
        ...confirmed.plan,
        validated_mutations: [], // Tamper with mutations
      },
    };
    await expect(engine.execute(tamperedConfirmed, 'local_user')).rejects.toThrow(
      'Execution rejected: Plan tampering detected! Fingerprint mismatch.'
    );

    // 3. Valid confirmed plan executes successfully
    const validRes = await engine.execute(confirmed, 'local_user');
    expect(validRes).toBe(true);
  });
});

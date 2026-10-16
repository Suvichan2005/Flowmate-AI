/**
 * Flowmate Greenfield Domain Kernel — Stage 3 Action Pipeline Integration Tests
 *
 * Verifies that:
 * 1. Legacy ToonOperation batches map to canonical ActionProposal primitives.
 * 2. Planning validates schemas and produces cryptographic SHA-256 plan fingerprints.
 * 3. AI agent proposals strictly require explicit user confirmation.
 * 4. User confirmation cryptographically binds the authenticated user ID and fingerprint.
 * 5. Tamper detection rejects execution if plan mutations are altered post-planning.
 * 6. Single-use token replay protection rejects re-execution attempts.
 * 7. Cross-user execution is rejected (User A confirms -> User B executes fails).
 * 8. Execution commits directly to canonical kernelEntities and records append-only audit trail.
 * 9. ZERO `any` across all test assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, selectKernelEntities, selectLegacyEntities, selectAuditLogs } from '../store';
import { EntityKind } from '../types';
import { ConfirmedExecutionPlan } from '../services/kernel';
import { User } from '../services/firebase';

describe('Stage 3: Action Pipeline Integration (Plan -> Authorize -> Confirm -> Execute)', () => {
  beforeEach(() => {
    useStore.setState({
      kernelEntities: {},
      entities: [],
      relationships: [],
      messages: [],
      auditLogs: [],
      history: [],
      historyPointer: -1,
      currentUser: {
        uid: 'alice-user-123',
        email: 'alice@flowmate.ai',
        displayName: 'Alice Engineer',
      } as unknown as User,
    });
  });

  it('generates a valid ExecutionPlan with SHA-256 fingerprint for AI operations', () => {
    const ops = [
      {
        type: 'create_entity' as const,
        payload: {
          id: 'task-ai-1',
          kind: EntityKind.TASK,
          title: 'Review Greenfield Architecture',
          priority: 1,
        },
      },
    ];

    const planResult = useStore.getState().planOperations(ops, 'ai_agent');
    expect(planResult.success).toBe(true);
    expect(planResult.plan).toBeDefined();

    const plan = planResult.plan!;
    expect(plan.validated_mutations.length).toBe(1);
    expect(plan.requires_confirmation).toBe(true);
    expect(plan.plan_fingerprint).toMatch(/^sha256_[a-f0-9]{64}$/);
  });

  it('creates cryptographically bound ConfirmedExecutionPlan with authenticated user ID', () => {
    const ops = [
      {
        type: 'create_entity' as const,
        payload: {
          id: 'task-ai-2',
          kind: EntityKind.TASK,
          title: 'Secure Pipeline Handshake',
        },
      },
    ];

    const planResult = useStore.getState().planOperations(ops, 'ai_agent');
    expect(planResult.success).toBe(true);

    const confirmed = useStore.getState().confirmPlan(planResult.plan!);
    expect(confirmed.confirmed_by).toBe('alice-user-123');
    expect(confirmed.confirmation_token).toMatch(/^token_/);
    expect(confirmed.verified_fingerprint).toBe(planResult.plan!.plan_fingerprint);
  });

  it('executes confirmed plan, committing to kernelEntities and recording audit log', async () => {
    const ops = [
      {
        type: 'create_entity' as const,
        payload: {
          id: 'task-ai-3',
          kind: EntityKind.TASK,
          title: 'Commit to Kernel State',
          priority: 2,
        },
      },
    ];

    const planResult = useStore.getState().planOperations(ops, 'ai_agent');
    const confirmed = useStore.getState().confirmPlan(planResult.plan!);

    const executionSuccess = await useStore.getState().executeConfirmedPlan(confirmed);
    expect(executionSuccess).toBe(true);

    // Canonical kernelEntities must contain the new entity
    const kernelEntities = selectKernelEntities(useStore.getState());
    expect(kernelEntities['task-ai-3']).toBeDefined();
    expect(kernelEntities['task-ai-3'].title).toBe('Commit to Kernel State');
    expect(kernelEntities['task-ai-3'].schema_id).toBe('system/task');

    // Legacy projection must contain the new entity
    const legacyEntities = selectLegacyEntities(useStore.getState());
    expect(legacyEntities.find(e => e.id === 'task-ai-3')).toBeDefined();

    // Audit trail must record the execution
    const auditLogs = selectAuditLogs(useStore.getState());
    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs[auditLogs.length - 1].mutation_count).toBe(1);
  });

  it('rejects replay attacks when attempting to execute the same confirmed plan twice', async () => {
    const ops = [
      {
        type: 'create_entity' as const,
        payload: {
          id: 'task-replay-test',
          kind: EntityKind.TASK,
          title: 'Single-Use Token Verification',
        },
      },
    ];

    const planResult = useStore.getState().planOperations(ops, 'ai_agent');
    const confirmed = useStore.getState().confirmPlan(planResult.plan!);

    // First execution succeeds
    const firstRun = await useStore.getState().executeConfirmedPlan(confirmed);
    expect(firstRun).toBe(true);

    // Second execution must fail due to single-use token consumption
    await expect(
      useStore.getState().executeConfirmedPlan(confirmed)
    ).rejects.toThrow(/already been consumed|replay attack detected/i);
  });

  it('detects tampering and rejects execution if plan mutations were modified post-planning', async () => {
    const ops = [
      {
        type: 'create_entity' as const,
        payload: {
          id: 'task-tamper-test',
          kind: EntityKind.TASK,
          title: 'Genuine Mutation',
        },
      },
    ];

    const planResult = useStore.getState().planOperations(ops, 'ai_agent');
    const plan = planResult.plan!;

    // Tamper with plan validated_mutations
    const tamperedPlan = {
      ...plan,
      validated_mutations: [
        {
          op: 'soft_delete_entity' as const,
          entity_id: 'malicious-wipeout',
        },
      ],
    };

    // Attempting to confirm tampered plan must fail
    expect(() => {
      useStore.getState().confirmPlan(tamperedPlan);
    }).toThrow(/Plan has been modified since generation/i);
  });

  it('rejects cross-user execution (User A confirms, User B executes)', async () => {
    const ops = [
      {
        type: 'create_entity' as const,
        payload: {
          id: 'task-cross-user',
          kind: EntityKind.TASK,
          title: 'Cross-User Boundary',
        },
      },
    ];

    const planResult = useStore.getState().planOperations(ops, 'ai_agent');
    const confirmedByAlice = useStore.getState().confirmPlan(planResult.plan!);

    // Switch current user to Bob
    useStore.setState({
      currentUser: {
        uid: 'bob-user-456',
        email: 'bob@flowmate.ai',
        displayName: 'Bob Intruder',
      } as unknown as User,
    });

    // Bob attempts to execute Alice's confirmed plan
    await expect(
      useStore.getState().executeConfirmedPlan(confirmedByAlice)
    ).rejects.toThrow(/cannot execute plan confirmed by/i);
  });

  it('plans and executes soft deletion operations faithfully', async () => {
    // Seed initial entity
    useStore.getState().applyOperations([
      {
        type: 'create_entity',
        payload: {
          id: 'target-to-delete',
          kind: EntityKind.EVENT,
          title: 'Obsolete Meeting',
        },
      },
    ]);

    const deleteOps = [
      {
        type: 'delete_entity' as const,
        payload: { id: 'target-to-delete' },
      },
    ];

    const planResult = useStore.getState().planOperations(deleteOps, 'ai_agent');
    expect(planResult.success).toBe(true);

    const confirmed = useStore.getState().confirmPlan(planResult.plan!);
    await useStore.getState().executeConfirmedPlan(confirmed);

    const kernel = selectKernelEntities(useStore.getState())['target-to-delete'];
    expect(kernel).toBeDefined();
    expect(kernel.lifecycle.status).toBe('deleted');
    expect(kernel.attributes.deleted).toBe(true);

    const projected = selectLegacyEntities(useStore.getState()).find(e => e.id === 'target-to-delete');
    expect(projected).toBeDefined();
    expect(projected?.metadata?.deleted).toBe(true);
  });
});

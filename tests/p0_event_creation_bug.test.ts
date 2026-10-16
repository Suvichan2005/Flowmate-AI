import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { EntityKind, ToonOperation } from '../types';
import { convertOperationsToActionProposal } from '../services/kernel/operationAdapter';
import { SchemaRegistry } from '../services/kernel/schemaRegistry';
import { KernelAuthorizer } from '../services/kernel/authorization';
import { InMemoryPersistenceAdapter } from '../services/kernel/persistencePort';
import { ActionExecutionEngine } from '../services/kernel/actionPipeline';
import { getActiveEntities } from '../store/helpers';

describe('P0 Production Bug Regression — Event Creation & Truthful Feedback', () => {
  beforeEach(() => {
    useStore.setState({
      kernelEntities: {},
      entities: [],
      auditLogs: [],
      messages: [],
      pendingOps: null,
      currentUser: { uid: 'test_user_p0', email: 'test@flowmate.ai' } as any,
    });
  });

  it('converts compact AI operations ({ type: "c", k: "EVT", ... }) into a valid kernel ActionProposal', () => {
    const rawOps: ToonOperation[] = [
      {
        type: 'c' as any,
        payload: {
          k: 'EVT',
          t: 'Atlas assessment',
          start: '2026-10-09T19:00:00+05:30',
          dur: 90,
          tags: ['assessment', 'coding'],
          m: {
            productivity: 'PRODUCTIVE',
          },
        },
      },
    ];

    const proposal = convertOperationsToActionProposal(rawOps, {
      source: 'ai_agent',
      intent: 'Schedule Atlas assessment assessment',
    });

    expect(proposal).toBeDefined();
    expect(proposal.source).toBe('ai_agent');
    expect(proposal.mutations).toHaveLength(1);

    const mut = proposal.mutations[0];
    expect(mut.op).toBe('upsert_entity');
    if (mut.op === 'upsert_entity') {
      expect(mut.entity.title).toBe('Atlas assessment');
      expect(mut.entity.schema_id).toBe('system/event');
      expect(mut.entity.attributes.start_time).toBe('2026-10-09T19:00:00+05:30');
      // end_time automatically calculated from duration (19:00 + 90 min = 20:30)
      expect(mut.entity.attributes.end_time).toBe('2026-10-09T20:30:00+05:30');
      expect(mut.entity.attributes.duration_minutes).toBe(90);
      expect(mut.entity.attributes.tags).toEqual(['assessment', 'coding']);
      expect(mut.entity.attributes.productivity).toBe('PRODUCTIVE');
      expect(mut.entity.provenance.source_type).toBe('agent');
      expect(mut.entity.provenance.user_confirmed).toBe(false);
    }
  });

  it('successfully plans, confirms, and executes compact event operation through the 2-phase pipeline', async () => {
    const store = useStore.getState();
    const rawOps: ToonOperation[] = [
      {
        type: 'c' as any,
        payload: {
          k: 'EVT',
          t: 'Atlas assessment',
          start: '2026-10-09T19:00:00+05:30',
          dur: 90,
          tags: ['assessment', 'coding'],
          m: {
            productivity: 'PRODUCTIVE',
          },
        },
      },
    ];

    // 1. Plan operations
    const planResult = store.planOperations(rawOps, 'ai_agent');
    expect(planResult.success).toBe(true);
    expect(planResult.plan).toBeDefined();

    const plan = planResult.plan!;
    expect(plan.validated_mutations).toHaveLength(1);
    expect(plan.requires_confirmation).toBe(true);
    expect(plan.preview_items).toHaveLength(1);
    expect(plan.preview_items[0].title).toBe('Atlas assessment');
    expect(plan.preview_items[0].schema_id).toBe('system/event');

    // 2. User confirms plan
    const confirmedPlan = store.confirmPlan(plan);
    expect(confirmedPlan).toBeDefined();
    expect(confirmedPlan.confirmed_by).toBe('test_user_p0');
    expect(confirmedPlan.verified_fingerprint).toBe(plan.plan_fingerprint);

    // 3. Execute confirmed plan
    const execSuccess = await store.executeConfirmedPlan(confirmedPlan);
    expect(execSuccess).toBe(true);

    // 4. Verify canonical kernel state
    const state = useStore.getState();
    const eventEntityId = plan.preview_items[0].id;
    const kernelEvent = state.kernelEntities[eventEntityId];
    expect(kernelEvent).toBeDefined();
    expect(kernelEvent.title).toBe('Atlas assessment');
    expect(kernelEvent.schema_id).toBe('system/event');
    expect(kernelEvent.attributes.start_time).toBe('2026-10-09T19:00:00+05:30');

    // 5. Verify projection to legacy entities for Schedule view
    const legacyEvents = state.entities.filter(e => e.kind === EntityKind.EVENT);
    expect(legacyEvents).toHaveLength(1);
    const event = legacyEvents[0];
    expect(event.title).toBe('Atlas assessment');
    expect(event.start_time).toBe('2026-10-09T19:00:00+05:30');
    expect(event.end_time).toBe('2026-10-09T20:30:00+05:30');
    expect(event.duration_minutes).toBe(90);

    // 6. Verify Schedule/Agenda query match for October 9, 2026
    const targetDate = new Date('2026-10-09T00:00:00+05:30');
    const activeEntities = getActiveEntities(state.entities);
    const matched = activeEntities.filter(e => {
      if (e.kind !== EntityKind.EVENT || !e.start_time) return false;
      const d = new Date(e.start_time);
      return d.toDateString() === targetDate.toDateString();
    });
    expect(matched).toHaveLength(1);
    expect(matched[0].title).toBe('Atlas assessment');
  });

  it('rejects execution of an empty or unconfirmed plan and protects against replay attacks', async () => {
    const store = useStore.getState();
    const rawOps: ToonOperation[] = [
      {
        type: 'c' as any,
        payload: {
          k: 'EVT',
          t: 'Single Use Event',
          start: '2026-10-09T10:00:00+05:30',
        },
      },
    ];

    const planResult = store.planOperations(rawOps, 'ai_agent');
    expect(planResult.success).toBe(true);
    const plan = planResult.plan!;

    const confirmedPlan = store.confirmPlan(plan);
    const firstExec = await store.executeConfirmedPlan(confirmedPlan);
    expect(firstExec).toBe(true);

    // Attempting replay with the same confirmation token must be rejected
    await expect(store.executeConfirmedPlan(confirmedPlan)).rejects.toThrow(/replay attack detected/);
  });
});

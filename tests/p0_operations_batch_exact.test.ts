import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { ToonOperation } from '../types';

describe('P0 Project Atlas 4-Operation Exact Regression Test', () => {
  beforeEach(() => {
    useStore.setState({
      kernelEntities: {},
      entities: [],
      relationships: [],
      pendingOps: null,
      messages: [],
    });
  });

  it('plans and executes the exact 4-operation Project Atlas batch without 0 executed operations', async () => {
    // The exact 4 operations from the user report:
    // 1. Create CONTEXT: Project Atlas
    // 2. Create EVENT: Atlas kickoff assessment
    // 3. Create EVENT: Atlas review
    // 4. Create TASK: Prepare for Atlas review

    const rawOps: ToonOperation[] = [
      {
        type: 'create_entity',
        payload: {
          kind: 'CONTEXT',
          title: 'Project Atlas',
          description: 'Context for Atlas planning workflow'
        }
      },
      {
        type: 'create_entity',
        payload: {
          kind: 'EVENT',
          title: 'Atlas kickoff assessment',
          start_time: '2026-10-09T21:00:00+05:30',
          end_time: '2026-10-09T22:30:00+05:30',
          duration_minutes: 90,
          productivity: 'PRODUCTIVE',
          context: 'Project Atlas'
        }
      },
      {
        type: 'create_entity',
        payload: {
          kind: 'EVENT',
          title: 'Atlas review',
          start_time: '2026-10-16T14:00:00+05:30',
          end_time: '2026-10-16T15:00:00+05:30',
          duration_minutes: 60,
          productivity: 'PRODUCTIVE',
          context: 'Project Atlas'
        }
      },
      {
        type: 'create_entity',
        payload: {
          kind: 'TASK',
          title: 'Prepare for Atlas review',
          priority: 2,
          productivity: 'PRODUCTIVE',
          context: 'Project Atlas'
        }
      }
    ];

    const store = useStore.getState();
    const planResult = store.planOperations(rawOps, 'ai_agent');


    expect(planResult.success).toBe(true);
    expect(planResult.plan).toBeDefined();
    // 4 entity upserts + 3 canonical relationships linking events and tasks to the context
    expect(planResult.plan!.validated_mutations.length).toBe(7);

    const confirmedPlan = store.confirmPlan(planResult.plan!);
    const executed = await store.executeConfirmedPlan(confirmedPlan);
    expect(executed).toBe(true);

    const activeEntities = useStore.getState().getActiveEntities();
    expect(activeEntities.length).toBe(4);

    const relationships = useStore.getState().relationships;
    expect(relationships.length).toBe(3);

    const contextEntity = activeEntities.find(e => e.title === 'Project Atlas');
    expect(contextEntity).toBeDefined();

    const oaEvent = activeEntities.find(e => e.title === 'Atlas kickoff assessment');
    expect(oaEvent).toBeDefined();
    expect(oaEvent?.kind).toBe('EVENT');

    const interviewEvent = activeEntities.find(e => e.title === 'Atlas review');
    expect(interviewEvent).toBeDefined();
    expect(interviewEvent?.kind).toBe('EVENT');

    const prepTask = activeEntities.find(e => e.title === 'Prepare for Atlas review');
    expect(prepTask).toBeDefined();
    expect(prepTask?.kind).toBe('TASK');
  });

  it('also handles token-saving short operation types (c, EVT, TSK, CTX) for the same 4-operation batch', async () => {
    const rawOps: any[] = [
      {
        type: 'c',
        payload: {
          k: 'CTX',
          t: 'Project Atlas',
          d: 'Context for Atlas planning workflow'
        }
      },
      {
        type: 'c',
        payload: {
          k: 'EVT',
          t: 'Atlas kickoff assessment',
          start: '2026-10-09T21:00:00+05:30',
          end: '2026-10-09T22:30:00+05:30',
          dur: 90,
          m: { productivity: 'PRODUCTIVE' }
        }
      },
      {
        type: 'c',
        payload: {
          k: 'EVT',
          t: 'Atlas review',
          start: '2026-10-16T14:00:00+05:30',
          dur: 60,
          m: { productivity: 'PRODUCTIVE' }
        }
      },
      {
        type: 'c',
        payload: {
          k: 'TSK',
          t: 'Prepare for Atlas review',
          p: 2,
          m: { productivity: 'PRODUCTIVE' }
        }
      }
    ];

    const store = useStore.getState();
    const planResult = store.planOperations(rawOps, 'ai_agent');

    expect(planResult.success).toBe(true);
    expect(planResult.plan!.validated_mutations.length).toBe(4);

    const confirmedPlan = store.confirmPlan(planResult.plan!);
    const executed = await store.executeConfirmedPlan(confirmedPlan);
    expect(executed).toBe(true);

    const activeEntities = useStore.getState().getActiveEntities();
    expect(activeEntities.length).toBe(4);
  });
});

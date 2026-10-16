import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { ToonOperation } from '../types';

describe('P0 Multi-Operation Batch Regression Test', () => {
  beforeEach(() => {
    useStore.setState({
      kernelEntities: {},
      entities: [],
      relationships: [],
      pendingOps: null,
      messages: [],
    });
  });

  it('successfully plans and executes the user exact multi-op payload without dropping operations', async () => {
    const rawOps: any[] = [
      {
        type: 'c',
        payload: {
          k: 'CTX',
          d: 'Atlas assessment and technical/behavioral interview rounds',
          t: 'Project Atlas'
        }
      },
      {
        type: 'c',
        payload: {
          end: '2026-10-09T22:30:00+05:30',
          m: { productivity: 'PRODUCTIVE' },
          context: 'Project Atlas',
          k: 'EVT',
          start: '2026-10-09T21:00:00+05:30',
          t: 'Atlas kickoff assessment'
        }
      },
      {
        type: 'c',
        payload: {
          context: 'Project Atlas',
          m: { productivity: 'PRODUCTIVE' },
          start: '2026-10-14T14:00:00+05:30',
          k: 'EVT',
          t: 'Atlas review',
          end: '2026-10-14T15:00:00+05:30'
        }
      },
      {
        type: 'c',
        payload: {
          m: { productivity: 'PRODUCTIVE' },
          context: 'Project Atlas',
          k: 'TSK',
          t: 'Atlas preparation',
          due: '2026-10-14T12:00:00+05:30'
        }
      },
      {
        type: 's',
        payload: {
          entity_id: 'Atlas preparation',
          estimated_minutes: 120,
          t: 'Review project principles & prepare project examples'
        }
      },
      {
        type: 's',
        payload: {
          t: 'Practice technical practice questions',
          estimated_minutes: 180,
          entity_id: 'Atlas preparation'
        }
      }
    ];

    const store = useStore.getState();
    const planResult = store.planOperations(rawOps, 'ai_agent');


    expect(planResult.success).toBe(true);
    expect(planResult.plan).toBeDefined();
    expect(planResult.plan!.validated_mutations.length).toBeGreaterThanOrEqual(4);

    const confirmedPlan = store.confirmPlan(planResult.plan!);
    const executed = await store.executeConfirmedPlan(confirmedPlan);
    expect(executed).toBe(true);

    const activeEntities = useStore.getState().getActiveEntities();
    expect(activeEntities.length).toBeGreaterThanOrEqual(4);

    const oaEvent = activeEntities.find(e => e.title.includes('Atlas kickoff assessment'));
    expect(oaEvent).toBeDefined();
    expect(oaEvent?.kind).toBe('EVENT');
  });
});

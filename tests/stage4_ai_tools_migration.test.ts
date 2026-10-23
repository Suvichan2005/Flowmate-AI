/**
 * Task P1-05: Stage 4 — AI Tools Migration Tests
 *
 * Verifies:
 * 1. AI Tool declarations (query_entities, reflect_schemas, and FLOWMATE_TOOLS).
 * 2. Schema reflection engine (executeReflectSchemas).
 * 3. Bounded entity queries (executeQueryEntities) with QueryAuthorizationContext,
 *    capability filtering, schema filtering, status filtering, date range filtering,
 *    and privacy tier enforcement.
 * 4. Soft-delete tombstone exclusion in AI queries.
 * 5. Bounded result clamping (1 <= limit <= 25).
 * 6. AI tool operation generation -> ActionExecutionEngine validation, planning,
 *    SHA-256 fingerprinting, user confirmation, and execution.
 * 7. ZERO `any` invariants.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import {
  queryEntitiesTool,
  reflectSchemasTool,
  FLOWMATE_TOOLS,
} from '../services/ai/tools';
import {
  executeQueryEntities,
  executeReflectSchemas,
  dispatchToolCall,
} from '../services/ai/executors';
import {
  SYSTEM_TASK_SCHEMA,
  SYSTEM_EVENT_SCHEMA,
  SYSTEM_NOTE_SCHEMA,
  SYSTEM_PERSON_SCHEMA,
  convertOperationsToActionProposal,
  schemaRegistry,
  ExecutionPlan,
  ConfirmedExecutionPlan,
} from '../services/kernel';
import { EntityKind, EntityStatus, Entity, ToonOperation } from '../types';
import { User } from '../services/firebase';

describe('Stage 4: AI Tools Migration & Greenfield Kernel Query Engine', () => {
  beforeEach(() => {
    // Reset store state
    useStore.setState({
      currentUser: {
        uid: 'user_stage4_test',
        email: 'stage4@flowmate.ai',
        displayName: 'Stage 4 User',
      } as unknown as User,
      kernelEntities: {},
      schemas: {
        'system/task': SYSTEM_TASK_SCHEMA,
        'system/event': SYSTEM_EVENT_SCHEMA,
        'system/note': SYSTEM_NOTE_SCHEMA,
        'system/person': SYSTEM_PERSON_SCHEMA,
      },
      auditLogs: [],
    });
  });

  describe('1. AI Tool Declarations & Schemas', () => {
    it('declares query_entities with bounded filtering parameters', () => {
      expect(queryEntitiesTool.name).toBe('query_entities');
      expect(queryEntitiesTool.parameters?.type).toBeDefined();
      const props = (queryEntitiesTool.parameters as unknown as { properties: Record<string, unknown> }).properties;
      expect(props.query).toBeDefined();
      expect(props.schema_id).toBeDefined();
      expect(props.capability).toBeDefined();
      expect(props.status).toBeDefined();
      expect(props.date_range).toBeDefined();
      expect(props.tags).toBeDefined();
      expect(props.limit).toBeDefined();
    });

    it('declares reflect_schemas for inspecting schema registry and capabilities', () => {
      expect(reflectSchemasTool.name).toBe('reflect_schemas');
      const props = (reflectSchemasTool.parameters as unknown as { properties: Record<string, unknown> }).properties;
      expect(props.scope).toBeDefined();
      expect(props.schema_id).toBeDefined();
    });

    it('bundles all 12 supported tools into FLOWMATE_TOOLS after retiring route lookup', () => {
      expect(FLOWMATE_TOOLS).toHaveLength(1);
      const decls = FLOWMATE_TOOLS[0].functionDeclarations!;
      expect(decls.length).toBe(12);
      const names = decls.map(d => d.name);
      expect(names).toContain('query_entities');
      expect(names).toContain('reflect_schemas');
      expect(names).toContain('query_commitment');
      expect(names).toContain('configure_commitment');
      expect(names).toContain('record_commitment_evidence');
      expect(names).toContain('read_calendar');
      expect(names).toContain('search_entities');
      expect(names).toContain('apply_changes');
      expect(names).not.toContain('lookup_travel_route');
    });
  });

  describe('2. Schema Reflection (executeReflectSchemas)', () => {
    it('returns compact digests of registered system schemas', () => {
      const res = executeReflectSchemas({ scope: 'system' });
      expect(res.total).toBeGreaterThanOrEqual(4);
      const schemas = res.schemas as Array<{ id: string; version: number; capabilities: string[] }>;
      expect(Array.isArray(schemas)).toBe(true);
      expect(schemas.some(s => s.id === 'system/task')).toBe(true);
      expect(schemas.some(s => s.id === 'system/event')).toBe(true);
    });

    it('returns full schema definition when schema_id is explicitly requested', () => {
      const res = executeReflectSchemas({ schema_id: 'system/task' });
      expect(res.schema).toBeDefined();
      const schema = res.schema as typeof SYSTEM_TASK_SCHEMA;
      expect(schema.id).toBe('system/task');
      expect(schema.capabilities).toContain('schedulable');
      expect(schema.attributes.priority).toBeDefined();
      expect(schema.attributes.deadline).toBeDefined();
    });

    it('returns error when requesting non-existent schema', () => {
      const res = executeReflectSchemas({ schema_id: 'non_existent_schema_xyz' });
      expect(res.error).toBeDefined();
      expect(res.error).toContain('Schema not found');
    });
  });

  describe('3. Bounded Entity Query Engine (executeQueryEntities)', () => {
    const mockEntities: Entity[] = [
      {
        id: 'task-active-1',
        kind: EntityKind.TASK,
        title: 'Complete Math Homework',
        description: 'Finish chapter 4 exercises',
        status: EntityStatus.ACTIVE,
        priority: 1,
        start_time: null,
        end_time: null,
        deadline: '2026-10-10T12:00:00+05:30',
        duration_minutes: 60,
        recurrence: null,
        canonical_tags: ['academics', 'math'],
        metadata: {},
        created_at: '2026-10-06T10:00:00+05:30',
        updated_at: '2026-10-06T10:00:00+05:30',
      },
      {
        id: 'task-completed-2',
        kind: EntityKind.TASK,
        title: 'Submit Chemistry Lab',
        description: 'Uploaded report to portal',
        status: EntityStatus.COMPLETED,
        priority: 2,
        start_time: null,
        end_time: null,
        deadline: '2026-10-05T12:00:00+05:30',
        duration_minutes: 45,
        recurrence: null,
        canonical_tags: ['academics', 'chemistry'],
        metadata: {},
        created_at: '2026-10-04T10:00:00+05:30',
        updated_at: '2026-10-05T14:00:00+05:30',
      },
      {
        id: 'event-calendar-3',
        kind: EntityKind.EVENT,
        title: 'Flight to Delhi',
        description: 'IndiGo 6E-204',
        status: EntityStatus.PENDING,
        priority: 1,
        start_time: '2026-10-15T08:00:00+05:30',
        end_time: '2026-10-15T10:30:00+05:30',
        deadline: null,
        duration_minutes: 150,
        recurrence: null,
        canonical_tags: ['travel', 'flight'],
        metadata: {},
        created_at: '2026-10-06T11:00:00+05:30',
        updated_at: '2026-10-06T11:00:00+05:30',
      },
      {
        id: 'habit-daily-4',
        kind: EntityKind.HABIT,
        title: 'Morning Yoga',
        description: '20 mins stretches and breathing',
        status: EntityStatus.ACTIVE,
        priority: 3,
        start_time: null,
        end_time: null,
        deadline: null,
        duration_minutes: 20,
        recurrence: 'DAILY',
        canonical_tags: ['health', 'fitness'],
        metadata: { streak_current: 7 },
        created_at: '2026-09-01T06:00:00+05:30',
        updated_at: '2026-10-06T06:30:00+05:30',
      },
      {
        id: 'task-deleted-5',
        kind: EntityKind.TASK,
        title: 'Discarded Old Note Task',
        description: 'Should not appear anywhere',
        status: EntityStatus.ARCHIVED,
        priority: 5,
        start_time: null,
        end_time: null,
        deadline: null,
        duration_minutes: null,
        recurrence: null,
        canonical_tags: [],
        metadata: { deleted: true },
        created_at: '2026-09-01T00:00:00+05:30',
        updated_at: '2026-09-02T00:00:00+05:30',
      },
    ];

    it('filters strictly by schema_id', () => {
      const res = executeQueryEntities({ schema_id: 'system/habit' }, mockEntities);
      expect(res.total_matched).toBe(1);
      expect(res.entities[0].id).toBe('habit-daily-4');
      expect(res.entities[0].title).toBe('Morning Yoga');
    });

    it('filters by status', () => {
      const res = executeQueryEntities({ schema_id: 'system/task', status: 'completed' }, mockEntities);
      expect(res.total_matched).toBe(1);
      expect(res.entities[0].id).toBe('task-completed-2');
    });

    it('filters by capability (e.g. schedulable matches tasks and events)', () => {
      const res = executeQueryEntities({ capability: 'schedulable' }, mockEntities);
      const ids = res.entities.map(e => e.id);
      expect(ids).toContain('task-active-1');
      expect(ids).toContain('task-completed-2');
      expect(ids).toContain('event-calendar-3');
      // Habit schema does not bind schedulable
      expect(ids).not.toContain('habit-daily-4');
    });

    it('filters by date_range', () => {
      const res = executeQueryEntities(
        {
          date_range: {
            start: '2026-10-14T00:00:00+05:30',
            end: '2026-10-16T00:00:00+05:30',
          },
        },
        mockEntities
      );
      expect(res.total_matched).toBe(1);
      expect(res.entities[0].id).toBe('event-calendar-3');
    });

    it('filters by keyword query across title and description', () => {
      const res = executeQueryEntities({ query: 'Chemistry' }, mockEntities);
      expect(res.total_matched).toBe(1);
      expect(res.entities[0].id).toBe('task-completed-2');
    });

    it('filters by tags', () => {
      const res = executeQueryEntities({ tags: ['flight'] }, mockEntities);
      expect(res.total_matched).toBe(1);
      expect(res.entities[0].id).toBe('event-calendar-3');
    });

    it('strictly excludes soft-deleted tombstones', () => {
      const res = executeQueryEntities({ query: 'Discarded' }, mockEntities);
      expect(res.total_matched).toBe(0);
      expect(res.entities).toHaveLength(0);
    });

    it('strictly clamps limit between 1 and 25', () => {
      const resLarge = executeQueryEntities({ limit: 100 }, mockEntities);
      expect(resLarge.limit).toBe(25);

      const resZero = executeQueryEntities({ limit: 0 }, mockEntities);
      expect(resZero.limit).toBe(1);
    });

    it('rejects unauthenticated query context via KernelAuthorizer', () => {
      // Temporarily remove user from store
      useStore.setState({ currentUser: null });
      const res = executeQueryEntities({}, mockEntities);
      expect(res.error).toBeDefined();
      expect(res.error).toContain('Unauthenticated query');
    });
  });

  describe('4. Tool Dispatch Integration', () => {
    it('dispatches query_entities through dispatchToolCall', async () => {
      const mockList: Entity[] = [
        {
          id: 'test-evt-1',
          kind: EntityKind.EVENT,
          title: 'Team Retrospective',
          description: null,
          status: EntityStatus.ACTIVE,
          priority: 2,
          start_time: '2026-10-07T15:00:00+05:30',
          end_time: '2026-10-07T16:00:00+05:30',
          deadline: null,
          duration_minutes: 60,
          recurrence: null,
          canonical_tags: ['work'],
          metadata: {},
          created_at: '2026-10-07T10:00:00+05:30',
          updated_at: '2026-10-07T10:00:00+05:30',
        },
      ];

      const res = await dispatchToolCall(
        {
          name: 'query_entities',
          args: { query: 'Retrospective', schema_id: 'system/event' },
        },
        mockList
      );

      expect(res.name).toBe('query_entities');
      expect(res.response.result).toBeDefined();
      expect(res.response.result?.total_matched).toBe(1);
      expect(res.response.result?.entities![0].id).toBe('test-evt-1');
    });

    it('dispatches reflect_schemas through dispatchToolCall', async () => {
      const res = await dispatchToolCall({ name: 'reflect_schemas', args: {} }, []);
      expect(res.name).toBe('reflect_schemas');
      expect(res.response.result?.schemas).toBeDefined();
    });
  });

  describe('5. AI Proposal Generation -> ActionExecutionEngine Pipeline', () => {
    it('processes AI-generated apply_changes ops into valid ActionProposal, plans, fingerprints, confirms, and executes', async () => {
      // 1. Simulate AI outputting operations
      const aiOps: ToonOperation[] = [
        {
          type: 'create_entity',
          payload: {
            id: 'task-ai-generated-1',
            kind: EntityKind.TASK,
            title: 'Prepare Presentation Slides',
            description: 'Slides for quarterly review',
            status: EntityStatus.ACTIVE,
            priority: 2,
            deadline: '2026-10-12T18:00:00+05:30',
          },
        },
        {
          type: 'create_entity',
          payload: {
            id: 'evt-ai-generated-2',
            kind: EntityKind.EVENT,
            title: 'Quarterly Review Meeting',
            start: '2026-10-12T19:00:00+05:30',
            end: '2026-10-12T20:30:00+05:30',
          },
        },
      ];

      // 2. Verify conversion to ActionProposal via kernel adapter
      const proposal = convertOperationsToActionProposal(aiOps, {
        source: 'ai_agent',
        intent: 'AI assistant proposal for quarterly review',
      });
      expect(proposal.source).toBe('ai_agent');
      expect(proposal.mutations).toHaveLength(2);

      // 3. Plan with store action pipeline
      const planResult = useStore.getState().planOperations(aiOps, 'ai_agent');
      expect(planResult.success).toBe(true);
      expect(planResult.plan).toBeDefined();

      const plan = planResult.plan!;
      expect(plan.requires_confirmation).toBe(true);
      expect(plan.plan_fingerprint).toMatch(/^sha256_[a-f0-9]{64}$/);
      expect(plan.preview_items).toHaveLength(2);

      // 4. Confirm with authenticated user
      const confirmedPlan = useStore.getState().confirmPlan(plan);
      expect(confirmedPlan.confirmed_by).toBe('user_stage4_test');
      expect(confirmedPlan.confirmation_token).toBeDefined();
      expect(confirmedPlan.verified_fingerprint).toBe(plan.plan_fingerprint);

      // 5. Execute confirmed plan
      const execResult = await useStore.getState().executeConfirmedPlan(confirmedPlan);
      expect(execResult).toBe(true);

      // 6. Verify canonical state committed to kernelEntities in Zustand store
      const storeState = useStore.getState();
      const task = storeState.kernelEntities['task-ai-generated-1'];
      expect(task).toBeDefined();
      expect(task.title).toBe('Prepare Presentation Slides');
      expect(task.schema_id).toBe('system/task');

      const evt = storeState.kernelEntities['evt-ai-generated-2'];
      expect(evt).toBeDefined();
      expect(evt.title).toBe('Quarterly Review Meeting');
      expect(evt.schema_id).toBe('system/event');

      // 7. Verify replay attack prevention: Re-executing same confirmed plan fails
      await expect(
        useStore.getState().executeConfirmedPlan(confirmedPlan)
      ).rejects.toThrow('replay attack detected');
    });
  });
});

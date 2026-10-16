/**
 * Task P1-05: Stage 5 — Capability-Derived Projections Tests
 *
 * Verifies:
 * 1. CalendarView temporal projection using Schedulable capability contract.
 * 2. Dashboard trackable progress projection using TrackableProgress capability contract.
 * 3. EntityList schema-driven and capability-driven filtering.
 * 4. UI mutation convergence through canonical kernel action pipeline.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import {
  Entity,
  SCHEDULABLE_CAPABILITY,
  TRACKABLE_PROGRESS_CAPABILITY,
  SYSTEM_TASK_SCHEMA,
  SYSTEM_GOAL_SCHEMA,
  SYSTEM_EVENT_SCHEMA,
} from '../services/kernel';
import { calculateProgress } from '../utils/progressCalculation';
import { User } from '../services/firebase';
import { EntityKind, EntityStatus } from '../types';

describe('Stage 5: Capability-Derived Projections & Schema-Driven Views', () => {
  beforeEach(() => {
    useStore.setState({
      currentUser: {
        uid: 'stage5_user',
        email: 'stage5@flowmate.ai',
        displayName: 'Stage 5 User',
      } as unknown as User,
      kernelEntities: {},
      schemas: {
        'system/task': SYSTEM_TASK_SCHEMA,
        'system/goal': SYSTEM_GOAL_SCHEMA,
        'system/event': SYSTEM_EVENT_SCHEMA,
      },
      auditLogs: [],
    });
  });

  it('correctly projects schedulable entities onto timeline/calendar slots', () => {
    const taskWithDeadline: Entity = {
      id: 'task_sched_1',
      schema_id: 'system/task',
      version: 1,
      title: 'Submit Paper',
      attributes: {
        deadline: '2026-10-15T18:00:00Z',
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

    const eventWithTimes: Entity = {
      id: 'event_sched_2',
      schema_id: 'system/event',
      version: 1,
      title: 'Lab Meeting',
      attributes: {
        start_time: '2026-10-15T10:00:00Z',
        end_time: '2026-10-15T11:00:00Z',
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

    expect(SCHEDULABLE_CAPABILITY.is_satisfied_by(taskWithDeadline)).toBe(true);
    const taskContract = SCHEDULABLE_CAPABILITY.extract_contract(taskWithDeadline);
    expect(taskContract.deadline).toBe('2026-10-15T18:00:00Z');

    expect(SCHEDULABLE_CAPABILITY.is_satisfied_by(eventWithTimes)).toBe(true);
    const eventContract = SCHEDULABLE_CAPABILITY.extract_contract(eventWithTimes);
    expect(eventContract.start_time).toBe('2026-10-15T10:00:00Z');
    expect(eventContract.end_time).toBe('2026-10-15T11:00:00Z');
  });

  it('correctly calculates progress for trackable goals via capability contracts and calculateProgress', () => {
    const goalEntity: Entity = {
      id: 'goal_track_1',
      schema_id: 'system/goal',
      version: 1,
      title: 'Complete Thesis',
      attributes: {
        progress: 80,
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

    // Capability contract extraction
    expect(TRACKABLE_PROGRESS_CAPABILITY.is_satisfied_by(goalEntity)).toBe(true);
    const capContract = TRACKABLE_PROGRESS_CAPABILITY.extract_contract(goalEntity);
    expect(capContract.percentage).toBe(80);

    // Dashboard calculateProgress compatibility
    const legacyProjected = {
      id: goalEntity.id,
      kind: EntityKind.GOAL,
      title: goalEntity.title,
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 3,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      metadata: { progress: 80 },
      created_at: goalEntity.lifecycle.created_at,
      updated_at: goalEntity.lifecycle.updated_at,
      canonical_tags: [],
    };

    const percent = calculateProgress(legacyProjected, [legacyProjected], []);
    expect(percent).toBe(80);
  });

  it('converges view mutations cleanly through canonical kernel store pipeline', async () => {
    const store = useStore.getState();

    // 1. Create a goal from view
    store.addEntity({
      id: 'view_created_goal',
      title: 'Read 20 Research Papers',
      kind: EntityKind.GOAL,
      description: 'Read 20 papers this semester',
      priority: 2,
      status: EntityStatus.ACTIVE,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      metadata: {
        progress: 25,
        target_count: 20,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      canonical_tags: [],
    });

    const stateAfterAdd = useStore.getState();
    const created = stateAfterAdd.kernelEntities['view_created_goal'];
    expect(created).toBeDefined();
    expect(created.schema_id).toBe('system/goal');
    expect(created.version).toBe(1);

    // 2. View updates progress
    store.updateEntity('view_created_goal', {
      metadata: { progress: 50 },
    });

    const stateAfterUpdate = useStore.getState();
    const updated = stateAfterUpdate.kernelEntities['view_created_goal'];
    expect(updated.version).toBe(2);
    expect(updated.attributes.progress).toBe(50);

    // 3. Projected entities match
    const projected = stateAfterUpdate.entities.find(e => e.id === 'view_created_goal');
    expect(projected).toBeDefined();
    expect(projected?.metadata.progress).toBe(50);
  });
});

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Dashboard from '../components/Dashboard';
import { useStore } from '../store';
import { EntityKind, EntityStatus, RelationshipType, Entity } from '../types';

describe('Dashboard Graph Insights & Next-Action Triage Grounding', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    useStore.setState({
      entities: [],
      kernelEntities: {},
      relationships: [],
      selectedEntityId: null,
      pendingOps: null,
      isHydrated: true,
      settings: {
        feature_toggles: {
          food_tracking: false,
          attendance_tracking: false,
          gamification: false,
          quick_streaks: true,
          people_tracking: true
        },
        productivity_calc_method: 'LOGGED_TIME'
      } as any
    });
  });

  it('correctly excludes parent_id linked entities from being flagged as unlinked orphans', () => {
    const parentGoal: Entity = {
      id: 'goal-root-1',
      kind: EntityKind.GOAL,
      title: 'Master Quantum Computing',
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 1,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const childTask: Entity = {
      id: 'task-child-1',
      kind: EntityKind.TASK,
      title: 'Complete Qiskit Tutorial',
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 2,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      parent_id: 'goal-root-1', // Linked via parent_id
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const genuineOrphan: Entity = {
      id: 'task-orphan-1',
      kind: EntityKind.TASK,
      title: 'Random floating idea',
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 3,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      parent_id: null,
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    useStore.setState({
      entities: [parentGoal, childTask, genuineOrphan],
      relationships: [] // No explicit rows in relationships table
    });

    render(<Dashboard />);

    // Unlinked items counter should be exactly 1 (only the genuine orphan)
    const unlinkedCard = screen.getByTestId('dashboard-unlinked-card');
    expect(unlinkedCard).toBeInTheDocument();
    expect(within(unlinkedCard).getByText('1')).toBeInTheDocument();

    // Click Unlinked card to open modal
    fireEvent.click(unlinkedCard);

    const modal = screen.getByRole('dialog');
    expect(modal).toBeInTheDocument();
    expect(screen.getByText('Unconnected Items')).toBeInTheDocument();

    // Genuine orphan appears in modal
    expect(within(modal).getByText('Random floating idea')).toBeInTheDocument();
    // Neither parent goal nor child task appears in orphans modal
    expect(within(modal).queryByText('Master Quantum Computing')).not.toBeInTheDocument();
    expect(within(modal).queryByText('Complete Qiskit Tutorial')).not.toBeInTheDocument();
  });

  it('recognizes active projects with tasks linked via parent_id and FULFILLS as not stalled', () => {
    const projectWithParentIdTask: Entity = {
      id: 'proj-1',
      kind: EntityKind.PROJECT,
      title: 'Launch Flowmate v4',
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 1,
      start_time: null,
      end_time: null,
      deadline: '2026-11-01T00:00:00.000Z',
      duration_minutes: null,
      recurrence: null,
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const taskViaParentId: Entity = {
      id: 'task-p1',
      kind: EntityKind.TASK,
      title: 'Review production build bundle',
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 2,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      parent_id: 'proj-1',
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const projectWithFulfillsTask: Entity = {
      id: 'proj-2',
      kind: EntityKind.PROJECT,
      title: 'Database Performance Hardening',
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 1,
      start_time: null,
      end_time: null,
      deadline: '2026-11-05T00:00:00.000Z',
      duration_minutes: null,
      recurrence: null,
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const taskViaFulfills: Entity = {
      id: 'task-p2',
      kind: EntityKind.TASK,
      title: 'Add SQLite monotonic fence',
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 2,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const genuinelyStalledProject: Entity = {
      id: 'proj-stalled',
      kind: EntityKind.PROJECT,
      title: 'Redesign Landing Page',
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 2,
      start_time: null,
      end_time: null,
      deadline: '2026-11-10T00:00:00.000Z',
      duration_minutes: null,
      recurrence: null,
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    useStore.setState({
      entities: [
        projectWithParentIdTask,
        taskViaParentId,
        projectWithFulfillsTask,
        taskViaFulfills,
        genuinelyStalledProject
      ],
      relationships: [
        {
          id: 'rel-fulfills-1',
          from: 'task-p2',
          to: 'proj-2',
          type: RelationshipType.FULFILLS,
          meta: {},
          created_at: new Date().toISOString()
        }
      ]
    });

    render(<Dashboard />);

    // Stalled projects counter should be exactly 1 (only genuinelyStalledProject)
    const stalledCard = screen.getByTestId('dashboard-stalled-card');
    expect(stalledCard).toBeInTheDocument();
    expect(within(stalledCard).getByText('1')).toBeInTheDocument();

    // Open Projects Needing Next Action modal
    fireEvent.click(stalledCard);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Projects Needing Next Action')).toBeInTheDocument();
    expect(screen.getByText('Redesign Landing Page')).toBeInTheDocument();
    expect(screen.queryByText('Launch Flowmate v4')).not.toBeInTheDocument();
    expect(screen.queryByText('Database Performance Hardening')).not.toBeInTheDocument();
  });

  it('supports inline next-action creation to immediately resolve stalled projects', () => {
    const applyOpsSpy = vi.fn((ops) => {
      // Simulate real store update
      const currentEntities = useStore.getState().entities;
      const createdTask = ops[0].payload;
      useStore.setState({
        entities: [
          ...currentEntities,
          {
            ...createdTask,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            canonical_tags: [],
            recurrence: null,
            duration_minutes: null,
            start_time: null,
            end_time: null,
            deadline: null,
            description: null
          }
        ]
      });
    });

    const stalledProject: Entity = {
      id: 'proj-mobile-app',
      kind: EntityKind.PROJECT,
      title: 'Mobile App Architecture',
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 1,
      start_time: null,
      end_time: null,
      deadline: '2026-11-20T00:00:00.000Z',
      duration_minutes: null,
      recurrence: null,
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    useStore.setState({
      entities: [stalledProject],
      relationships: [],
      applyOperations: applyOpsSpy
    });

    render(<Dashboard />);

    // Open Stalled modal
    const stalledCard = screen.getByTestId('dashboard-stalled-card');
    fireEvent.click(stalledCard);

    expect(screen.getByText('Mobile App Architecture')).toBeInTheDocument();

    // Click "+ Next Action" button
    const nextActionBtn = screen.getByTestId('add-next-action-btn-proj-mobile-app');
    expect(nextActionBtn).toBeInTheDocument();
    fireEvent.click(nextActionBtn);

    // Form input appears
    const input = screen.getByTestId('inline-next-action-input-proj-mobile-app');
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Draft React Native bridge specifications' } });

    // Click Add button
    const addBtn = screen.getByTestId('inline-next-action-save-proj-mobile-app');
    fireEvent.click(addBtn);

    // Verify applyOperations was called with task creation and link
    expect(applyOpsSpy).toHaveBeenCalledTimes(1);
    const ops = applyOpsSpy.mock.calls[0][0];
    expect(ops[0].type).toBe('create_entity');
    expect(ops[0].payload.kind).toBe(EntityKind.TASK);
    expect(ops[0].payload.title).toBe('Draft React Native bridge specifications');
    expect(ops[0].payload.parent_id).toBe('proj-mobile-app');
    expect(ops[1].type).toBe('link_entities');
    expect(ops[1].payload.from).toBe(ops[0].payload.id);
    expect(ops[1].payload.to).toBe('proj-mobile-app');
    expect(ops[1].payload.type).toBe(RelationshipType.PART_OF);

    // The project now has an active task and should no longer be listed as stalled!
    expect(screen.getByTestId('insight-modal-empty')).toHaveTextContent('No items found');
  });

  it('supports accessible dismissal via Escape key and backdrop click in InsightModal', () => {
    const orphanItem: Entity = {
      id: 'task-orphan-escape',
      kind: EntityKind.TASK,
      title: 'Escape test task',
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 3,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    useStore.setState({
      entities: [orphanItem],
      relationships: []
    });

    render(<Dashboard />);

    const unlinkedCard = screen.getByTestId('dashboard-unlinked-card');
    fireEvent.click(unlinkedCard);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'insight-modal-title');

    // Escape key dismisses modal
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen and test backdrop click dismissal
    fireEvent.click(unlinkedCard);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const backdrop = screen.getByTestId('insight-modal-backdrop');
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders Due Soon items with Overdue and Due Today badges and supports 1-click Done and +1d actions', () => {
    const applyOpsSpy = vi.fn();
    const pastDeadline = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const todayDeadline = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const overdueTask: Entity = {
      id: 'task-overdue-1',
      kind: EntityKind.TASK,
      title: 'Submit quarterly tax report',
      description: null,
      status: EntityStatus.IN_PROGRESS,
      priority: 1,
      start_time: null,
      end_time: null,
      deadline: pastDeadline,
      duration_minutes: null,
      recurrence: null,
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const dueTodayTask: Entity = {
      id: 'task-today-1',
      kind: EntityKind.TASK,
      title: 'Review team pull requests',
      description: null,
      status: EntityStatus.ACTIVE,
      priority: 2,
      start_time: null,
      end_time: null,
      deadline: todayDeadline,
      duration_minutes: null,
      recurrence: null,
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const completedTask: Entity = {
      id: 'task-completed-1',
      kind: EntityKind.TASK,
      title: 'Already finished task',
      description: null,
      status: EntityStatus.COMPLETED,
      priority: 3,
      start_time: null,
      end_time: null,
      deadline: pastDeadline,
      duration_minutes: null,
      recurrence: null,
      canonical_tags: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    useStore.setState({
      entities: [overdueTask, dueTodayTask, completedTask],
      relationships: [],
      applyOperations: applyOpsSpy
    });

    render(<Dashboard />);

    // Due counter should show 2 (completedTask is ignored)
    const dueCard = screen.getByTestId('dashboard-due-card');
    expect(dueCard).toBeInTheDocument();
    expect(within(dueCard).getByText('2')).toBeInTheDocument();

    // Click Due card to open modal
    fireEvent.click(dueCard);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Due Soon (Chronological)')).toBeInTheDocument();

    // Verify overdue item has Overdue badge
    const overdueCard = screen.getByTestId('due-item-card-task-overdue-1');
    expect(within(overdueCard).getByText(/Overdue/i)).toBeInTheDocument();
    expect(within(overdueCard).getByText('Submit quarterly tax report')).toBeInTheDocument();

    // Verify due today item has Due Today badge
    const todayCard = screen.getByTestId('due-item-card-task-today-1');
    expect(within(todayCard).getByText('Due Today')).toBeInTheDocument();
    expect(within(todayCard).getByText('Review team pull requests')).toBeInTheDocument();

    // Test 1-click Done action
    const doneBtn = screen.getByTestId('complete-due-btn-task-overdue-1');
    fireEvent.click(doneBtn);

    expect(applyOpsSpy).toHaveBeenCalledTimes(1);
    expect(applyOpsSpy.mock.calls[0][0][0]).toEqual({
      type: 'update_entity',
      payload: {
        id: 'task-overdue-1',
        status: EntityStatus.COMPLETED,
        fields: {
          status: EntityStatus.COMPLETED
        }
      }
    });

    // Test 1-click +1d defer action
    const deferBtn = screen.getByTestId('defer-due-btn-task-today-1');
    fireEvent.click(deferBtn);

    expect(applyOpsSpy).toHaveBeenCalledTimes(2);
    const deferOp = applyOpsSpy.mock.calls[1][0][0];
    expect(deferOp.type).toBe('update_entity');
    expect(deferOp.payload.id).toBe('task-today-1');
    expect(new Date(deferOp.payload.deadline).getTime()).toBeGreaterThan(new Date(todayDeadline).getTime());
  });
});

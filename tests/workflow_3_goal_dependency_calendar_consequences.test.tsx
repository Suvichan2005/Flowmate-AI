import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import GoalProgressChart from '../components/GoalProgressChart';
import EntityDetailPanel from '../components/EntityDetailPanel';
import { MemoryDetailView } from '../components/MemoryDetailView';
import { useStore } from '../store';
import { EntityKind, EntityStatus, RelationshipType, type Entity } from '../types';
import type { Entity as KernelEntity } from '../services/kernel/types';
import { extractMemoryItem } from '../services/context/resolver';

describe('Reference Workflow 3: Goal Navigation, Dependent Work, Calendar Consequences, & Contextual Notes', () => {
  afterEach(() => {
    cleanup();
  });

  const goalEntity: Entity = {
    id: 'goal-quantum-1',
    kind: EntityKind.GOAL,
    title: 'Deliver Flowmate Knowledge Graph v4',
    description: 'Transform raw data into a coherent, calm personal operating system.',
    status: EntityStatus.ACTIVE,
    priority: 1,
    start_time: '2026-10-15T09:00:00Z',
    end_time: '2026-11-15T18:00:00Z',
    deadline: '2026-11-15T18:00:00Z',
    duration_minutes: 2400,
    recurrence: null,
    canonical_tags: ['architecture', 'knowledge', 'release'],
    metadata: {
      progress_percent: 50,
    },
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-12T08:00:00Z',
  };

  const task1Entity: Entity = {
    id: 'task-sync-reconcile-1',
    kind: EntityKind.TASK,
    title: 'Implement Multi-Tab Tombstone Supremacy',
    description: 'Ensure local tombstones dominate stale remote revisions.',
    status: EntityStatus.COMPLETED,
    priority: 1,
    start_time: '2026-10-12T09:00:00Z',
    end_time: '2026-10-12T10:30:00Z',
    deadline: '2026-10-12T12:00:00Z',
    duration_minutes: 90,
    recurrence: null,
    canonical_tags: ['sync', 'safety'],
    metadata: {},
    created_at: '2026-10-12T08:00:00Z',
    updated_at: '2026-10-12T10:30:00Z',
  };

  const task2Entity: Entity = {
    id: 'task-cal-consequences-2',
    kind: EntityKind.TASK,
    title: 'Build Calendar Consequence Projection Engine',
    description: 'Aggregate upcoming commitments and scheduled work blocks.',
    status: EntityStatus.ACTIVE,
    priority: 2,
    start_time: '2026-10-13T14:00:00Z',
    end_time: '2026-10-13T16:00:00Z',
    deadline: '2026-10-14T18:00:00Z',
    duration_minutes: 120,
    recurrence: null,
    canonical_tags: ['calendar', 'architecture'],
    metadata: {},
    created_at: '2026-10-12T08:00:00Z',
    updated_at: '2026-10-12T08:00:00Z',
  };

  const eventEntity: Entity = {
    id: 'evt-sprint-review-1',
    kind: EntityKind.EVENT,
    title: 'Sprint Architecture Review',
    description: 'Walk through goal milestones and calendar consequences.',
    status: EntityStatus.ACTIVE,
    priority: 1,
    start_time: '2026-10-16T15:00:00Z',
    end_time: '2026-10-16T16:00:00Z',
    deadline: null,
    duration_minutes: 60,
    recurrence: null,
    canonical_tags: ['review'],
    metadata: {
      goal_id: 'goal-quantum-1',
    },
    created_at: '2026-10-12T08:00:00Z',
    updated_at: '2026-10-12T08:00:00Z',
  };

  const memoryDecisionEntity: KernelEntity = {
    id: 'mem-decision-zero-any',
    schema_id: 'system/memory_item',
    version: 1,
    title: 'Zero Any Invariant Decision',
    attributes: {
      category: 'routine',
      content: 'Maintain strict zero-any boundary across all Flowmate kernel schemas and components.',
      source_type: 'user_explicit',
      speaker: 'user',
      confidence: 1.0,
      status: 'active',
      epistemic_status: 'user_decision',
      privacy_tier: 'private',
      valid_from: '2026-10-01T00:00:00Z',
      associated_entity_ids: ['goal-quantum-1'],
      tags: ['architecture', 'standards'],
    },
    lifecycle: {
      status: 'active',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      deleted_at: null,
    },
    provenance: {
      source_type: 'user',
      observed_at: '2026-10-01T00:00:00Z',
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
  };

  beforeEach(() => {
    useStore.setState({
      selectedEntityId: null,
      kernelEntities: {
        'mem-decision-zero-any': memoryDecisionEntity,
      },
      entities: [goalEntity, task1Entity, task2Entity, eventEntity],
      relationships: [
        {
          id: 'rel-f1',
          from: task1Entity.id,
          to: goalEntity.id,
          type: RelationshipType.FULFILLS,
          meta: {},
          created_at: '2026-10-12T08:00:00Z',
        },
        {
          id: 'rel-f2',
          from: task2Entity.id,
          to: goalEntity.id,
          type: RelationshipType.FULFILLS,
          meta: {},
          created_at: '2026-10-12T08:00:00Z',
        },
      ],
      universalTags: [],
    });
  });

  it('navigates from GoalProgressChart circular progress cards to Goal detail panel', () => {
    render(<GoalProgressChart entities={[goalEntity]} />);

    expect(screen.getByTestId('goal-progress-chart-card')).toBeInTheDocument();
    expect(screen.getByText('Goal Progress')).toBeInTheDocument();

    const goalRing = screen.getByTestId(`goal-circle-${goalEntity.id}`);
    expect(goalRing).toBeInTheDocument();
    expect(goalRing).toHaveAttribute('role', 'button');

    // Click circular progress item
    fireEvent.click(goalRing);

    // Verifies selectedEntityId updated to goal
    expect(useStore.getState().selectedEntityId).toBe(goalEntity.id);
  });

  it('renders unified Dependent Workstream and allows 1-click navigation and inline task creation', () => {
    useStore.setState({ selectedEntityId: goalEntity.id });
    render(<EntityDetailPanel />);

    const workstreamCard = screen.getByTestId('dependent-workstream-card');
    expect(workstreamCard).toBeInTheDocument();
    expect(screen.getByText(/Dependent Workstream \(2\)/)).toBeInTheDocument();

    // Verify fulfilling tasks are rendered
    expect(within(workstreamCard).getByText('Implement Multi-Tab Tombstone Supremacy')).toBeInTheDocument();
    expect(within(workstreamCard).getByText('Build Calendar Consequence Projection Engine')).toBeInTheDocument();

    // Click a fulfilling task to navigate
    const taskItem = within(workstreamCard).getByText('Build Calendar Consequence Projection Engine');
    fireEvent.click(taskItem);
    expect(useStore.getState().selectedEntityId).toBe(task2Entity.id);

    // Switch back to goal to test adding a task
    useStore.setState({ selectedEntityId: goalEntity.id });
    cleanup();
    render(<EntityDetailPanel />);

    // Open inline add task form
    const addTaskBtn = screen.getByLabelText(/Add fulfilling task/i);
    fireEvent.click(addTaskBtn);

    const taskInput = screen.getByPlaceholderText(/New fulfilling task title\.\.\./i);
    fireEvent.change(taskInput, { target: { value: 'Author E2E Workflow Verification Test' } });

    const createBtn = screen.getByText(/Create & Link/i);
    fireEvent.click(createBtn);

    // Verify task created and linked to goal in reactive store
    const updatedEntities = useStore.getState().entities;
    const newTask = updatedEntities.find(e => e.title === 'Author E2E Workflow Verification Test');
    expect(newTask).toBeTruthy();
    expect(newTask?.kind).toBe(EntityKind.TASK);

    const updatedRels = useStore.getState().relationships;
    const linkRel = updatedRels.find(r => r.from === newTask?.id && r.to === goalEntity.id);
    expect(linkRel).toBeTruthy();
    expect(linkRel?.type).toBe(RelationshipType.FULFILLS);
  });

  it('aggregates Calendar Consequences, displays scheduled sessions, and supports 1-click work session scheduling', () => {
    useStore.setState({ selectedEntityId: goalEntity.id });
    render(<EntityDetailPanel />);

    const calCard = screen.getByTestId('calendar-consequences-card');
    expect(calCard).toBeInTheDocument();
    expect(screen.getByText(/Calendar Consequences/)).toBeInTheDocument();

    // Verify sessions appear in calendar consequences
    expect(within(calCard).getAllByText(/Sprint Architecture Review/).length).toBeGreaterThan(0);

    // Click 1-click Schedule Work Session button
    const scheduleBtn = screen.getByLabelText(/Schedule work session/i);
    fireEvent.click(scheduleBtn);

    // Verify event created and linked to goal
    const updatedEntities = useStore.getState().entities;
    const scheduledEvent = updatedEntities.find(e => e.title.includes('Work Session: Deliver Flowmate Knowledge Graph v4'));
    expect(scheduledEvent).toBeTruthy();
    expect(scheduledEvent?.kind).toBe(EntityKind.EVENT);
    expect(scheduledEvent?.duration_minutes).toBe(60);

    const updatedRels = useStore.getState().relationships;
    const scheduleLink = updatedRels.find(r => r.from === scheduledEvent?.id && r.to === goalEntity.id);
    expect(scheduleLink).toBeTruthy();
    expect(scheduleLink?.type).toBe(RelationshipType.FULFILLS);
  });

  it('renders Contextual Notes & Decisions and supports round-trip navigation between Goal and Memory item', () => {
    useStore.setState({ selectedEntityId: goalEntity.id });
    render(<EntityDetailPanel />);

    const notesCard = screen.getByTestId('contextual-notes-card');
    expect(notesCard).toBeInTheDocument();
    expect(screen.getByText(/Contextual Notes & Decisions \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/User Decision/)).toBeInTheDocument();
    expect(screen.getByText(/Zero Any Invariant Decision/)).toBeInTheDocument();

    // Click note to inspect
    const noteCard = screen.getByTestId('contextual-note-item-mem-decision-zero-any');
    fireEvent.click(noteCard);

    // State updates to memory entity
    expect(useStore.getState().selectedEntityId).toBe('mem-decision-zero-any');

    // Re-render EntityDetailPanel for the memory entity
    cleanup();
    render(<EntityDetailPanel />);

    // MemoryDetailView should now be displayed
    expect(screen.getByText(/Belief & Decision Inspector/i)).toBeInTheDocument();
    expect(screen.getByText(/Maintain strict zero-any boundary across all Flowmate/i)).toBeInTheDocument();

    // Associated Workstream card should display the link back to Goal
    const associatedCard = screen.getByTestId('memory-associated-workstream-card');
    expect(associatedCard).toBeInTheDocument();
    expect(screen.getByText(/Associated Goals & Entities \(1\)/)).toBeInTheDocument();

    const returnGoalBtn = screen.getByTestId(`memory-associated-entity-${goalEntity.id}`);
    expect(returnGoalBtn).toBeInTheDocument();
    expect(returnGoalBtn).toHaveTextContent(/Deliver Flowmate Knowledge Graph v4/);

    // 1-Click return back to Goal!
    fireEvent.click(returnGoalBtn);
    expect(useStore.getState().selectedEntityId).toBe(goalEntity.id);
  });
});

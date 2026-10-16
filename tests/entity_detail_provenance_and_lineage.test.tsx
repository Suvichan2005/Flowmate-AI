import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import EntityDetailPanel from '../components/EntityDetailPanel';
import { useStore } from '../store';
import { EntityKind, EntityStatus, RelationshipType, type Entity } from '../types';
import type { Entity as KernelEntity } from '../services/kernel/types';

describe('EntityDetailPanel Provenance and Lineage (Workflows 3 & 4)', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useStore.setState({
      selectedEntityId: null,
      kernelEntities: {},
      entities: [],
      relationships: [],
      universalTags: []
    });
  });

  it('renders provenance trust indicators, version, and temporal validity from canonical kernel entity', () => {
    const taskId = 'task-prov-1';
    const kernelEntity: KernelEntity = {
      id: taskId,
      schema_id: 'system/task',
      version: 3,
      title: 'Prepare executive briefing',
      attributes: {
        kind: 'TASK',
        priority: 2
      },
      lifecycle: {
        status: 'ACTIVE',
        created_at: '2026-10-12T01:00:00Z',
        updated_at: '2026-10-12T02:00:00Z',
        deleted_at: null
      },
      provenance: {
        source_type: 'agent',
        observed_at: '2026-10-12T01:00:00Z',
        confidence: 0.95,
        is_inferred: true,
        user_confirmed: false
      },
      validity: {
        valid_from: '2026-10-12T08:00:00Z',
        valid_until: '2026-10-12T18:00:00Z'
      }
    };

    const legacyEntity: Entity = {
      id: taskId,
      kind: EntityKind.TASK,
      title: 'Prepare executive briefing',
      description: 'Prepare slide deck for quarterly review',
      status: EntityStatus.ACTIVE,
      priority: 2,
      start_time: '2026-10-12T08:00:00Z',
      end_time: '2026-10-12T18:00:00Z',
      deadline: null,
      duration_minutes: 60,
      recurrence: null,
      canonical_tags: ['briefing'],
      metadata: {},
      created_at: '2026-10-12T01:00:00Z',
      updated_at: '2026-10-12T02:00:00Z'
    };

    useStore.setState({
      selectedEntityId: taskId,
      kernelEntities: { [taskId]: kernelEntity },
      entities: [legacyEntity]
    });

    render(<EntityDetailPanel />);

    // Provenance verification
    expect(screen.getByText('Provenance & Trust')).toBeInTheDocument();
    expect(screen.getByText('Rev v3')).toBeInTheDocument();
    expect(screen.getByText(/Inferred \(95%\)/)).toBeInTheDocument();
    expect(screen.getByText('agent')).toBeInTheDocument();
    expect(screen.getByText('Temporal Validity')).toBeInTheDocument();
  });

  it('renders Goal Alignment card when task fulfills a goal and allows one-click navigation', () => {
    const goalId = 'goal-Atlas-1';
    const taskId = 'task-dsa-1';

    const goalEntity: Entity = {
      id: goalId,
      kind: EntityKind.GOAL,
      title: 'Project Atlas',
      description: 'Ace technical assessments',
      status: EntityStatus.ACTIVE,
      priority: 1,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      canonical_tags: ['career'],
      metadata: {},
      created_at: '2026-10-10T10:00:00Z',
      updated_at: '2026-10-10T10:00:00Z'
    };

    const taskEntity: Entity = {
      id: taskId,
      kind: EntityKind.TASK,
      title: 'Practice high-frequency DSA questions',
      description: 'LeetCode top 100',
      status: EntityStatus.ACTIVE,
      priority: 2,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      canonical_tags: ['prep'],
      metadata: {},
      created_at: '2026-10-12T01:00:00Z',
      updated_at: '2026-10-12T01:00:00Z'
    };

    const fulfillsRelationship = {
      id: 'rel-fulfills-1',
      from: taskId,
      to: goalId,
      type: RelationshipType.FULFILLS,
      meta: {},
      created_at: '2026-10-12T01:00:00Z'
    };

    useStore.setState({
      selectedEntityId: taskId,
      entities: [goalEntity, taskEntity],
      relationships: [fulfillsRelationship]
    });

    render(<EntityDetailPanel />);

    expect(screen.getByText('Fulfills Goal')).toBeInTheDocument();
    const goalButton = screen.getByText('Project Atlas');
    expect(goalButton).toBeInTheDocument();

    // Click to navigate to Goal
    fireEvent.click(goalButton);
    expect(useStore.getState().selectedEntityId).toBe(goalId);
  });

  it('renders Dependent Workstream when inspecting a Goal with child fulfilling tasks', () => {
    const goalId = 'goal-career-1';
    const taskId1 = 'task-resume-1';
    const taskId2 = 'task-portfolio-1';

    const goalEntity: Entity = {
      id: goalId,
      kind: EntityKind.GOAL,
      title: 'Land Senior Engineer Offer',
      description: 'Career milestone for 2026',
      status: EntityStatus.ACTIVE,
      priority: 1,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      canonical_tags: ['career'],
      metadata: {},
      created_at: '2026-10-10T10:00:00Z',
      updated_at: '2026-10-10T10:00:00Z'
    };

    const task1: Entity = {
      id: taskId1,
      kind: EntityKind.TASK,
      title: 'Update CV with Flowmate kernel architecture',
      description: null,
      status: EntityStatus.COMPLETED,
      priority: 2,
      start_time: null,
      end_time: null,
      deadline: null,
      duration_minutes: null,
      recurrence: null,
      canonical_tags: [],
      metadata: {},
      created_at: '2026-10-11T10:00:00Z',
      updated_at: '2026-10-11T10:00:00Z'
    };

    const task2: Entity = {
      id: taskId2,
      kind: EntityKind.TASK,
      title: 'Deploy interactive Experience Lab demo',
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
      created_at: '2026-10-11T11:00:00Z',
      updated_at: '2026-10-11T11:00:00Z'
    };

    const rels = [
      { id: 'rel-f1', from: taskId1, to: goalId, type: RelationshipType.FULFILLS, meta: {}, created_at: '2026-10-11T10:00:00Z' },
      { id: 'rel-f2', from: taskId2, to: goalId, type: RelationshipType.FULFILLS, meta: {}, created_at: '2026-10-11T11:00:00Z' }
    ];

    useStore.setState({
      selectedEntityId: goalId,
      entities: [goalEntity, task1, task2],
      relationships: rels
    });

    render(<EntityDetailPanel />);

    expect(screen.getByText(/Dependent Workstream \(2\)/)).toBeInTheDocument();
    expect(screen.getByText('Update CV with Flowmate kernel architecture')).toBeInTheDocument();
    expect(screen.getByText('Deploy interactive Experience Lab demo')).toBeInTheDocument();

    // Click dependent task to inspect
    fireEvent.click(screen.getByText('Deploy interactive Experience Lab demo'));
    expect(useStore.getState().selectedEntityId).toBe(taskId2);
  });

  it('renders Dependency Gate when an entity is blocked by another task and enables direct navigation', () => {
    const taskAId = 'task-frontend-1';
    const taskBId = 'task-backend-1';

    const taskA: Entity = {
      id: taskAId,
      kind: EntityKind.TASK,
      title: 'Implement UI components',
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
      created_at: '2026-10-12T01:00:00Z',
      updated_at: '2026-10-12T01:00:00Z'
    };

    const taskB: Entity = {
      id: taskBId,
      kind: EntityKind.TASK,
      title: 'Finalize GraphQL schema',
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
      created_at: '2026-10-12T00:00:00Z',
      updated_at: '2026-10-12T00:00:00Z'
    };

    const dependsRel = {
      id: 'rel-dep-1',
      from: taskAId,
      to: taskBId,
      type: RelationshipType.DEPENDS_ON,
      meta: {},
      created_at: '2026-10-12T01:00:00Z'
    };

    useStore.setState({
      selectedEntityId: taskAId,
      entities: [taskA, taskB],
      relationships: [dependsRel]
    });

    render(<EntityDetailPanel />);

    expect(screen.getByText(/Blocked By \(1\)/)).toBeInTheDocument();
    const blockerButton = screen.getByText('Finalize GraphQL schema');
    expect(blockerButton).toBeInTheDocument();

    fireEvent.click(blockerButton);
    expect(useStore.getState().selectedEntityId).toBe(taskBId);
  });
});

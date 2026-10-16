import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import InterruptedDayRecovery from '../components/InterruptedDayRecovery';
import { useStore } from '../store';
import { EntityKind, EntityStatus, Entity, ToonOperation } from '../types';

describe('InterruptedDayRecovery (Reference Workflow 2 & Ergonomics)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    useStore.setState({
      entities: [],
      kernelEntities: {},
      relationships: [],
      universalTags: []
    });
  });

  it('renders calm "Horizon in Flow" when zero overdue items or missed events exist', () => {
    render(<InterruptedDayRecovery />);

    expect(screen.getByRole('region', { name: /interrupted day recovery status/i })).toBeDefined();
    expect(screen.getByText(/Horizon in Flow/i)).toBeDefined();
    expect(screen.getByText(/Zero overdue tasks or missed events/i)).toBeDefined();
  });

  it('detects overdue tasks and unconfirmed past events, rendering recovery banner with triage count', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    const overdueTask: any = {
      id: 'task-overdue-1',
      title: 'Submit Q3 Tax Filings',
      kind: EntityKind.TASK,
      status: EntityStatus.ACTIVE,
      priority: 1,
      deadline: yesterday,
      created_at: yesterday,
      updated_at: yesterday,
      canonical_tags: ['finance']
    };

    const pastEvent: any = {
      id: 'event-missed-1',
      title: 'Strategy Sync with Board',
      kind: EntityKind.EVENT,
      status: EntityStatus.ACTIVE,
      start_time: twoHoursAgo,
      end_time: oneHourAgo,
      created_at: twoHoursAgo,
      updated_at: twoHoursAgo,
      canonical_tags: ['leadership']
    };

    useStore.setState({
      entities: [overdueTask, pastEvent]
    });

    render(<InterruptedDayRecovery />);

    const panel = screen.getByTestId('interrupted-day-recovery');
    expect(panel).toBeDefined();
    expect(screen.getByText(/2 Items Need Triage/i)).toBeDefined();
    expect(screen.getByText(/Submit Q3 Tax Filings/i)).toBeDefined();
    expect(screen.getByText(/Strategy Sync with Board/i)).toBeDefined();
  });

  it('executes 1-click batch reschedule of all overdue tasks to today at 18:00', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const appliedOps: ToonOperation[][] = [];

    const overdueTask1: any = {
      id: 'task-1',
      title: 'Review Engineering Architecture Proposal',
      kind: EntityKind.TASK,
      status: EntityStatus.ACTIVE,
      deadline: yesterday,
      created_at: yesterday,
      updated_at: yesterday,
      canonical_tags: []
    };

    const overdueTask2: any = {
      id: 'task-2',
      title: 'Draft Client Retainer Contract',
      kind: EntityKind.TASK,
      status: EntityStatus.ACTIVE,
      deadline: yesterday,
      created_at: yesterday,
      updated_at: yesterday,
      canonical_tags: []
    };

    useStore.setState({
      entities: [overdueTask1, overdueTask2],
      applyOperations: (ops: ToonOperation[]) => {
        appliedOps.push(ops);
      }
    });

    render(<InterruptedDayRecovery />);

    const batchRescheduleBtn = screen.getByRole('button', { name: /reschedule all overdue tasks to today at 18:00/i });
    fireEvent.click(batchRescheduleBtn);

    expect(appliedOps.length).toBe(1);
    expect(appliedOps[0].length).toBe(2);
    expect(appliedOps[0][0].type).toBe('update_entity');
    expect(appliedOps[0][0].payload.id).toBe('task-1');
    expect(new Date(appliedOps[0][0].payload.fields.deadline).getHours()).toBe(18);
    expect(appliedOps[0][1].payload.id).toBe('task-2');
    expect(new Date(appliedOps[0][1].payload.fields.deadline).getHours()).toBe(18);
  });

  it('executes 1-click batch defer of all overdue tasks to tomorrow at 10:00', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const appliedOps: ToonOperation[][] = [];

    const overdueTask: any = {
      id: 'task-defer-1',
      title: 'Audit Multi-Tab Cache',
      kind: EntityKind.TASK,
      status: EntityStatus.ACTIVE,
      deadline: yesterday,
      created_at: yesterday,
      updated_at: yesterday,
      canonical_tags: []
    };

    useStore.setState({
      entities: [overdueTask],
      applyOperations: (ops: ToonOperation[]) => {
        appliedOps.push(ops);
      }
    });

    render(<InterruptedDayRecovery />);

    const batchDeferBtn = screen.getByRole('button', { name: /defer all overdue tasks to tomorrow at 10:00/i });
    fireEvent.click(batchDeferBtn);

    expect(appliedOps.length).toBe(1);
    expect(appliedOps[0][0].type).toBe('update_entity');
    expect(appliedOps[0][0].payload.id).toBe('task-defer-1');
    expect(new Date(appliedOps[0][0].payload.fields.deadline).getHours()).toBe(10);
  });

  it('allows 1-click individual task completion, individual rescheduling, and dismissing', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const appliedOps: ToonOperation[][] = [];

    const task: any = {
      id: 'task-solo-1',
      title: 'Confirm AWS Quota Upgrade',
      kind: EntityKind.TASK,
      status: EntityStatus.ACTIVE,
      deadline: yesterday,
      created_at: yesterday,
      updated_at: yesterday,
      canonical_tags: []
    };

    useStore.setState({
      entities: [task],
      applyOperations: (ops: ToonOperation[]) => {
        appliedOps.push(ops);
      }
    });

    render(<InterruptedDayRecovery />);

    // Click individual "Done"
    const doneBtn = screen.getByRole('button', { name: /mark confirm aws quota upgrade as completed/i });
    fireEvent.click(doneBtn);

    expect(appliedOps.length).toBe(1);
    expect(appliedOps[0][0].type).toBe('update_entity');
    expect(appliedOps[0][0].payload.id).toBe('task-solo-1');
    expect(appliedOps[0][0].payload.fields.status).toBe(EntityStatus.COMPLETED);

    // Click individual "Archive / Dismiss"
    const dismissBtn = screen.getByRole('button', { name: /archive confirm aws quota upgrade/i });
    fireEvent.click(dismissBtn);

    expect(appliedOps.length).toBe(2);
    expect(appliedOps[1][0].type).toBe('update_entity');
    expect(appliedOps[1][0].payload.fields.status).toBe(EntityStatus.ARCHIVED);
  });

  it('allows 1-click batch confirmation and inline confirmation of unconfirmed past events', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const appliedOps: ToonOperation[][] = [];

    const pastEvent: any = {
      id: 'event-confirm-1',
      title: 'Service provider Medical Checkup',
      kind: EntityKind.EVENT,
      status: EntityStatus.ACTIVE,
      start_time: twoHoursAgo,
      end_time: oneHourAgo,
      created_at: twoHoursAgo,
      updated_at: twoHoursAgo,
      canonical_tags: []
    };

    useStore.setState({
      entities: [pastEvent],
      applyOperations: (ops: ToonOperation[]) => {
        appliedOps.push(ops);
      }
    });

    render(<InterruptedDayRecovery />);

    // Batch confirm
    const batchConfirmBtn = screen.getByRole('button', { name: /confirm all past events as done/i });
    fireEvent.click(batchConfirmBtn);

    expect(appliedOps.length).toBe(1);
    expect(appliedOps[0][0].type).toBe('update_entity');
    expect(appliedOps[0][0].payload.id).toBe('event-confirm-1');
    expect(appliedOps[0][0].payload.fields.metadata.confirmation_status).toBe('confirmed');

    // Inline "Skipped" button
    const skippedBtn = screen.getByRole('button', { name: /skipped/i });
    fireEvent.click(skippedBtn);

    expect(appliedOps.length).toBe(2);
    expect(appliedOps[1][0].payload.fields.metadata.confirmation_status).toBe('skipped');
  });
});

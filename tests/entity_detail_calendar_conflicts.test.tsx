import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import EntityDetailPanel from '../components/EntityDetailPanel';
import { useStore } from '../store';
import { EntityKind, EntityStatus } from '../types';

describe('EntityDetailPanel - Calendar Conflict Grounding & Rescheduling (Priority A)', () => {
  beforeEach(() => {
    cleanup();
    useStore.setState({
      selectedEntityId: null,
      entities: [],
      relationships: [],
      pendingOps: null,
      toasts: []
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders schedule collision card and alternative slot recommendation for clashing events', () => {
    const eventA = {
      id: 'event-Atlas-loop',
      title: 'Atlas project review',
      kind: EntityKind.EVENT,
      status: EntityStatus.ACTIVE,
      start_time: '2026-10-14T14:00:00.000Z',
      end_time: '2026-10-14T15:00:00.000Z',
      duration_minutes: 60,
      metadata: {
        source: 'Google Calendar',
        synced_at: '2026-10-14T13:50:00.000Z'
      }
    };

    const eventB = {
      id: 'event-dr-service-provider',
      title: 'Service contact Service follow-up Consultation',
      kind: EntityKind.EVENT,
      status: EntityStatus.ACTIVE,
      start_time: '2026-10-14T14:30:00.000Z',
      end_time: '2026-10-14T15:30:00.000Z',
      duration_minutes: 60,
      metadata: {
        source: 'local_plan'
      }
    };

    useStore.setState({
      selectedEntityId: 'event-dr-service-provider',
      entities: [eventA as any, eventB as any]
    });

    render(<EntityDetailPanel />);

    // Verify collision card appears
    const conflictCard = screen.getByTestId('schedule-conflict-card');
    expect(conflictCard).toBeDefined();
    expect(screen.getByText(/Schedule Collision Detected \(1\)/i)).toBeDefined();

    // Verify colliding event details
    expect(screen.getByText('Atlas project review')).toBeDefined();
    expect(screen.getByText(/30m overlap/i)).toBeDefined();
    expect(screen.getByText(/Google Calendar/i)).toBeDefined();

    // Verify alternative slot recommendation
    const altCard = screen.getByTestId('alternative-slot-card');
    expect(altCard).toBeDefined();
    expect(screen.getByText(/Earliest Conflict-Free Window:/i)).toBeDefined();

    // Verify stage reschedule button exists
    const stageBtn = screen.getByTestId('stage-reschedule-btn');
    expect(stageBtn).toBeDefined();

    // Click Stage Reschedule
    fireEvent.click(stageBtn);

    // Verify two-phase pendingOps were staged
    const pendingOps = useStore.getState().pendingOps;
    expect(pendingOps).toBeDefined();
    expect(pendingOps?.ops.length).toBe(1);
    expect(pendingOps?.ops[0].type).toBe('update_entity');
    expect(pendingOps?.ops[0].payload?.id).toBe('event-dr-service-provider');
    expect(pendingOps?.originalMessageId).toBe('reschedule-event-dr-service-provider');
  });

  it('renders conflict-free badge when event has zero overlaps', () => {
    const clearEvent = {
      id: 'event-gym-session',
      title: 'Morning Gym Session',
      kind: EntityKind.EVENT,
      status: EntityStatus.ACTIVE,
      start_time: '2026-10-14T07:00:00.000Z',
      end_time: '2026-10-14T08:00:00.000Z',
      duration_minutes: 60
    };

    useStore.setState({
      selectedEntityId: 'event-gym-session',
      entities: [clearEvent as any]
    });

    render(<EntityDetailPanel />);

    expect(screen.getByTestId('schedule-conflict-free')).toBeDefined();
    expect(screen.getByText(/Conflict-Free Schedule/i)).toBeDefined();
    expect(screen.queryByTestId('schedule-conflict-card')).toBeNull();
  });

  it('supports 1-click navigation to the colliding event', () => {
    const eventA = {
      id: 'event-1',
      title: 'Design Review',
      kind: EntityKind.EVENT,
      status: EntityStatus.ACTIVE,
      start_time: '2026-10-14T10:00:00.000Z',
      end_time: '2026-10-14T11:00:00.000Z',
      duration_minutes: 60
    };

    const eventB = {
      id: 'event-2',
      title: 'Sync with Team',
      kind: EntityKind.EVENT,
      status: EntityStatus.ACTIVE,
      start_time: '2026-10-14T10:30:00.000Z',
      end_time: '2026-10-14T11:30:00.000Z',
      duration_minutes: 60
    };

    useStore.setState({
      selectedEntityId: 'event-1',
      entities: [eventA as any, eventB as any]
    });

    render(<EntityDetailPanel />);

    const collidingItem = screen.getByTestId('colliding-event-event-2');
    fireEvent.click(collidingItem);

    // Selected entity switches to event-2
    expect(useStore.getState().selectedEntityId).toBe('event-2');
  });
});

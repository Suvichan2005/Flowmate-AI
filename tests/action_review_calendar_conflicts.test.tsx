import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OpsPreviewForm from '../components/OpsPreviewForm';
import { useStore } from '../store';
import { Entity, EntityKind, ToonOperation } from '../types';

describe('OpsPreviewForm Calendar Conflict Grounding & Rescheduling', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useStore.setState({
      kernelEntities: {},
      entities: [
        {
          id: 'existing-event-1',
          kind: EntityKind.EVENT,
          title: 'Existing Board Meeting',
          start_time: '2026-10-15T15:00:00.000Z',
          end_time: '2026-10-15T16:00:00.000Z',
          metadata: { source: 'Local Graph' }
        } as unknown as Entity
      ],
      relationships: [],
      currentUser: null
    });
  });

  it('detects and displays schedule conflict when proposed event overlaps existing event', () => {
    const ops: ToonOperation[] = [
      {
        type: 'create_entity',
        payload: {
          kind: 'EVENT',
          title: 'Proposed Team Sync',
          start_time: '2026-10-15T15:30:00.000Z',
          end_time: '2026-10-15T16:30:00.000Z'
        }
      }
    ];

    render(<OpsPreviewForm ops={ops} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByTestId('review-calendar-conflict')).toBeInTheDocument();
    expect(screen.getByText(/Schedule Conflict Detected/i)).toBeInTheDocument();
    expect(screen.getByText('Existing Board Meeting')).toBeInTheDocument();
    expect(screen.getByText('30m overlap')).toBeInTheDocument();
  });

  it('shifts to free slot on clicking alternative suggestion, dynamically clearing conflict', () => {
    const ops: ToonOperation[] = [
      {
        type: 'create_entity',
        payload: {
          kind: 'EVENT',
          title: 'Proposed Team Sync',
          start_time: '2026-10-15T15:30:00.000Z',
          end_time: '2026-10-15T16:30:00.000Z'
        }
      }
    ];

    render(<OpsPreviewForm ops={ops} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const shiftButton = screen.getByTestId('shift-to-alternative-slot');
    expect(shiftButton).toBeInTheDocument();

    fireEvent.click(shiftButton);

    // Conflict alert should disappear and clear slot badge appears
    expect(screen.queryByTestId('review-calendar-conflict')).not.toBeInTheDocument();
    expect(screen.getByTestId('review-slot-clear')).toBeInTheDocument();
    expect(screen.getByText(/Time slot is clear/i)).toBeInTheDocument();
  });

  it('detects invalid reversed time intervals with clear validation error', () => {
    const ops: ToonOperation[] = [
      {
        type: 'create_entity',
        payload: {
          kind: 'EVENT',
          title: 'Proposed Event Reversed',
          start_time: '2026-10-15T17:00:00.000Z',
          end_time: '2026-10-15T16:00:00.000Z' // end before start
        }
      }
    ];

    render(<OpsPreviewForm ops={ops} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByTestId('review-invalid-interval')).toBeInTheDocument();
    expect(screen.getByText(/Invalid Time Interval/i)).toBeInTheDocument();
  });

  it('shows clear slot badge when proposed event has no collisions', () => {
    const ops: ToonOperation[] = [
      {
        type: 'create_entity',
        payload: {
          kind: 'EVENT',
          title: 'Morning Strategy',
          start_time: '2026-10-15T10:00:00.000Z',
          end_time: '2026-10-15T11:00:00.000Z'
        }
      }
    ];

    render(<OpsPreviewForm ops={ops} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByTestId('review-slot-clear')).toBeInTheDocument();
    expect(screen.getByText(/Time slot is clear/i)).toBeInTheDocument();
  });
});

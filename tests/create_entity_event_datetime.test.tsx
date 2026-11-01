/**
 * Tests for Flowmate Event Date Ranges & RRULE Support in CreateEntityModal
 * STRICT INVARIANT: ZERO `any`
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreateEntityModal from '../components/CreateEntityModal';
import { useStore } from '../store';
import { EntityKind, ToonOperation } from '../types';

describe('CreateEntityModal Event Ranges & RRULE', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders start and end time inputs for EVENT entities and computes custom duration', () => {
    const applyOperationsMock = vi.fn();
    useStore.setState({
      entities: [],
      applyOperations: applyOperationsMock,
    });

    const onClose = vi.fn();
    render(
      <CreateEntityModal
        onClose={onClose}
        initialKind={EntityKind.EVENT}
        initialDate="2026-11-05T10:00:00.000Z"
      />
    );

    // Title input
    const titleInput = screen.getByLabelText('Title');
    fireEvent.change(titleInput, { target: { value: 'Product Architecture Review' } });

    // Verify Start and End inputs are rendered
    const startDateInput = screen.getByLabelText('Date');
    const endDateInput = screen.getByLabelText('End Date');
    expect(startDateInput).toBeInTheDocument();
    expect(endDateInput).toBeInTheDocument();

    // Set custom 3-hour window
    fireEvent.change(startDateInput, { target: { value: '2026-11-05T14:00' } });
    fireEvent.change(endDateInput, { target: { value: '2026-11-05T17:00' } });

    // Submit form
    const createBtn = screen.getByRole('button', { name: /create/i });
    fireEvent.click(createBtn);

    expect(applyOperationsMock).toHaveBeenCalled();
    const ops = applyOperationsMock.mock.calls[0][0] as ToonOperation[];
    expect(ops.length).toBeGreaterThan(0);
    const payload = ops[0].payload as unknown as {
      title: string;
      kind: EntityKind;
      start_time: string;
      end_time: string;
      duration_minutes: number;
    };

    expect(payload.title).toBe('Product Architecture Review');
    expect(payload.kind).toBe(EntityKind.EVENT);
    expect(payload.duration_minutes).toBe(180);
    expect(new Date(payload.end_time).getTime() - new Date(payload.start_time).getTime()).toBe(180 * 60 * 1000);
  });

  it('supports custom RRULE recurrence patterns', () => {
    const applyOperationsMock = vi.fn();
    useStore.setState({
      entities: [],
      applyOperations: applyOperationsMock,
    });

    const onClose = vi.fn();
    render(
      <CreateEntityModal
        onClose={onClose}
        initialKind={EntityKind.EVENT}
        initialDate="2026-11-05T09:00:00.000Z"
      />
    );

    const titleInput = screen.getByLabelText('Title');
    fireEvent.change(titleInput, { target: { value: 'Weekly Engineering Sync' } });

    // Select Custom (RRULE)
    const recurrenceSelect = screen.getByRole('combobox');
    fireEvent.change(recurrenceSelect, { target: { value: 'CUSTOM' } });

    // Verify RRULE input appears
    const rruleInput = screen.getByLabelText('Custom RRULE');
    expect(rruleInput).toBeInTheDocument();

    // Click 'Mon/Wed/Fri' preset button
    const mwfPreset = screen.getByRole('button', { name: 'Mon/Wed/Fri' });
    fireEvent.click(mwfPreset);
    expect((rruleInput as HTMLInputElement).value).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');

    // Submit form
    const createBtn = screen.getByRole('button', { name: /create/i });
    fireEvent.click(createBtn);

    expect(applyOperationsMock).toHaveBeenCalled();
    const ops = applyOperationsMock.mock.calls[0][0] as ToonOperation[];
    const payload = ops[0].payload as unknown as {
      metadata?: { rrule?: string };
      recurrence: string;
    };

    expect(payload.metadata?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(payload.recurrence).toBe('WEEKLY');
  });
});

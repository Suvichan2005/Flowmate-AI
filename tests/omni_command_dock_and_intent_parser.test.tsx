import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CommandPalette from '../components/CommandPalette';
import { useStore } from '../store';
import { EntityKind, EntityStatus, Entity, ToonOperation } from '../types';
import { inferIntentFromQuery, pseudoSha256 } from '../utils/intentParser';

describe('Omni-Command Dock & Intent Parser (Workflow 1 & 7)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    useStore.setState({
      entities: [],
      kernelEntities: {},
      pendingOps: null,
      selectedEntityId: null
    });
  });

  describe('intentParser unit verification', () => {
    it('accurately parses event intentions with time slot, duration, and creates create_entity operation', () => {
      const query = 'Team sync tomorrow at 14:00 for 45m';
      const intent = inferIntentFromQuery(query);

      expect(intent).not.toBeNull();
      expect(intent?.kind).toBe('EVENT');
      expect(intent?.title).toContain('Team sync');
      expect(intent?.durationMinutes).toBe(45);
      expect(intent?.timeSlot).toContain('Tomorrow, 14:00');
      expect(intent?.operations.length).toBe(1);
      expect(intent?.operations[0].type).toBe('create_entity');
      expect(intent?.operations[0].payload.kind).toBe('EVENT');
      expect(intent?.operations[0].payload.duration_minutes).toBe(45);
      expect(intent?.sha256Fingerprint).toMatch(/^sha256:[0-9a-f]{32}$/);
    });

    it('accurately parses high-priority task intentions with deadline and creates task operation', () => {
      const query = 'Prepare STAR stories for Atlas recruitment priority 1';
      const intent = inferIntentFromQuery(query);

      expect(intent).not.toBeNull();
      expect(intent?.kind).toBe('TASK');
      expect(intent?.title).toContain('Prepare STAR stories');
      expect(intent?.priority).toBe(1);
      expect(intent?.priorityLabel).toBe('P1 / Critical');
      expect(intent?.operations.length).toBe(1);
      expect(intent?.operations[0].type).toBe('create_entity');
      expect(intent?.operations[0].payload.kind).toBe('TASK');
      expect(intent?.operations[0].payload.priority).toBe(1);
    });

    it('accurately parses reschedule intentions', () => {
      const query = 'Reschedule Atlas interview at 17:30';
      const intent = inferIntentFromQuery(query);

      expect(intent).not.toBeNull();
      expect(intent?.kind).toBe('RESCHEDULE');
      expect(intent?.title).toContain('Atlas interview');
      expect(intent?.operations[0].type).toBe('update_entity');
    });
  });

  describe('CommandPalette component integration', () => {
    it('does not reserve space for a redundant bottom command dock', () => {
      render(<CommandPalette onSendToChat={() => {}} />);

      expect(screen.queryByTestId('omni-command-dock')).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens palette modal on dock click or Cmd+K shortcut', () => {
      render(<CommandPalette onSendToChat={() => {}} />);

      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

      const modal = screen.getByTestId('omni-command-palette-modal');
      expect(modal).toBeDefined();
      expect(screen.getByPlaceholderText(/Type an intention/i)).toBeDefined();
    });

    it('renders Instant Intent Card in real time when intention query is typed', () => {
      render(<CommandPalette onSendToChat={() => {}} />);

      // Open
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

      const input = screen.getByPlaceholderText(/Type an intention/i);
      fireEvent.change(input, { target: { value: 'Sync with Engineering Lead tomorrow at 11:00 for 30m' } });

      const intentCard = screen.getByTestId('inferred-intent-card');
      expect(intentCard).toBeDefined();
      expect(screen.getByText(/INTENT • EVENT/i)).toBeDefined();
      expect(screen.getAllByText(/Sync with Engineering Lead/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Review & Stage/i)).toBeDefined();
    });

    it('stages inferred operations into store pendingOps on 1-click Review & Stage', () => {
      render(<CommandPalette onSendToChat={() => {}} />);

      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

      const input = screen.getByPlaceholderText(/Type an intention/i);
      fireEvent.change(input, { target: { value: 'Create task Fix cache collision bug priority 1' } });

      const stageBtn = screen.getByRole('button', { name: /review & stage/i });
      fireEvent.click(stageBtn);

      // Verify modal closed and pendingOps set
      expect(screen.queryByTestId('omni-command-palette-modal')).toBeNull();
      const pendingOps = useStore.getState().pendingOps;
      expect(pendingOps).not.toBeNull();
      expect(pendingOps?.ops.length).toBe(1);
      expect(pendingOps?.ops[0].type).toBe('create_entity');
      expect(pendingOps?.ops[0].payload.title).toContain('Fix cache collision bug');
      expect(pendingOps?.ops[0].payload.priority).toBe(1);
    });

    it('filters matching entities and selects them on click for find and amend workflow', () => {
      const existingTask: any = {
        id: 'task-find-1',
        title: 'Submit Q4 Budget Allocations',
        kind: EntityKind.TASK,
        status: EntityStatus.ACTIVE,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        canonical_tags: []
      };

      useStore.setState({
        entities: [existingTask]
      });

      render(<CommandPalette onSendToChat={() => {}} />);

      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

      const input = screen.getByPlaceholderText(/Type an intention/i);
      fireEvent.change(input, { target: { value: 'Budget' } });

      expect(screen.getByText(/Submit Q4 Budget Allocations/i)).toBeDefined();

      fireEvent.click(screen.getByText(/Submit Q4 Budget Allocations/i));

      expect(useStore.getState().selectedEntityId).toBe('task-find-1');
      expect(screen.queryByTestId('omni-command-palette-modal')).toBeNull();
    });
  });
});

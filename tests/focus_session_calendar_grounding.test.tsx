import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useStore } from '../store';
import { EntityKind, EntityStatus } from '../types';
import { checkFocusSessionConflicts } from '../utils/calendarConflicts';
import EntityDetailPanel from '../components/EntityDetailPanel';
import FocusTimer from '../components/FocusTimer';

describe('Priority B: Focus Session Calendar Collision Grounding', () => {
  beforeEach(() => {
    useStore.setState({
      entities: [],
      selectedEntityId: null,
      focusSession: null,
      pendingOps: null
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('1. Pure Logic (checkFocusSessionConflicts)', () => {
    it('returns hasConflict: false when no events exist', () => {
      const res = checkFocusSessionConflicts(25, [], Date.now());
      expect(res.hasConflict).toBe(false);
      expect(res.isEventOngoing).toBe(false);
      expect(res.conflicts).toHaveLength(0);
    });

    it('detects upcoming event collision and recommends fitting duration', () => {
      const now = new Date('2026-10-15T14:00:00.000Z').getTime();
      const upcomingEvent = {
        id: 'event-team-sync',
        title: 'Team Sync Meeting',
        kind: EntityKind.EVENT,
        status: EntityStatus.ACTIVE,
        start_time: '2026-10-15T14:15:00.000Z', // 15 mins after now
        end_time: '2026-10-15T14:45:00.000Z',
        metadata: { source: 'Google Calendar' }
      };

      const res = checkFocusSessionConflicts(25, [upcomingEvent as any], now);
      expect(res.hasConflict).toBe(true);
      expect(res.isEventOngoing).toBe(false);
      expect(res.minutesUntilNextEvent).toBe(15);
      expect(res.suggestedDurationMinutes).toBe(15);
      expect(res.collidingEvent?.collidingEventTitle).toBe('Team Sync Meeting');
    });

    it('identifies currently ongoing event collision', () => {
      const now = new Date('2026-10-15T14:10:00.000Z').getTime();
      const ongoingEvent = {
        id: 'event-ongoing-standup',
        title: 'Daily Standup',
        kind: EntityKind.EVENT,
        status: EntityStatus.ACTIVE,
        start_time: '2026-10-15T14:00:00.000Z', // Started 10 mins ago
        end_time: '2026-10-15T14:30:00.000Z',
        metadata: { source: 'Local Graph' }
      };

      const res = checkFocusSessionConflicts(25, [ongoingEvent as any], now);
      expect(res.hasConflict).toBe(true);
      expect(res.isEventOngoing).toBe(true);
      expect(res.suggestedDurationMinutes).toBeUndefined();
    });

    it('strictly excludes tombstoned and deleted events from collision check', () => {
      const now = new Date('2026-10-15T14:00:00.000Z').getTime();
      const deletedEvent = {
        id: 'event-cancelled',
        title: 'Cancelled Client Call',
        kind: EntityKind.EVENT,
        status: EntityStatus.ACTIVE,
        start_time: '2026-10-15T14:10:00.000Z',
        end_time: '2026-10-15T14:40:00.000Z',
        lifecycle: { status: 'deleted', deleted_at: '2026-10-15T13:00:00.000Z' }
      };

      const res = checkFocusSessionConflicts(25, [deletedEvent as any], now);
      expect(res.hasConflict).toBe(false);
    });
  });

  describe('2. EntityDetailPanel Grounding & Conflict Modal', () => {
    it('surfaces conflict warning pill and offers Fit Before Event in modal', () => {
      // Mock clock
      const mockNow = new Date('2026-10-15T10:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);

      const targetTask = {
        id: 'task-build-kernel',
        title: 'Complete Phase 4 Architecture',
        kind: EntityKind.TASK,
        status: EntityStatus.ACTIVE
      };

      const upcomingMeeting = {
        id: 'event-arch-sync',
        title: 'Architecture Sync with Lead',
        kind: EntityKind.EVENT,
        status: EntityStatus.ACTIVE,
        start_time: '2026-10-15T10:15:00.000Z', // in 15 mins
        end_time: '2026-10-15T11:00:00.000Z',
        metadata: { source: 'Google Calendar' }
      };

      useStore.setState({
        selectedEntityId: 'task-build-kernel',
        entities: [targetTask as any, upcomingMeeting as any]
      });

      render(<EntityDetailPanel />);

      // Verify warning pill is displayed
      const pill = screen.getByTestId('focus-conflict-warning-pill');
      expect(pill).toBeDefined();
      expect(pill.textContent).toContain('Clashes with event in 15m');
      expect(pill.textContent).toContain('Architecture Sync with Lead');

      // Click Start Focus Session
      const startBtn = screen.getByTestId('start-focus-session-btn');
      fireEvent.click(startBtn);

      // Verify conflict confirmation modal appears
      const dialog = screen.getByTestId('focus-conflict-dialog');
      expect(dialog).toBeDefined();
      expect(screen.getByText(/Calendar Collision with Focus Session/i)).toBeDefined();

      // Fit before event button should offer 15m focus
      const fitBtn = screen.getByTestId('fit-before-event-btn');
      expect(fitBtn).toBeDefined();
      expect(screen.getByText(/Fit Before Event \(15m Focus\)/i)).toBeDefined();

      // Click Fit Before Event
      fireEvent.click(fitBtn);

      // Verify store started focus session with fitted 15m duration
      const currentFocus = useStore.getState().focusSession;
      expect(currentFocus).toBeDefined();
      expect(currentFocus?.entityId).toBe('task-build-kernel');
      expect(currentFocus?.durationMinutes).toBe(15);

      vi.useRealTimers();
    });

    it('allows user to Start 25m Anyway when acknowledging collision', () => {
      const mockNow = new Date('2026-10-15T10:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);

      const targetTask = {
        id: 'task-doc-write',
        title: 'Write Documentation',
        kind: EntityKind.TASK,
        status: EntityStatus.ACTIVE
      };

      const upcomingEvent = {
        id: 'event-quick-sync',
        title: 'Quick Sync',
        kind: EntityKind.EVENT,
        status: EntityStatus.ACTIVE,
        start_time: '2026-10-15T10:20:00.000Z',
        end_time: '2026-10-15T10:40:00.000Z'
      };

      useStore.setState({
        selectedEntityId: 'task-doc-write',
        entities: [targetTask as any, upcomingEvent as any]
      });

      render(<EntityDetailPanel />);
      fireEvent.click(screen.getByTestId('start-focus-session-btn'));

      // Click Start 25m Anyway
      fireEvent.click(screen.getByTestId('start-focus-anyway-btn'));

      const currentFocus = useStore.getState().focusSession;
      expect(currentFocus?.durationMinutes).toBe(25);

      vi.useRealTimers();
    });
  });

  describe('3. FocusTimer Live Collision Warning', () => {
    it('renders live calendar collision alert when event coincides with active focus timer', () => {
      const mockNow = new Date('2026-10-15T10:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);

      const targetTask = {
        id: 'task-focus-target',
        title: 'Refactor Kernel Dispatch',
        kind: EntityKind.TASK,
        status: EntityStatus.ACTIVE
      };

      const upcomingMeeting = {
        id: 'event-client-demo',
        title: 'Client Demo Review',
        kind: EntityKind.EVENT,
        status: EntityStatus.ACTIVE,
        start_time: '2026-10-15T10:10:00.000Z', // in 10 mins
        end_time: '2026-10-15T11:00:00.000Z',
        metadata: { source: 'Google Calendar' }
      };

      useStore.setState({
        focusSession: {
          entityId: 'task-focus-target',
          startTime: '2026-10-15T10:00:00.000Z',
          durationMinutes: 25,
          status: 'active'
        },
        entities: [targetTask as any, upcomingMeeting as any]
      });

      render(<FocusTimer />);

      // Verify collision alert renders in floating FocusTimer
      const collisionAlert = screen.getByTestId('focus-timer-calendar-collision');
      expect(collisionAlert).toBeDefined();
      expect(screen.getByText(/Starts in 10m: Client Demo Review/i)).toBeDefined();

      // Click collision card to inspect colliding event
      fireEvent.click(collisionAlert);
      expect(useStore.getState().selectedEntityId).toBe('event-client-demo');

      vi.useRealTimers();
    });
  });
});

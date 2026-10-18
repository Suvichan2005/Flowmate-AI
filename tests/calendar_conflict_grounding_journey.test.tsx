import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Entity, EntityKind, EntityStatus } from '../types';
import {
  findCalendarConflicts,
  findCollidingEventIds,
  getEventSourceAttribution,
  formatLocalTimeSpan,
  getNormalizedEventInterval,
  validateCandidateSlot,
  evaluateCandidateSlot,
  CalendarConflict
} from '../utils/calendarConflicts';
import { CommandPalette } from '../components/CommandPalette';
import CalendarView from '../components/CalendarView';
import CreateEntityModal from '../components/CreateEntityModal';
import { useStore } from '../store';

// Mock scrollTo & clientWidth for DOM in jsdom
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });

describe('Workflow 2: Calendar Conflict Grounding & Read-Only Awareness', () => {
  const baseTime = new Date('2026-10-12T14:00:00.000Z').getTime();

  describe('1. Pure Logic & Timezone/Attribution Contract (findCalendarConflicts)', () => {
    it('returns empty array when existing calendar has zero events', () => {
      const conflicts = findCalendarConflicts(
        {
          startTimeIso: '2026-10-12T14:00:00.000Z',
          endTimeIso: '2026-10-12T15:00:00.000Z'
        },
        []
      );
      expect(conflicts).toEqual([]);
    });

    it('detects partial overlap and calculates accurate overlap minutes and source attribution', () => {
      const existingEvents: any[] = [
        {
          id: 'evt-1',
          title: 'Existing Deep Work',
          kind: EntityKind.EVENT,
          status: EntityStatus.IN_PROGRESS,
          created_at: '2026-10-12T10:00:00.000Z',
          updated_at: '2026-10-12T10:00:00.000Z',
          start_time: '2026-10-12T14:00:00.000Z',
          end_time: '2026-10-12T15:30:00.000Z',
          metadata: {
            source: 'Google Calendar'
          }
        }
      ];

      // Candidate from 14:30 to 16:00 (overlaps from 14:30 to 15:30 = 60 mins)
      const conflicts = findCalendarConflicts(
        {
          startTimeIso: '2026-10-12T14:30:00.000Z',
          endTimeIso: '2026-10-12T16:00:00.000Z'
        },
        existingEvents,
        baseTime // now is 14:00Z, so existing event (ends 15:30Z) is active
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].collidingEventId).toBe('evt-1');
      expect(conflicts[0].collidingEventTitle).toBe('Existing Deep Work');
      expect(conflicts[0].overlapMinutes).toBe(60);
      expect(conflicts[0].sourceAttribution).toBe('Google Calendar');
      expect(conflicts[0].freshnessStatus).toBe('active');
    });

    it('strictly excludes deleted and tombstoned entities', () => {
      const existingEvents: any[] = [
        {
          id: 'evt-deleted-flag',
          title: 'Deleted Event by flag',
          kind: EntityKind.EVENT,
          status: EntityStatus.IN_PROGRESS,
          created_at: '2026-10-12T10:00:00.000Z',
          updated_at: '2026-10-12T10:00:00.000Z',
          start_time: '2026-10-12T14:00:00.000Z',
          end_time: '2026-10-12T15:00:00.000Z',
          deleted: true
        },
        {
          id: 'evt-tombstoned-meta',
          title: 'Tombstoned Event',
          kind: EntityKind.EVENT,
          status: EntityStatus.IN_PROGRESS,
          created_at: '2026-10-12T10:00:00.000Z',
          updated_at: '2026-10-12T10:00:00.000Z',
          start_time: '2026-10-12T14:00:00.000Z',
          end_time: '2026-10-12T15:00:00.000Z',
          metadata: {
            deleted: true,
            tombstone: true
          }
        }
      ];

      const conflicts = findCalendarConflicts(
        {
          startTimeIso: '2026-10-12T14:00:00.000Z',
          endTimeIso: '2026-10-12T15:00:00.000Z'
        },
        existingEvents
      );

      expect(conflicts).toHaveLength(0);
    });

    it('labels past/historical collisions as stale_historical without suppressing awareness', () => {
      const pastTime = new Date('2026-10-12T18:00:00.000Z').getTime(); // now is 18:00
      const existingEvents: any[] = [
        {
          id: 'evt-past',
          title: 'Morning Standup',
          kind: EntityKind.EVENT,
          status: EntityStatus.COMPLETED,
          created_at: '2026-10-12T08:00:00.000Z',
          updated_at: '2026-10-12T08:00:00.000Z',
          start_time: '2026-10-12T09:00:00.000Z',
          end_time: '2026-10-12T10:00:00.000Z',
          metadata: {
            source_type: 'user_manual'
          }
        }
      ];

      const conflicts = findCalendarConflicts(
        {
          startTimeIso: '2026-10-12T09:30:00.000Z',
          endTimeIso: '2026-10-12T10:30:00.000Z'
        },
        existingEvents,
        pastTime
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].freshnessStatus).toBe('stale_historical');
      expect(conflicts[0].sourceAttribution).toBe('user_manual');
    });

    it('handles missing end_time gracefully with estimated duration status', () => {
      const existingEvents: any[] = [
        {
          id: 'evt-missing-end',
          title: 'Adhoc Sync',
          kind: EntityKind.EVENT,
          status: EntityStatus.IN_PROGRESS,
          created_at: '2026-10-12T10:00:00.000Z',
          updated_at: '2026-10-12T10:00:00.000Z',
          start_time: '2026-10-12T16:00:00.000Z',
          // end_time omitted! Default 60 min
          duration_minutes: 45
        }
      ];

      const conflicts = findCalendarConflicts(
        {
          startTimeIso: '2026-10-12T16:15:00.000Z',
          endTimeIso: '2026-10-12T17:00:00.000Z'
        },
        existingEvents,
        new Date('2026-10-12T12:00:00.000Z').getTime()
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].freshnessStatus).toBe('estimated_duration');
      expect(conflicts[0].overlapMinutes).toBe(30); // 16:15 to 16:45
    });

    it('handles all-day events correctly spanning the day', () => {
      const existingEvents: any[] = [
        {
          id: 'evt-allday',
          title: 'Annual Company Offsite',
          kind: EntityKind.EVENT,
          status: EntityStatus.IN_PROGRESS,
          created_at: '2026-10-12T00:00:00.000Z',
          updated_at: '2026-10-12T00:00:00.000Z',
          start_time: '2026-10-12T00:00:00.000Z',
          metadata: {
            all_day: true,
            source: 'Google Calendar'
          }
        }
      ];

      const conflicts = findCalendarConflicts(
        {
          startTimeIso: '2026-10-12T15:00:00.000Z',
          endTimeIso: '2026-10-12T16:00:00.000Z'
        },
        existingEvents,
        new Date('2026-10-12T08:00:00.000Z').getTime()
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].isAllDay).toBe(true);
      expect(conflicts[0].formattedTimeSpan).toBe('All Day');
      expect(conflicts[0].collidingEventTitle).toBe('Annual Company Offsite');
    });

    it('handles multi-day all-day events correctly spanning through the second day (Counterexample 1)', () => {
      const existingEvents: any[] = [
        {
          id: 'synthetic-event',
          kind: EntityKind.EVENT,
          title: 'Synthetic fixture',
          status: EntityStatus.IN_PROGRESS,
          created_at: '2026-10-12T00:00:00+05:30',
          updated_at: '2026-10-12T00:00:00+05:30',
          start_time: '2026-10-13T00:00:00+05:30',
          end_time: '2026-10-15T00:00:00+05:30',
          metadata: {
            all_day: true
          }
        }
      ];

      const conflicts = findCalendarConflicts(
        {
          startTimeIso: '2026-10-14T10:00:00+05:30',
          endTimeIso: '2026-10-14T11:00:00+05:30'
        },
        existingEvents,
        Date.parse('2026-10-12T00:00:00Z')
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].collidingEventId).toBe('synthetic-event');
    });

    it('recognizes Google import metadata.is_all_day shape (Counterexample 2)', () => {
      const existingEvents: any[] = [
        {
          id: 'gcal-import-1',
          kind: EntityKind.EVENT,
          title: 'Google Synced Offsite',
          status: EntityStatus.IN_PROGRESS,
          created_at: '2026-10-12T00:00:00+05:30',
          updated_at: '2026-10-12T00:00:00+05:30',
          start_time: '2026-10-13T00:00:00+05:30',
          end_time: '2026-10-15T00:00:00+05:30',
          metadata: {
            is_all_day: true,
            source: 'google_calendar'
          }
        }
      ];

      const conflicts = findCalendarConflicts(
        {
          startTimeIso: '2026-10-13T10:00:00+05:30',
          endTimeIso: '2026-10-13T11:00:00+05:30'
        },
        existingEvents,
        Date.parse('2026-10-12T00:00:00Z')
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].isAllDay).toBe(true);
      expect(conflicts[0].sourceAttribution).toBe('google_calendar');
    });

    it('excludes canonical lifecycle status deleted even when deleted_at is null (Counterexample 3)', () => {
      const existingEvents: any[] = [
        {
          id: 'evt-lifecycle-deleted',
          kind: EntityKind.EVENT,
          title: 'Soft-deleted by lifecycle',
          status: EntityStatus.IN_PROGRESS,
          created_at: '2026-10-12T00:00:00+05:30',
          updated_at: '2026-10-12T00:00:00+05:30',
          start_time: '2026-10-13T00:00:00+05:30',
          end_time: '2026-10-15T00:00:00+05:30',
          metadata: {},
          lifecycle: {
            status: 'deleted',
            deleted_at: null
          }
        } as any
      ];

      const conflicts = findCalendarConflicts(
        {
          startTimeIso: '2026-10-13T10:00:00+05:30',
          endTimeIso: '2026-10-13T11:00:00+05:30'
        },
        existingEvents,
        Date.parse('2026-10-12T00:00:00Z')
      );

      expect(conflicts).toHaveLength(0);
    });

    it('normalizes all-day start to midnight so morning slots conflict with noon-marked events (Counterexample 4)', () => {
      const existingEvents: any[] = [
        {
          id: 'evt-noon-allday',
          kind: EntityKind.EVENT,
          title: 'All Day Event starting at noon in metadata',
          status: EntityStatus.IN_PROGRESS,
          created_at: '2026-10-12T00:00:00+05:30',
          updated_at: '2026-10-12T00:00:00+05:30',
          start_time: '2026-10-13T12:00:00+05:30',
          end_time: '2026-10-13T13:00:00+05:30',
          metadata: {
            all_day: true
          }
        }
      ];

      const conflicts = findCalendarConflicts(
        {
          startTimeIso: '2026-10-13T08:00:00+05:30',
          endTimeIso: '2026-10-13T09:00:00+05:30'
        },
        existingEvents,
        Date.parse('2026-10-12T00:00:00Z')
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].collidingEventId).toBe('evt-noon-allday');
      expect(conflicts[0].isAllDay).toBe(true);
    });

    it('distinguishes event-in-the-past from data sync freshness', () => {
      const nowMs = Date.parse('2026-10-12T12:00:00.000Z');

      const futureUnsyncedEvent: any = {
        id: 'evt-future-unsynced',
        kind: EntityKind.EVENT,
        title: 'Far Future Event',
        status: EntityStatus.IN_PROGRESS,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        start_time: '2026-11-01T10:00:00.000Z',
        end_time: '2026-11-01T11:00:00.000Z',
        metadata: {
          source: 'google_calendar'
        }
      };

      const pastEvent: any = {
        id: 'evt-past-event',
        kind: EntityKind.EVENT,
        title: 'Yesterday Meeting',
        status: EntityStatus.IN_PROGRESS,
        created_at: '2026-10-11T00:00:00.000Z',
        updated_at: '2026-10-11T00:00:00.000Z',
        start_time: '2026-10-11T10:00:00.000Z',
        end_time: '2026-10-11T11:00:00.000Z',
        metadata: {
          source: 'Local Graph'
        }
      };

      const conflictsFuture = findCalendarConflicts(
        { startTimeIso: '2026-11-01T10:30:00.000Z', endTimeIso: '2026-11-01T11:30:00.000Z' },
        [futureUnsyncedEvent],
        nowMs
      );
      expect(conflictsFuture[0].temporalStatus).toBe('future');
      expect(conflictsFuture[0].syncFreshness).toBe('unverified');

      const conflictsPast = findCalendarConflicts(
        { startTimeIso: '2026-10-11T10:30:00.000Z', endTimeIso: '2026-10-11T11:30:00.000Z' },
        [pastEvent],
        nowMs
      );
      expect(conflictsPast[0].temporalStatus).toBe('past');
      expect(conflictsPast[0].freshnessStatus).toBe('stale_historical');
      expect(conflictsPast[0].syncFreshness).toBe('local_only');
    });

    it('findCollidingEventIds discovers all colliding events under unified contract', () => {
      const e1: any = {
        id: 'ev-a',
        kind: EntityKind.EVENT,
        title: 'Event A',
        status: EntityStatus.IN_PROGRESS,
        created_at: '2026-10-12T00:00:00Z',
        updated_at: '2026-10-12T00:00:00Z',
        start_time: '2026-10-12T10:00:00Z',
        end_time: '2026-10-12T11:30:00Z'
      };
      const e2: any = {
        id: 'ev-b',
        kind: EntityKind.EVENT,
        title: 'Event B',
        status: EntityStatus.IN_PROGRESS,
        created_at: '2026-10-12T00:00:00Z',
        updated_at: '2026-10-12T00:00:00Z',
        start_time: '2026-10-12T11:00:00Z',
        end_time: '2026-10-12T12:00:00Z'
      };
      const e3NonColliding: any = {
        id: 'ev-c',
        kind: EntityKind.EVENT,
        title: 'Event C',
        status: EntityStatus.IN_PROGRESS,
        created_at: '2026-10-12T00:00:00Z',
        updated_at: '2026-10-12T00:00:00Z',
        start_time: '2026-10-12T14:00:00Z',
        end_time: '2026-10-12T15:00:00Z'
      };

      const colliding = findCollidingEventIds([e1, e2, e3NonColliding]);
      expect(colliding.has('ev-a')).toBe(true);
      expect(colliding.has('ev-b')).toBe(true);
      expect(colliding.has('ev-c')).toBe(false);
    });

    it('handles future sync timestamps as unverified using bounded clock skew', () => {
      const nowMs = Date.parse('2026-10-12T00:00:00Z');
      const baseEvent: any = {
        id: 'synthetic-event',
        kind: EntityKind.EVENT,
        title: 'Synthetic fixture',
        status: EntityStatus.IN_PROGRESS,
        created_at: '2026-10-12T00:00:00Z',
        updated_at: '2026-10-12T00:00:00Z',
        start_time: '2026-10-13T00:00:00+05:30',
        end_time: '2026-10-15T00:00:00+05:30',
        metadata: {
          source: 'google_calendar',
          synced_at: '2026-10-15T00:00:00Z' // 3 days in future
        }
      };

      const normalized = getNormalizedEventInterval(baseEvent, nowMs);
      expect(normalized).not.toBeNull();
      expect(normalized?.syncFreshness).toBe('unverified');

      // Slight forward clock skew (e.g. 2 minutes) is tolerated
      const skewEvent = {
        ...baseEvent,
        metadata: {
          ...baseEvent.metadata,
          synced_at: new Date(nowMs + 2 * 60 * 1000).toISOString()
        }
      };
      const normSkew = getNormalizedEventInterval(skewEvent, nowMs);
      expect(normSkew?.syncFreshness).toBe('recent');
    });

    it('evaluates candidate slot and rejects invalid/reversed intervals without claiming slot is clear', () => {
      const nowMs = Date.parse('2026-10-12T00:00:00Z');
      const reversedSlot = {
        startTimeIso: '2026-10-14T11:00:00+05:30',
        endTimeIso: '2026-10-14T10:00:00+05:30' // End before start
      };
      const validation = validateCandidateSlot(reversedSlot);
      expect(validation.isValid).toBe(false);
      expect(validation.error).toBe('End time must be after start time');

      const evaluation = evaluateCandidateSlot(reversedSlot, [], nowMs);
      expect(evaluation.status).toBe('invalid_interval');
      expect(evaluation.conflicts).toHaveLength(0);
    });
  });

  describe('2. CommandPalette Omni-Dock User Journey & Conflict Awareness', () => {
    beforeEach(() => {
      // Reset store state
      const state = useStore.getState();
      state.entities = [];
      state.pendingOps = null;
    });

    it('displays calm green badge when user enters event intent with free slot', async () => {
      // Setup empty store
      useStore.setState({ entities: [] });

      render(<CommandPalette onSendToChat={() => {}} />);

      // Open command dock
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

      const input = screen.getByLabelText(/intention and search input/i);
      // Type event intention: "Doctor Appointment at 14:00 for 60m"
      fireEvent.change(input, { target: { value: 'Doctor Appointment at 14:00 for 60m' } });

      await waitFor(() => {
        expect(screen.getByTestId('inferred-intent-card')).toBeInTheDocument();
      });

      expect(screen.getByTestId('calendar-no-conflict-badge')).toBeInTheDocument();
      expect(screen.getByText(/no schedule conflicts/i)).toBeInTheDocument();
    });

    it('surfaces schedule conflict alert with colliding event, source attribution, and preserves two-phase staging', async () => {
      // Calculate today's date for deterministic fixture matching
      const today = new Date();
      today.setHours(16, 0, 0, 0);
      const startIso = today.toISOString();
      today.setHours(17, 30, 0, 0);
      const endIso = today.toISOString();

      const conflictingEvent: any = {
        id: 'evt-standup-1',
        title: 'Sprint Planning Sync',
        kind: EntityKind.EVENT,
        status: EntityStatus.IN_PROGRESS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        start_time: startIso,
        end_time: endIso,
        metadata: {
          source: 'Google Calendar'
        }
      };

      useStore.setState({ entities: [conflictingEvent], pendingOps: null });

      render(<CommandPalette onSendToChat={() => {}} />);

      // Open palette
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

      const input = screen.getByLabelText(/intention and search input/i);
      // Type event that overlaps at 16:30
      fireEvent.change(input, { target: { value: 'Client Meeting at 16:30 for 60m' } });

      await waitFor(() => {
        expect(screen.getByTestId('inferred-intent-card')).toBeInTheDocument();
      });

      // Conflict awareness alert must be rendered
      expect(screen.getByTestId('calendar-conflict-alert')).toBeInTheDocument();
      expect(screen.getByText(/schedule conflict detected/i)).toBeInTheDocument();
      expect(screen.getByText('Sprint Planning Sync')).toBeInTheDocument();
      expect(screen.getByText(/Src: Google Calendar/i)).toBeInTheDocument();
      expect(screen.getByText(/read-only conflict awareness/i)).toBeInTheDocument();

      // Click "Review & Stage (↵)" to verify two-phase confirmation gate
      const stageBtn = screen.getByRole('button', { name: /review & stage/i });
      fireEvent.click(stageBtn);

      // Verify that pendingOps was staged WITHOUT mutating entities directly!
      const currentPendingOps = useStore.getState().pendingOps;
      expect(currentPendingOps).not.toBeNull();
      expect(currentPendingOps?.ops[0].type).toBe('create_entity');
      expect((currentPendingOps?.ops[0].payload as any).title).toContain('Client Meeting');

      // Existing event in entities is completely untouched
      const storeEntities = useStore.getState().entities;
      expect(storeEntities).toHaveLength(1);
      expect(storeEntities[0].id).toBe('evt-standup-1');
      expect(storeEntities[0].title).toBe('Sprint Planning Sync');
    });

    it('displays invalid interval banner in CommandPalette when candidate times are reversed', async () => {
      useStore.setState({ entities: [] });

      render(<CommandPalette onSendToChat={() => {}} />);

      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

      const input = screen.getByLabelText(/intention and search input/i);
      fireEvent.change(input, { target: { value: 'Schedule from 16:00 to 15:00' } });

      await waitFor(() => {
        expect(screen.getByTestId('inferred-intent-card')).toBeInTheDocument();
      });

      expect(screen.getByTestId('calendar-invalid-interval-badge')).toBeInTheDocument();
      expect(screen.getByText(/Invalid Time Interval/i)).toBeInTheDocument();
      expect(screen.queryByTestId('calendar-no-conflict-badge')).not.toBeInTheDocument();
    });

    it('communicates stale and unverified sync badges in CommandPalette UI', async () => {
      const today = new Date();
      today.setHours(14, 0, 0, 0);
      const start = today.toISOString();
      today.setHours(15, 0, 0, 0);
      const end = today.toISOString();

      const staleEvent: any = {
        id: 'evt-stale-sync',
        title: 'Old Sync Event',
        kind: EntityKind.EVENT,
        status: EntityStatus.IN_PROGRESS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        start_time: start,
        end_time: end,
        metadata: {
          source: 'google_calendar',
          synced_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() // 48h ago
        }
      };

      useStore.setState({ entities: [staleEvent] });

      render(<CommandPalette onSendToChat={() => {}} />);

      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

      const input = screen.getByLabelText(/intention and search input/i);
      fireEvent.change(input, { target: { value: 'Sprint Planning at 14:00 for 60m' } });

      await waitFor(() => {
        expect(screen.getByTestId('calendar-conflict-alert')).toBeInTheDocument();
      });

      expect(screen.getByText('Stale Sync')).toBeInTheDocument();
    });
  });

  describe('3. CalendarView Collision Grounding', () => {
    it('CalendarView renders schedule collision badge on colliding events', () => {
      const today = new Date();
      today.setHours(10, 0, 0, 0);
      const start1 = today.toISOString();
      today.setHours(12, 0, 0, 0);
      const end1 = today.toISOString();

      today.setHours(11, 0, 0, 0);
      const start2 = today.toISOString();
      today.setHours(13, 0, 0, 0);
      const end2 = today.toISOString();

      const e1: any = {
        id: 'cal-1',
        title: 'Sprint Retrospective',
        kind: EntityKind.EVENT,
        status: EntityStatus.IN_PROGRESS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        start_time: start1,
        end_time: end1,
      };

      const e2: any = {
        id: 'cal-2',
        title: 'Cross-functional Sync',
        kind: EntityKind.EVENT,
        status: EntityStatus.IN_PROGRESS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        start_time: start2,
        end_time: end2,
      };

      useStore.setState({ entities: [e1, e2] });

      render(<CalendarView />);

      const eventEl1 = screen.getByTestId('calendar-agenda-item-cal-1');
      const eventEl2 = screen.getByTestId('calendar-agenda-item-cal-2');

      expect(eventEl1).toHaveAttribute('title', expect.stringContaining('[Schedule Conflict]'));
      expect(eventEl2).toHaveAttribute('title', expect.stringContaining('[Schedule Conflict]'));
      expect(screen.getByTestId('agenda-conflict-cal-1')).toBeInTheDocument();
      expect(screen.getByTestId('agenda-conflict-cal-2')).toBeInTheDocument();
    });

    it('CalendarView Month view renders schedule collision pills and day header conflict indicator dot', () => {
      const today = new Date();
      today.setHours(14, 0, 0, 0);
      const start1 = today.toISOString();
      today.setHours(16, 0, 0, 0);
      const end1 = today.toISOString();

      today.setHours(15, 0, 0, 0);
      const start2 = today.toISOString();
      today.setHours(17, 0, 0, 0);
      const end2 = today.toISOString();

      const e1: any = {
        id: 'month-col-1',
        title: 'Team Sync Collision',
        kind: EntityKind.EVENT,
        status: EntityStatus.IN_PROGRESS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        start_time: start1,
        end_time: end1,
      };

      const e2: any = {
        id: 'month-col-2',
        title: 'Design Critique Collision',
        kind: EntityKind.EVENT,
        status: EntityStatus.IN_PROGRESS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        start_time: start2,
        end_time: end2,
      };

      useStore.setState({ entities: [e1, e2], calendarInitialView: 'month' });

      render(<CalendarView />);

      const dayNumber = today.getDate();
      const conflictDot = screen.getByTestId(`month-day-conflict-dot-${dayNumber}`);
      expect(conflictDot).toBeInTheDocument();
      expect(conflictDot).toHaveAttribute('title', 'Schedule conflict on this day');

      const pill1 = screen.getByTestId('month-event-pill-month-col-1');
      const pill2 = screen.getByTestId('month-event-pill-month-col-2');

      expect(pill1).toHaveAttribute('title', expect.stringContaining('⚠️ [Schedule Conflict]'));
      expect(pill2).toHaveAttribute('title', expect.stringContaining('⚠️ [Schedule Conflict]'));
      expect(pill1.className).toContain('border-amber-500');
      expect(pill2.className).toContain('border-amber-500');

      expect(screen.getByTestId('month-conflict-icon-month-col-1')).toBeInTheDocument();
      expect(screen.getByTestId('month-conflict-icon-month-col-2')).toBeInTheDocument();
    });

    it('CalendarView Month view renders multi-day spanning events with continuation indicator', () => {
      // Create multi-day event spanning yesterday through tomorrow
      const now = new Date();
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 10, 0, 0);
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0, 0);

      const spanningEvent: any = {
        id: 'spanning-conf-1',
        title: 'Annual Hackathon',
        kind: EntityKind.EVENT,
        status: EntityStatus.IN_PROGRESS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        start_time: yesterday.toISOString(),
        end_time: tomorrow.toISOString(),
      };

      useStore.setState({ entities: [spanningEvent], calendarInitialView: 'month' });

      render(<CalendarView />);

      // On today's cell, this event spans and should have continuation indicators
      const todayCell = screen.getByTestId(`month-day-cell-${now.getDate()}`);
      expect(todayCell).toBeInTheDocument();

      const spanPills = screen.getAllByTestId('month-event-pill-spanning-conf-1');
      expect(spanPills.length).toBeGreaterThanOrEqual(1);

      // Check that at least one pill is marked as continuing (today or tomorrow)
      const continuingPill = spanPills.find(p => p.getAttribute('title')?.includes('(continues)'));
      expect(continuingPill).toBeDefined();
      expect(continuingPill?.className).toContain('border-dashed');
    });
  });

  describe('Priority D: Real-Time Conflict Grounding & Alternative Slot Suggestions in CreateEntityModal', () => {
    it('displays conflict banner and allows 1-click alternative slot selection', async () => {
      const applyOpsSpy = vi.fn();
      const existingEvent: any = {
        id: 'existing-meeting-1',
        title: 'Sprint Planning',
        kind: EntityKind.EVENT,
        status: EntityStatus.IN_PROGRESS,
        created_at: '2026-10-15T10:00:00.000Z',
        updated_at: '2026-10-15T10:00:00.000Z',
        start_time: '2026-10-15T10:00:00.000Z',
        end_time: '2026-10-15T11:00:00.000Z',
        metadata: {
          source: 'Google Calendar'
        }
      };

      useStore.setState({
        entities: [existingEvent],
        applyOperations: applyOpsSpy
      });

      const handleClose = vi.fn();
      render(
        <CreateEntityModal
          onClose={handleClose}
          initialKind={EntityKind.EVENT}
          initialDate="2026-10-15T10:30:00.000Z"
        />
      );

      // Verify conflict banner is displayed
      const banner = await screen.findByTestId('create-modal-conflict-banner');
      expect(banner).toBeInTheDocument();
      expect(banner.textContent).toContain('Schedule Conflict Detected');
      expect(banner.textContent).toContain('Sprint Planning');

      // Verify suggested slot button is present
      const applyBtn = screen.getByTestId('apply-suggested-slot-btn');
      expect(applyBtn).toBeInTheDocument();
      expect(applyBtn.textContent).toContain('Use Suggested Slot');

      // Click "Use Suggested Slot"
      fireEvent.click(applyBtn);

      // Conflict banner should disappear, and slot clear badge should appear
      await waitFor(() => {
        expect(screen.queryByTestId('create-modal-conflict-banner')).not.toBeInTheDocument();
      });
      expect(screen.getByTestId('create-modal-slot-clear')).toBeInTheDocument();

      // Enter title and submit
      const titleInput = screen.getByPlaceholderText(/e.g., Complete Project X/i);
      fireEvent.change(titleInput, { target: { value: 'Post-Sprint Retro' } });

      const submitBtn = screen.getByRole('button', { name: /Create EVENT/i });
      fireEvent.click(submitBtn);

      expect(applyOpsSpy).toHaveBeenCalledTimes(1);
      const applied = applyOpsSpy.mock.calls[0][0][0];
      expect(applied.type).toBe('create_entity');
      expect(applied.payload.title).toBe('Post-Sprint Retro');
      expect(applied.payload.kind).toBe(EntityKind.EVENT);
      // Ensure the start time is the suggested non-colliding time (after 11:00)
      const appliedStart = new Date(applied.payload.start_time).getTime();
      const existingEnd = new Date(existingEvent.end_time!).getTime();
      expect(appliedStart).toBeGreaterThanOrEqual(existingEnd);
      expect(handleClose).toHaveBeenCalled();
    });

    it('does not display conflict banner for non-EVENT entity types', () => {
      const existingEvent: any = {
        id: 'existing-meeting-2',
        title: '1:1 Review',
        kind: EntityKind.EVENT,
        status: EntityStatus.IN_PROGRESS,
        created_at: '2026-10-15T10:00:00.000Z',
        updated_at: '2026-10-15T10:00:00.000Z',
        start_time: '2026-10-15T10:00:00.000Z',
        end_time: '2026-10-15T11:00:00.000Z',
      };

      useStore.setState({ entities: [existingEvent] });

      render(
        <CreateEntityModal
          onClose={vi.fn()}
          initialKind={EntityKind.TASK}
          initialDate="2026-10-15T10:30:00.000Z"
        />
      );

      expect(screen.queryByTestId('create-modal-conflict-banner')).not.toBeInTheDocument();
    });

    it('detects conflict with a recurring event occurring on a future candidate date', async () => {
      // Daily standup started on Oct 1, candidate slot is on Oct 20
      const recurringStandup: any = {
        id: 'evt-standup-daily',
        title: 'Daily Standup',
        kind: EntityKind.EVENT,
        status: EntityStatus.IN_PROGRESS,
        created_at: '2026-10-01T09:00:00.000Z',
        updated_at: '2026-10-01T09:00:00.000Z',
        start_time: '2026-10-01T09:00:00.000Z',
        end_time: '2026-10-01T09:30:00.000Z',
        recurrence: 'DAILY'
      };

      useStore.setState({ entities: [recurringStandup] });

      render(
        <CreateEntityModal
          onClose={vi.fn()}
          initialKind={EntityKind.EVENT}
          initialDate="2026-10-20T09:15:00.000Z"
        />
      );

      const banner = await screen.findByTestId('create-modal-conflict-banner');
      expect(banner).toBeInTheDocument();
      expect(banner.textContent).toContain('Schedule Conflict Detected');
      expect(banner.textContent).toContain('Daily Standup (Recurring)');

      // The suggested slot should be 09:30 or later (after standup ends)
      const applyBtn = screen.getByTestId('apply-suggested-slot-btn');
      expect(applyBtn).toBeInTheDocument();
      fireEvent.click(applyBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('create-modal-conflict-banner')).not.toBeInTheDocument();
      });
      expect(screen.getByTestId('create-modal-slot-clear')).toBeInTheDocument();
    });

    it('sets explicit 60-minute duration_minutes and end_time on non-all-day event creation', () => {
      const applyOpsSpy = vi.fn();
      useStore.setState({
        entities: [],
        applyOperations: applyOpsSpy
      });

      render(
        <CreateEntityModal
          onClose={vi.fn()}
          initialKind={EntityKind.EVENT}
          initialDate="2026-10-20T14:00:00.000Z"
        />
      );

      const titleInput = screen.getByPlaceholderText(/e.g., Complete Project X/i);
      fireEvent.change(titleInput, { target: { value: 'Quarterly Planning' } });

      const submitBtn = screen.getByRole('button', { name: /Create EVENT/i });
      fireEvent.click(submitBtn);

      expect(applyOpsSpy).toHaveBeenCalledTimes(1);
      const applied = applyOpsSpy.mock.calls[0][0][0];
      expect(applied.payload.duration_minutes).toBe(60);
      const startMs = new Date(applied.payload.start_time).getTime();
      const endMs = new Date(applied.payload.end_time).getTime();
      expect(endMs - startMs).toBe(60 * 60 * 1000);
    });

    it('supports accessible dismissal via Escape key and backdrop click', () => {
      const handleClose = vi.fn();
      render(
        <CreateEntityModal
          onClose={handleClose}
          initialKind={EntityKind.TASK}
        />
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'create-entity-modal-title');

      // Escape key dismiss
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(handleClose).toHaveBeenCalledTimes(1);

      // Backdrop click dismiss
      fireEvent.click(dialog);
      expect(handleClose).toHaveBeenCalledTimes(2);
    });
  });
});

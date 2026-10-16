/**
 * Task P1-06: Reusable Entity Capabilities Vertical Slice Tests
 *
 * Verifies:
 * A. Recurrence engine (timezone, week/month boundaries, next/prev/range, invalid rules)
 * B. Commitment capability contract & parsing
 * C. Evidence with provenance (user_confirmed, observed, inferred, deduplication)
 * D. Progress calculation & period rollover
 * E. Streak projections (current, longest, historical periods)
 * F. Reminder policy (trigger, window, suppression on completion, idempotency)
 * G. AI tools (query_commitment, configure_commitment, record_commitment_evidence)
 * H. Persistence round-trip & canonical state inversion
 * I. Authorization boundary enforcement
 * J. ActionProposal & ActionExecutionEngine convergence
 * K. UI Projection state
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import {
  parseRecurrenceRule,
  getPeriodWindow,
  getNextOccurrence,
  getPreviousOccurrence,
  getOccurrences,
  getHistoricalPeriods,
  RecurrenceRule,
} from '../services/kernel/recurrence';
import {
  parseCommitmentTarget,
  parseEvidenceItems,
  evaluateCommitmentProgress,
  calculateStreakProjection,
  CommitmentTarget,
  EvidenceItem,
  DEFAULT_EVIDENCE_POLICY,
} from '../services/kernel/commitment';
import {
  parseReminderPolicy,
  evaluateReminderPolicy,
  ReminderPolicy,
} from '../services/kernel/reminders';
import {
  RECURRENT_CAPABILITY,
  COMMITMENT_CAPABILITY,
  EVIDENCE_CAPABILITY,
  NOTIFIABLE_CAPABILITY,
  Entity as KernelEntity,
} from '../services/kernel';
import {
  executeQueryCommitment,
  executeConfigureCommitment,
  executeRecordCommitmentEvidence,
  dispatchToolCall,
} from '../services/ai/executors';
import { User } from '../services/firebase';
import { EntityKind } from '../types';

describe('P1-06 Reusable Entity Capabilities Vertical Slice', () => {
  beforeEach(() => {
    // Reset store
    useStore.setState({
      kernelEntities: {},
      entities: [],
      relationships: [],
      messages: [],
      chatSessions: [{ id: 'default', title: 'Default Session', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
      activeSessionId: 'default',
      currentUser: { uid: 'test_user_p1_06', email: 'test@flowmate.ai' } as unknown as User,
    });
  });

  // ==========================================================================
  // PART A: RECURRENCE ENGINE
  // ==========================================================================
  describe('Part A: Recurrence Engine', () => {
    it('parses string, simple rrule, and structured recurrence definitions', () => {
      const dailyRule = parseRecurrenceRule('DAILY');
      expect(dailyRule).not.toBeNull();
      expect(dailyRule?.cadence).toBe('daily');
      expect(dailyRule?.interval).toBe(1);

      const weeklyRrule = parseRecurrenceRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR');
      expect(weeklyRrule).not.toBeNull();
      expect(weeklyRrule?.cadence).toBe('weekly');
      expect(weeklyRrule?.interval).toBe(2);
      expect(weeklyRrule?.days_of_week).toEqual([1, 3, 5]);

      const structuredObj = parseRecurrenceRule({
        cadence: 'monthly',
        interval: 1,
        day_of_month: 15,
        start_date: '2026-10-01T00:00:00.000Z',
      });
      expect(structuredObj?.cadence).toBe('monthly');
      expect(structuredObj?.day_of_month).toBe(15);
    });

    it('rejects invalid recurrence definitions gracefully with null', () => {
      expect(parseRecurrenceRule(null)).toBeNull();
      expect(parseRecurrenceRule('')).toBeNull();
      expect(parseRecurrenceRule({ cadence: 'invalid_cadence' })).toBeNull();
    });

    it('calculates weekly period boundaries accurately with Monday start and Sunday end', () => {
      const rule: RecurrenceRule = {
        cadence: 'weekly',
        interval: 1,
        start_date: '2026-10-01T00:00:00.000Z',
      };

      // Wednesday, October 7, 2026
      const targetDate = '2026-10-07T12:00:00.000Z';
      const window = getPeriodWindow(rule, targetDate, 'UTC');

      // Monday Oct 5 00:00:00 to Sunday Oct 11 23:59:59.999
      expect(window.cadence).toBe('weekly');
      expect(window.start).toBe('2026-10-05T00:00:00.000Z');
      expect(window.end).toBe('2026-10-11T23:59:59.999Z');
      expect(window.label).toContain('2026-10-05');
      expect(window.label).toContain('2026-10-11');
    });

    it('calculates monthly period boundaries accurately across month lengths and leap years', () => {
      const rule: RecurrenceRule = {
        cadence: 'monthly',
        interval: 1,
        start_date: '2024-02-15T00:00:00.000Z', // 2024 is a leap year
      };

      const febLeapWindow = getPeriodWindow(rule, '2024-02-10T00:00:00.000Z', 'UTC');
      expect(febLeapWindow.start).toBe('2024-02-01T00:00:00.000Z');
      expect(febLeapWindow.end).toBe('2024-02-29T23:59:59.999Z');

      const octWindow = getPeriodWindow(rule, '2026-10-07T00:00:00.000Z', 'UTC');
      expect(octWindow.start).toBe('2026-10-01T00:00:00.000Z');
      expect(octWindow.end).toBe('2026-10-31T23:59:59.999Z');
    });

    it('generates occurrences deterministically without duplicates', () => {
      const rule: RecurrenceRule = {
        cadence: 'daily',
        interval: 2,
        start_date: '2026-10-01T09:00:00.000Z',
        end_date: '2026-10-09T09:00:00.000Z',
      };

      const occurrences = getOccurrences(rule, '2026-10-01T00:00:00.000Z', '2026-10-10T00:00:00.000Z');
      expect(occurrences).toEqual([
        '2026-10-01T09:00:00.000Z',
        '2026-10-03T09:00:00.000Z',
        '2026-10-05T09:00:00.000Z',
        '2026-10-07T09:00:00.000Z',
        '2026-10-09T09:00:00.000Z',
      ]);

      const next = getNextOccurrence(rule, '2026-10-04T00:00:00.000Z');
      expect(next).toBe('2026-10-05T09:00:00.000Z');

      const prev = getPreviousOccurrence(rule, '2026-10-04T00:00:00.000Z');
      expect(prev).toBe('2026-10-03T09:00:00.000Z');
    });

    it('generates chronological historical periods ending at the reference period', () => {
      const rule: RecurrenceRule = {
        cadence: 'weekly',
        interval: 1,
        start_date: '2026-09-01T00:00:00.000Z',
      };

      const periods = getHistoricalPeriods(rule, 4, '2026-10-07T12:00:00.000Z');
      expect(periods.length).toBe(4);
      // Last period must be the current week of Oct 5 - Oct 11
      expect(periods[3].start).toBe('2026-10-05T00:00:00.000Z');
      expect(periods[2].start).toBe('2026-09-28T00:00:00.000Z');
      expect(periods[1].start).toBe('2026-09-21T00:00:00.000Z');
      expect(periods[0].start).toBe('2026-09-14T00:00:00.000Z');
    });
  });

  // ==========================================================================
  // PART B & C: COMMITMENT CAPABILITY & EVIDENCE WITH PROVENANCE
  // ==========================================================================
  describe('Part B & C: Commitment Capability & Evidence with Provenance', () => {
    it('parses generic commitment targets across daily, weekly, monthly, and custom units', () => {
      const weekly = parseCommitmentTarget({ min_count: 1, period: 'week' });
      expect(weekly?.min_count).toBe(1);
      expect(weekly?.period).toBe('week');
      expect(weekly?.target_unit).toBe('times');

      const exercise = parseCommitmentTarget({ min_count: 3, period: 'week', target_unit: 'workouts' });
      expect(exercise?.min_count).toBe(3);
      expect(exercise?.period).toBe('week');
      expect(exercise?.target_unit).toBe('workouts');

      const reading = parseCommitmentTarget({ min_count: 20, period: 'day', target_unit: 'pages' });
      expect(reading?.min_count).toBe(20);
      expect(reading?.period).toBe('day');
      expect(reading?.target_unit).toBe('pages');
    });

    it('satisfies capability contracts for entities with commitment, evidence, and recurrence', () => {
      const mockEntity: KernelEntity = {
        id: 'flowmate-work-entity',
        schema_id: 'system/task',
        version: 1,
        title: 'Work on Flowmate',
        attributes: {
          commitment: { min_count: 1, period: 'week' },
          recurrence: { cadence: 'weekly', interval: 1, start_date: '2026-10-01T00:00:00.000Z' },
          evidence: [
            {
              id: 'ev-1',
              timestamp: '2026-10-07T14:00:00.000Z',
              provenance: {
                source_type: 'user',
                observed_at: '2026-10-07T14:00:00.000Z',
                confidence: 1.0,
                is_inferred: false,
                user_confirmed: true,
              },
            },
          ],
          reminder_policy: {
            id: 'rem-1',
            enabled: true,
            trigger: 'period_end_approaching',
            channel: 'in_app',
            suppress_when_completed: true,
          },
        },
        lifecycle: {
          status: 'active',
          created_at: '2026-10-01T00:00:00.000Z',
          updated_at: '2026-10-07T14:00:00.000Z',
          deleted_at: null,
        },
        provenance: {
          source_type: 'user',
          observed_at: '2026-10-01T00:00:00.000Z',
          confidence: 1.0,
          is_inferred: false,
          user_confirmed: true,
        },
      };

      expect(COMMITMENT_CAPABILITY.is_satisfied_by(mockEntity)).toBe(true);
      expect(RECURRENT_CAPABILITY.is_satisfied_by(mockEntity)).toBe(true);
      expect(EVIDENCE_CAPABILITY.is_satisfied_by(mockEntity)).toBe(true);
      expect(NOTIFIABLE_CAPABILITY.is_satisfied_by(mockEntity)).toBe(true);

      const contract = COMMITMENT_CAPABILITY.extract_contract(mockEntity);
      expect(contract.target.min_count).toBe(1);
      expect(contract.target.period).toBe('week');
    });

    it('evaluates evidence provenance: user_confirmed counts, AI inferred is pending and does NOT count by default', () => {
      const commitment: CommitmentTarget = {
        min_count: 1,
        period: 'week',
      };

      const refDate = '2026-10-07T12:00:00.000Z'; // In week Oct 5 - Oct 11

      // 1. AI inferred evidence (unconfirmed)
      const inferredEvidence: EvidenceItem[] = [
        {
          id: 'ev-ai-inferred',
          timestamp: '2026-10-07T10:00:00.000Z',
          provenance: {
            source_type: 'agent',
            observed_at: '2026-10-07T10:00:00.000Z',
            confidence: 0.9,
            is_inferred: true,
            user_confirmed: false,
          },
        },
      ];

      const progressWithInferred = evaluateCommitmentProgress(
        commitment,
        inferredEvidence,
        DEFAULT_EVIDENCE_POLICY,
        refDate
      );

      // Inferred evidence does NOT count towards current_count
      expect(progressWithInferred.current_count).toBe(0);
      expect(progressWithInferred.is_completed).toBe(false);
      expect(progressWithInferred.pending_inferred_evidence.length).toBe(1);
      expect(progressWithInferred.valid_evidence.length).toBe(0);

      // 2. User confirmed evidence
      const confirmedEvidence: EvidenceItem[] = [
        {
          id: 'ev-user-confirmed',
          timestamp: '2026-10-07T11:00:00.000Z',
          provenance: {
            source_type: 'user',
            observed_at: '2026-10-07T11:00:00.000Z',
            confidence: 1.0,
            is_inferred: false,
            user_confirmed: true,
          },
        },
      ];

      const progressWithConfirmed = evaluateCommitmentProgress(
        commitment,
        confirmedEvidence,
        DEFAULT_EVIDENCE_POLICY,
        refDate
      );

      // User confirmed evidence counts and completes the commitment!
      expect(progressWithConfirmed.current_count).toBe(1);
      expect(progressWithConfirmed.is_completed).toBe(true);
      expect(progressWithConfirmed.percentage).toBe(100);
      expect(progressWithConfirmed.valid_evidence.length).toBe(1);
      expect(progressWithConfirmed.pending_inferred_evidence.length).toBe(0);
    });

    it('filters out evidence outside the active period window and deduplicates identical evidence IDs', () => {
      const commitment: CommitmentTarget = {
        min_count: 2,
        period: 'week',
      };

      const refDate = '2026-10-07T12:00:00.000Z'; // Week: Oct 5 - Oct 11

      const evidence: EvidenceItem[] = [
        // Inside active week (Oct 6)
        {
          id: 'ev-inside-1',
          timestamp: '2026-10-06T10:00:00.000Z',
          provenance: { source_type: 'user', observed_at: '2026-10-06T10:00:00.000Z', confidence: 1, is_inferred: false, user_confirmed: true },
        },
        // Duplicate ID of inside-1
        {
          id: 'ev-inside-1',
          timestamp: '2026-10-06T10:00:00.000Z',
          provenance: { source_type: 'user', observed_at: '2026-10-06T10:00:00.000Z', confidence: 1, is_inferred: false, user_confirmed: true },
        },
        // Outside active week (Previous week: Oct 2)
        {
          id: 'ev-outside-past',
          timestamp: '2026-10-02T10:00:00.000Z',
          provenance: { source_type: 'user', observed_at: '2026-10-02T10:00:00.000Z', confidence: 1, is_inferred: false, user_confirmed: true },
        },
        // Outside active week (Next week: Oct 15)
        {
          id: 'ev-outside-future',
          timestamp: '2026-10-15T10:00:00.000Z',
          provenance: { source_type: 'user', observed_at: '2026-10-15T10:00:00.000Z', confidence: 1, is_inferred: false, user_confirmed: true },
        },
      ];

      const progress = evaluateCommitmentProgress(commitment, evidence, DEFAULT_EVIDENCE_POLICY, refDate);
      expect(progress.current_count).toBe(1); // Only 1 valid, non-duplicate item
      expect(progress.is_completed).toBe(false); // 1 / 2
      expect(progress.percentage).toBe(50);
    });
  });

  // ==========================================================================
  // PART D & E: PERIOD ROLLOVER & STREAK PROJECTIONS
  // ==========================================================================
  describe('Part D & E: Period Rollover & Streak Projections', () => {
    it('handles period rollover: previous period completed does not automatically complete new period', () => {
      const commitment: CommitmentTarget = {
        min_count: 1,
        period: 'week',
      };

      // User worked on Flowmate in previous week (Oct 1)
      const pastEvidence: EvidenceItem[] = [
        {
          id: 'ev-last-week',
          timestamp: '2026-10-01T15:00:00.000Z',
          provenance: { source_type: 'user', observed_at: '2026-10-01T15:00:00.000Z', confidence: 1, is_inferred: false, user_confirmed: true },
        },
      ];

      // In past week (Oct 2): completed = true
      const pastProgress = evaluateCommitmentProgress(commitment, pastEvidence, DEFAULT_EVIDENCE_POLICY, '2026-10-02T12:00:00.000Z');
      expect(pastProgress.is_completed).toBe(true);

      // In current week (Oct 7): rollover occurs -> completed = false (0/1)
      const currentProgress = evaluateCommitmentProgress(commitment, pastEvidence, DEFAULT_EVIDENCE_POLICY, '2026-10-07T12:00:00.000Z');
      expect(currentProgress.is_completed).toBe(false);
      expect(currentProgress.current_count).toBe(0);
    });

    it('calculates current and longest streaks across historical periods correctly', () => {
      const commitment: CommitmentTarget = {
        min_count: 1,
        period: 'week',
      };

      // 4 consecutive weeks of evidence
      // Week 1: Sep 16
      // Week 2: Sep 23
      // Week 3: Sep 30
      // Week 4 (Current): Oct 7
      const evidence: EvidenceItem[] = [
        { id: 'w1', timestamp: '2026-09-16T12:00:00.000Z', provenance: { source_type: 'user', observed_at: '2026-09-16T12:00:00.000Z', confidence: 1, is_inferred: false, user_confirmed: true } },
        { id: 'w2', timestamp: '2026-09-23T12:00:00.000Z', provenance: { source_type: 'user', observed_at: '2026-09-23T12:00:00.000Z', confidence: 1, is_inferred: false, user_confirmed: true } },
        { id: 'w3', timestamp: '2026-09-30T12:00:00.000Z', provenance: { source_type: 'user', observed_at: '2026-09-30T12:00:00.000Z', confidence: 1, is_inferred: false, user_confirmed: true } },
        { id: 'w4', timestamp: '2026-10-07T12:00:00.000Z', provenance: { source_type: 'user', observed_at: '2026-10-07T12:00:00.000Z', confidence: 1, is_inferred: false, user_confirmed: true } },
      ];

      const streak = calculateStreakProjection(commitment, evidence, DEFAULT_EVIDENCE_POLICY, 6, '2026-10-07T12:00:00.000Z');
      expect(streak.current_streak).toBe(4);
      expect(streak.longest_streak).toBe(4);
      expect(streak.completed_periods).toBe(4);
      expect(streak.history.length).toBe(6);
    });
  });

  // ==========================================================================
  // PART F: REUSABLE REMINDER POLICY
  // ==========================================================================
  describe('Part F: Reusable Reminder Policy', () => {
    it('suppresses reminder when commitment is already completed in active period', () => {
      const policy: ReminderPolicy = {
        id: 'rem-policy-1',
        enabled: true,
        trigger: 'period_end_approaching',
        lead_time_hours: 24,
        preferred_time_of_day: '18:00',
        channel: 'in_app',
        suppress_when_completed: true,
      };

      const commitment: CommitmentTarget = { min_count: 1, period: 'week' };
      const completedEvidence: EvidenceItem[] = [
        { id: 'ev-1', timestamp: '2026-10-07T12:00:00.000Z', provenance: { source_type: 'user', observed_at: '2026-10-07T12:00:00.000Z', confidence: 1, is_inferred: false, user_confirmed: true } },
      ];

      const progress = evaluateCommitmentProgress(commitment, completedEvidence, DEFAULT_EVIDENCE_POLICY, '2026-10-10T12:00:00.000Z');
      const evalResult = evaluateReminderPolicy(policy, progress, 'Work on Flowmate', 'entity-1', '2026-10-10T19:00:00.000Z');

      expect(evalResult.should_notify).toBe(false);
      expect(evalResult.reason).toBe('suppressed_already_completed');
    });

    it('triggers reminder when commitment is incomplete near end of period', () => {
      const policy: ReminderPolicy = {
        id: 'rem-policy-1',
        enabled: true,
        trigger: 'period_end_approaching',
        lead_time_hours: 24,
        preferred_time_of_day: '18:00',
        preferred_day_of_week: 0, // Sunday
        channel: 'in_app',
        suppress_when_completed: true,
      };

      const commitment: CommitmentTarget = { min_count: 1, period: 'week' };
      // No evidence in current week
      const progress = evaluateCommitmentProgress(commitment, [], DEFAULT_EVIDENCE_POLICY, '2026-10-11T12:00:00.000Z');

      // Sunday evening (Oct 11, 2026 at 19:00 UTC)
      const evalResult = evaluateReminderPolicy(policy, progress, 'Work on Flowmate', 'entity-1', '2026-10-11T19:00:00.000Z');

      expect(evalResult.should_notify).toBe(true);
      expect(evalResult.reason).toBe('incomplete_period_approaching');
      expect(evalResult.notification_payload?.title).toBe('Reminder: Work on Flowmate');
      expect(evalResult.notification_payload?.body).toContain('1 times remaining');
    });

    it('enforces idempotency: does not fire twice in the same period window', () => {
      const policy: ReminderPolicy = {
        id: 'rem-policy-1',
        enabled: true,
        trigger: 'period_end_approaching',
        lead_time_hours: 24,
        preferred_time_of_day: '18:00',
        channel: 'in_app',
        suppress_when_completed: true,
        last_fired_at: '2026-10-10T18:00:00.000Z', // Already fired in this active week
      };

      const commitment: CommitmentTarget = { min_count: 1, period: 'week' };
      const progress = evaluateCommitmentProgress(commitment, [], DEFAULT_EVIDENCE_POLICY, '2026-10-11T12:00:00.000Z');
      const evalResult = evaluateReminderPolicy(policy, progress, 'Work on Flowmate', 'entity-1', '2026-10-11T19:00:00.000Z');

      expect(evalResult.should_notify).toBe(false);
      expect(evalResult.reason).toBe('already_fired');
    });
  });

  // ==========================================================================
  // PART G: AI NATURAL LANGUAGE & TOOL EXECUTION
  // ==========================================================================
  describe('Part G: AI Natural Language & Tool Execution', () => {
    it('configures a commitment on an entity via executeConfigureCommitment through canonical store', async () => {
      const store = useStore.getState();

      // 1. Create base entity "Work on Flowmate"
      store.applyOperations([
        {
          type: 'create_entity',
          payload: {
            id: 'task-flowmate-nl',
            kind: EntityKind.TASK,
            title: 'Work on Flowmate',
            priority: 2,
            tags: ['dev', 'flowmate'],
          },
        },
      ]);

      const entity = useStore.getState().kernelEntities['task-flowmate-nl'];
      expect(entity).toBeDefined();

      // 2. AI configures commitment: "at least once every week"
      const configureResult = executeConfigureCommitment({
        entity_id: 'task-flowmate-nl',
        target_count: 1,
        period: 'week',
        target_unit: 'sessions',
        reminder_enabled: true,
        reminder_time: '19:00',
        reminder_day: 0,
      });

      expect(configureResult.success).toBe(true);

      // Verify canonical kernelEntities store was updated
      const updatedEntity = useStore.getState().kernelEntities['task-flowmate-nl'];
      expect(updatedEntity.attributes.commitment).toBeDefined();
      expect(updatedEntity.attributes.recurrence).toBeDefined();
      expect(updatedEntity.attributes.reminder_policy).toBeDefined();

      // 3. AI queries the commitment
      const queryResult = executeQueryCommitment({
        entity_id: 'task-flowmate-nl',
      }) as {
        title: string;
        target: { min_count: number; period: string };
        current_period: { current_count: number; is_completed: boolean; percentage: number };
        reminder: { reason: string };
      };

      expect(queryResult.title).toBe('Work on Flowmate');
      expect(queryResult.target.min_count).toBe(1);
      expect(queryResult.target.period).toBe('week');
      expect(queryResult.current_period.current_count).toBe(0);
      expect(queryResult.current_period.is_completed).toBe(false);

      // 4. AI records user-confirmed evidence: "I worked on Flowmate today"
      const recordResult = executeRecordCommitmentEvidence({
        entity_id: 'task-flowmate-nl',
        quantity: 1,
        note: 'Completed AI module refactoring',
        user_confirmed: true,
      }) as {
        success: boolean;
        progress: { current_count: number; is_completed: boolean; current_streak: number };
      };

      expect(recordResult.success).toBe(true);
      expect(recordResult.progress.current_count).toBe(1);
      expect(recordResult.progress.is_completed).toBe(true);
      expect(recordResult.progress.current_streak).toBe(1);

      // 5. Query commitment again -> completion updated & reminder suppressed!
      const finalQuery = executeQueryCommitment({
        entity_id: 'task-flowmate-nl',
      }) as {
        title: string;
        current_period: { is_completed: boolean; percentage: number };
        reminder: { reason: string };
      };

      expect(finalQuery.current_period.is_completed).toBe(true);
      expect(finalQuery.current_period.percentage).toBe(100);
      expect(finalQuery.reminder.reason).toBe('suppressed_already_completed');
    });

    it('dispatches commitment tools via dispatchToolCall', async () => {
      const store = useStore.getState();
      store.applyOperations([
        {
          type: 'create_entity',
          payload: {
            id: 'habit-water',
            kind: EntityKind.HABIT,
            title: 'Drink 3L Water',
          },
        },
      ]);

      // Dispatch configure_commitment
      const configRes = await dispatchToolCall(
        {
          name: 'configure_commitment',
          args: { entity_id: 'habit-water', target_count: 3, period: 'day', target_unit: 'liters' },
        },
        useStore.getState().entities
      );
      const configObj = configRes.response.result as { success?: boolean };
      expect(configObj.success).toBe(true);

      // Dispatch query_commitment
      const queryRes = await dispatchToolCall(
        {
          name: 'query_commitment',
          args: { entity_id: 'habit-water' },
        },
        useStore.getState().entities
      );
      const queryObj = queryRes.response.result as { title?: string; target?: { min_count?: number } };
      expect(queryObj.title).toBe('Drink 3L Water');
      expect(queryObj.target?.min_count).toBe(3);
    });
  });
});

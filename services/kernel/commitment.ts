/**
 * Flowmate Greenfield Domain Kernel — Commitment, Evidence & Streaks Engine (P1-06)
 *
 * Generic, data-driven domain semantics for commitments, evidence validation,
 * deterministic progress derivation, and streak projections.
 *
 * Pure service: does NOT mutate store, Firestore, or entities directly.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { Provenance, Entity } from './types';
import {
  RecurrenceRule,
  PeriodWindow,
  getPeriodWindow,
  getHistoricalPeriods,
  parseRecurrenceRule,
} from './recurrence';

export type CommitmentPeriod = 'day' | 'week' | 'month' | 'year';

export interface CommitmentTarget {
  min_count: number;
  period: CommitmentPeriod;
  target_unit?: string; // e.g. 'times', 'sessions', 'hours', 'pages'
  recurrence?: RecurrenceRule;
}

export interface EvidenceItem {
  id: string;
  timestamp: string; // ISO 8601 UTC
  quantity?: number; // default 1
  note?: string;
  provenance: Provenance;
}

export interface EvidencePolicy {
  /**
   * If true, evidence where `provenance.user_confirmed === false` will NOT count towards progress.
   * Default: true.
   */
  require_user_confirmed?: boolean;
  /**
   * Minimum confidence score required (0.0 to 1.0).
   * Default: 0.7.
   */
  min_confidence?: number;
  /**
   * Whether to allow inferred evidence at all.
   * Default: false (AI inferences are pending until user confirmed).
   */
  allow_inferred?: boolean;
}

export interface CommitmentProgress {
  period_window: PeriodWindow;
  target_count: number;
  current_count: number;
  unit: string;
  percentage: number;
  is_completed: boolean;
  valid_evidence: EvidenceItem[];
  pending_inferred_evidence: EvidenceItem[];
}

export interface PeriodHistoryEntry {
  window: PeriodWindow;
  count: number;
  target: number;
  is_completed: boolean;
}

export interface StreakProjection {
  current_streak: number;
  longest_streak: number;
  completed_periods: number;
  missed_periods: number;
  history: PeriodHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Helpers: Parse / Validate Commitment Targets & Evidence
// ---------------------------------------------------------------------------

export function parseCommitmentTarget(raw: unknown): CommitmentTarget | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;
  const nestedTarget =
    obj.target && typeof obj.target === 'object' ? (obj.target as Record<string, unknown>) : null;

  const countCandidate = nestedTarget
    ? (nestedTarget.count ?? nestedTarget.min_count)
    : (obj.min_count ?? obj.count ?? obj.frequency_goal);
  const minCount =
    typeof countCandidate === 'number' && Number.isFinite(countCandidate)
      ? Math.max(1, Math.floor(countCandidate))
      : 1;

  const periodCandidate = nestedTarget
    ? (nestedTarget.period ?? nestedTarget.frequency_period)
    : (obj.period ?? obj.frequency_period);
  const rawPeriod = typeof periodCandidate === 'string' ? periodCandidate.toLowerCase() : 'week';

  let period: CommitmentPeriod = 'week';
  if (rawPeriod === 'day' || rawPeriod === 'daily') period = 'day';
  else if (rawPeriod === 'week' || rawPeriod === 'weekly') period = 'week';
  else if (rawPeriod === 'month' || rawPeriod === 'monthly') period = 'month';
  else if (rawPeriod === 'year' || rawPeriod === 'yearly') period = 'year';

  const unitCandidate = nestedTarget
    ? (nestedTarget.unit ?? nestedTarget.target_unit)
    : (obj.target_unit ?? obj.unit);
  const targetUnit = typeof unitCandidate === 'string' ? unitCandidate : 'times';

  let recurrence: RecurrenceRule | undefined;
  if (obj.recurrence) {
    recurrence = parseRecurrenceRule(obj.recurrence) || undefined;
  }
  if (!recurrence) {
    // Generate canonical recurrence matching commitment period
    const cadenceMap: Record<CommitmentPeriod, 'daily' | 'weekly' | 'monthly' | 'yearly'> = {
      day: 'daily',
      week: 'weekly',
      month: 'monthly',
      year: 'yearly',
    };
    recurrence = {
      cadence: cadenceMap[period],
      interval: 1,
      start_date: new Date().toISOString(),
    };
  }

  return {
    min_count: minCount,
    period,
    target_unit: targetUnit,
    recurrence,
  };
}

export function parseEvidenceItems(raw: unknown): EvidenceItem[] {
  if (!Array.isArray(raw)) return [];

  const items: EvidenceItem[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : `evidence-${Date.now()}-${Math.random()}`;
    const timestamp = typeof r.timestamp === 'string' ? r.timestamp : new Date().toISOString();
    const quantity = typeof r.quantity === 'number' && Number.isFinite(r.quantity) ? r.quantity : 1;
    const note = typeof r.note === 'string' ? r.note : undefined;

    let prov: Provenance;
    if (typeof r.provenance === 'object' && r.provenance !== null) {
      const p = r.provenance as Record<string, unknown>;
      prov = {
        source_type: (p.source_type as Provenance['source_type']) || 'user',
        source_id: typeof p.source_id === 'string' ? p.source_id : undefined,
        observed_at: typeof p.observed_at === 'string' ? p.observed_at : timestamp,
        confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 1.0,
        is_inferred: Boolean(p.is_inferred),
        user_confirmed: Boolean(p.user_confirmed),
      };
    } else {
      // Default provenance
      prov = {
        source_type: 'user',
        observed_at: timestamp,
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      };
    }

    items.push({ id, timestamp, quantity, note, provenance: prov });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Pure Evaluation: Progress within Active Period Window
// ---------------------------------------------------------------------------

export const DEFAULT_EVIDENCE_POLICY: EvidencePolicy = {
  require_user_confirmed: true,
  min_confidence: 0.7,
  allow_inferred: false,
};

export function evaluateCommitmentProgress(
  commitment: CommitmentTarget,
  evidence: EvidenceItem[],
  policy: EvidencePolicy = DEFAULT_EVIDENCE_POLICY,
  referenceDate: Date | string = new Date(),
  timezone: string = 'UTC'
): CommitmentProgress {
  const recurrence = commitment.recurrence || {
    cadence: commitment.period === 'day' ? 'daily' : commitment.period === 'month' ? 'monthly' : 'weekly',
    interval: 1,
    start_date: new Date().toISOString(),
  };

  const periodWindow = getPeriodWindow(recurrence, referenceDate, timezone);
  const windowStart = new Date(periodWindow.start).getTime();
  const windowEnd = new Date(periodWindow.end).getTime();

  const requireConfirmed = policy.require_user_confirmed ?? true;
  const minConfidence = policy.min_confidence ?? 0.7;
  const allowInferred = policy.allow_inferred ?? false;

  const validEvidence: EvidenceItem[] = [];
  const pendingInferred: EvidenceItem[] = [];
  const seenIds = new Set<string>();

  let currentCount = 0;

  for (const item of evidence) {
    // 1. Deduplication guard
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);

    // 2. Temporal window guard: Must fall within the period [start, end]
    const itemTime = new Date(item.timestamp).getTime();
    if (isNaN(itemTime) || itemTime < windowStart || itemTime > windowEnd) {
      continue;
    }

    // 3. Provenance evaluation
    const p = item.provenance;
    const meetsConfidence = p.confidence >= minConfidence;

    if (p.is_inferred && !p.user_confirmed) {
      // It's inferred and unconfirmed
      pendingInferred.push(item);
      if (allowInferred && meetsConfidence) {
        validEvidence.push(item);
        currentCount += item.quantity || 1;
      }
    } else {
      // Either user_confirmed or direct observation
      if (!requireConfirmed || p.user_confirmed || p.source_type === 'user') {
        if (meetsConfidence) {
          validEvidence.push(item);
          currentCount += item.quantity || 1;
        }
      }
    }
  }

  const target = commitment.min_count;
  const percentage = target > 0 ? Math.min(100, Math.round((currentCount / target) * 100)) : 0;
  const isCompleted = currentCount >= target;

  return {
    period_window: periodWindow,
    target_count: target,
    current_count: currentCount,
    unit: commitment.target_unit || 'times',
    percentage,
    is_completed: isCompleted,
    valid_evidence: validEvidence,
    pending_inferred_evidence: pendingInferred,
  };
}

// ---------------------------------------------------------------------------
// Pure Projection: Streak Calculation across Historical Periods
// ---------------------------------------------------------------------------

export function calculateStreakProjection(
  commitment: CommitmentTarget,
  evidence: EvidenceItem[],
  policy: EvidencePolicy = DEFAULT_EVIDENCE_POLICY,
  periodCount: number = 10,
  referenceDate: Date | string = new Date(),
  timezone: string = 'UTC'
): StreakProjection {
  const recurrence = commitment.recurrence || {
    cadence: commitment.period === 'day' ? 'daily' : commitment.period === 'month' ? 'monthly' : 'weekly',
    interval: 1,
    start_date: new Date().toISOString(),
  };

  const historicalWindows = getHistoricalPeriods(recurrence, periodCount, referenceDate, timezone);
  const history: PeriodHistoryEntry[] = [];

  let completedPeriods = 0;
  let missedPeriods = 0;

  // Evaluate each historical window
  for (const win of historicalWindows) {
    const progress = evaluateCommitmentProgress(
      commitment,
      evidence,
      policy,
      new Date(win.start),
      timezone
    );

    const isCompleted = progress.is_completed;
    if (isCompleted) {
      completedPeriods++;
    } else {
      missedPeriods++;
    }

    history.push({
      window: win,
      count: progress.current_count,
      target: progress.target_count,
      is_completed: isCompleted,
    });
  }

  // Calculate streaks
  // History is chronological from oldest to newest (the current window is the last entry)
  let currentStreak = 0;
  let longestStreak = 0;
  let runningStreak = 0;

  for (let i = 0; i < history.length; i++) {
    if (history[i].is_completed) {
      runningStreak++;
      if (runningStreak > longestStreak) {
        longestStreak = runningStreak;
      }
    } else {
      // If this is the current active period, lack of completion yet doesn't break a streak
      // unless the period has elapsed. But for simple streak derivation, if incomplete, resets running streak.
      runningStreak = 0;
    }
  }

  // To find current streak: walk backwards from the most recent period
  // If the current period is incomplete, but the previous one was complete, the streak is alive.
  let backwardIdx = history.length - 1;
  if (backwardIdx >= 0) {
    if (!history[backwardIdx].is_completed) {
      // Check if current period has elapsed or is active
      // For active period, check previous completed streak
      backwardIdx--;
    }
    while (backwardIdx >= 0 && history[backwardIdx].is_completed) {
      currentStreak++;
      backwardIdx--;
    }
  }

  // Longest streak must be at least current streak
  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
  }

  return {
    current_streak: currentStreak,
    longest_streak: longestStreak,
    completed_periods: completedPeriods,
    missed_periods: missedPeriods,
    history,
  };
}

/**
 * Convenience helper to evaluate an Entity directly.
 */
export function evaluateEntityCommitment(
  entity: Entity,
  policy: EvidencePolicy = DEFAULT_EVIDENCE_POLICY,
  referenceDate: Date | string = new Date(),
  timezone: string = 'UTC'
): { progress: CommitmentProgress; streak: StreakProjection } | null {
  const rawCommitment = entity.attributes.commitment || entity.attributes;
  const commitment = parseCommitmentTarget(rawCommitment);
  if (!commitment) return null;

  const evidence = parseEvidenceItems(entity.attributes.evidence);
  const progress = evaluateCommitmentProgress(commitment, evidence, policy, referenceDate, timezone);
  const streak = calculateStreakProjection(commitment, evidence, policy, 6, referenceDate, timezone);

  return { progress, streak };
}


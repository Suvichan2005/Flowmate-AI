import { Entity, EntityKind, RecurrenceType } from '../types';
import { allDayInterval, parseCalendarDate } from './calendarDates';

export type CalendarConflictFreshness =
  | 'active'
  | 'stale_historical'
  | 'estimated_duration'
  | 'tentative'
  | 'sync_unverified';

export type EventTemporalStatus = 'past' | 'ongoing' | 'future';
export type SyncFreshnessStatus = 'recent' | 'stale' | 'unverified' | 'local_only';

export interface CalendarConflict {
  collidingEventId: string;
  collidingEventTitle: string;
  startIso: string;
  endIso: string;
  formattedTimeSpan: string;
  overlapMinutes: number;
  sourceAttribution: string;
  freshnessStatus: CalendarConflictFreshness;
  temporalStatus: EventTemporalStatus;
  syncFreshness: SyncFreshnessStatus;
  isAllDay: boolean;
  schedulingCertainty?: string;
}

export interface CandidateSlot {
  startTimeIso: string;
  endTimeIso: string;
  candidateId?: string;
  isAllDay?: boolean;
}

export interface NormalizedEventInterval {
  entityId: string;
  title: string;
  startMs: number;
  endMs: number;
  startIso: string;
  endIso: string;
  isAllDay: boolean;
  isEstimatedDuration: boolean;
  sourceAttribution: string;
  freshnessStatus: CalendarConflictFreshness;
  temporalStatus: EventTemporalStatus;
  syncFreshness: SyncFreshnessStatus;
  schedulingCertainty?: string;
  originalEntity: Entity;
}

/**
 * Fail-closed deletion & tombstone check adhering to Flowmate's storage and kernel contracts.
 */
export function isEventTombstoned(entity: Entity): boolean {
  if ((entity as any).deleted === true) return true;
  if (entity.metadata?.deleted === true) return true;
  if (entity.metadata?.tombstone === true) return true;
  if (entity.metadata?.deleted_at !== null && entity.metadata?.deleted_at !== undefined) return true;

  const lifecycle = (entity as any).lifecycle;
  if (lifecycle) {
    if (lifecycle.status === 'deleted') return true;
    if (lifecycle.deleted_at !== null && lifecycle.deleted_at !== undefined) return true;
  }

  if ((entity as any).status === 'deleted') return true;
  return false;
}

/**
 * Detects whether an entity is marked as an all-day event across all native and import shapes.
 * Recognizes services/googleSync.ts (metadata.is_all_day), kernel metadata (all_day), and top-level fields.
 */
export function isEventAllDay(entity: Entity): boolean {
  return Boolean(
    (entity as any).all_day ||
    (entity as any).is_all_day ||
    entity.metadata?.all_day ||
    entity.metadata?.is_all_day
  );
}

/**
 * Normalizes entity source attribution into a transparent, calm source description.
 */
export function getEventSourceAttribution(entity: Entity): string {
  const meta = entity.metadata || {};
  if (meta.source) return String(meta.source);
  if (meta.source_type) return String(meta.source_type);
  if (meta.sync_provider === 'google' || meta.gcal_id || meta.gcal_link || meta.google_calendar_id) return 'Google Calendar';
  if (meta.origin) return String(meta.origin);
  if (entity.id.startsWith('kernel-') || entity.id.startsWith('sys-')) return 'Kernel Schedule';
  return 'Local Graph';
}

/**
 * Format a human-readable 24h / local time span (e.g. "14:00 - 15:30")
 */
export function formatLocalTimeSpan(start: Date, end: Date, isAllDay: boolean): string {
  if (isAllDay) return 'All Day';

  const pad = (n: number) => n.toString().padStart(2, '0');
  const startStr = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const endStr = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  const isSameDay = start.toDateString() === end.toDateString();

  if (isSameDay) {
    return `${startStr} – ${endStr}`;
  }
  return `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${startStr} – ${end.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${endStr}`;
}

/**
 * Normalizes an EVENT entity into a verified, timezone-safe time interval.
 * Returns null if the entity is not an eligible, non-deleted EVENT with a valid start time.
 */
export function getNormalizedEventInterval(
  entity: Entity,
  nowMs: number = Date.now()
): NormalizedEventInterval | null {
  if (entity.kind !== EntityKind.EVENT) return null;
  if (isEventTombstoned(entity)) return null;

  const startRaw = entity.start_time;
  if (!startRaw) return null;

  const existStart = parseCalendarDate(startRaw);
  if (!existStart) return null;
  const existStartMs = existStart.getTime();
  if (isNaN(existStartMs)) return null;

  const isAllDay = isEventAllDay(entity);
  let startMs: number;
  let endMs: number;
  let isEstimatedDuration = false;

  if (isAllDay) {
    const range = allDayInterval(startRaw, entity.end_time);
    if (!range) return null;
    ({ startMs, endMs } = range);
  } else {
    startMs = existStartMs;
    if (entity.end_time) {
      const parsedEnd = new Date(entity.end_time).getTime();
      if (!isNaN(parsedEnd) && parsedEnd > startMs) {
        endMs = parsedEnd;
      } else {
        const dur = typeof entity.duration_minutes === 'number' && Number.isFinite(entity.duration_minutes) && entity.duration_minutes > 0 ? entity.duration_minutes : 60;
        endMs = startMs + dur * 60 * 1000;
        isEstimatedDuration = true;
      }
    } else {
      const dur = typeof entity.duration_minutes === 'number' && Number.isFinite(entity.duration_minutes) && entity.duration_minutes > 0 ? entity.duration_minutes : 60;
      endMs = startMs + dur * 60 * 1000;
      isEstimatedDuration = true;
    }
  }

  if (!Number.isFinite(endMs) || Math.abs(endMs) > 8.64e15) return null;

  // Temporal status: event-in-the-past vs ongoing vs future
  let temporalStatus: EventTemporalStatus = 'ongoing';
  if (endMs <= nowMs) {
    temporalStatus = 'past';
  } else if (startMs > nowMs) {
    temporalStatus = 'future';
  }

  // Data / Sync Freshness (distinguish event-in-the-past from data freshness)
  const meta = entity.metadata || {};
  const isGoogleSource = meta.source === 'google_calendar' || meta.sync_provider === 'google' || Boolean(meta.google_calendar_id);
  let syncFreshness: SyncFreshnessStatus = 'local_only';
  if (isGoogleSource) {
    const syncTimeStr = meta.synced_at || meta.last_synced;
    if (syncTimeStr) {
      const syncMs = new Date(syncTimeStr).getTime();
      if (!isNaN(syncMs)) {
        // Bounded clock-skew allowance: up to 5 minutes into the future
        const ALLOWED_CLOCK_SKEW_MS = 5 * 60 * 1000;
        if (syncMs > nowMs + ALLOWED_CLOCK_SKEW_MS) {
          // Future timestamps cannot establish verified recent synchronization
          syncFreshness = 'unverified';
        } else {
          const syncAgeHours = (nowMs - syncMs) / (1000 * 60 * 60);
          syncFreshness = syncAgeHours <= 24 ? 'recent' : 'stale';
        }
      } else {
        syncFreshness = 'unverified';
      }
    } else {
      syncFreshness = 'unverified';
    }
  }

  const certainty = meta.scheduling_certainty || (entity as any).scheduling_certainty;

  // Freshness status label for user-facing badges
  let freshnessStatus: CalendarConflictFreshness = 'active';
  if (temporalStatus === 'past') {
    freshnessStatus = 'stale_historical';
  } else if (certainty === 'tentative') {
    freshnessStatus = 'tentative';
  } else if (isEstimatedDuration) {
    freshnessStatus = 'estimated_duration';
  } else if (syncFreshness === 'unverified') {
    freshnessStatus = 'active';
  }

  return {
    entityId: entity.id,
    title: entity.title || 'Untitled Event',
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    isAllDay,
    isEstimatedDuration,
    sourceAttribution: getEventSourceAttribution(entity),
    freshnessStatus,
    temporalStatus,
    syncFreshness,
    schedulingCertainty: certainty,
    originalEntity: entity
  };
}

/**
 * Discovers entity IDs that collide with at least one other eligible event.
 * Shared interval and eligibility contract for calendar and scheduling views.
 */
export function findCollidingEventIds(
  entities: Entity[],
  nowMs: number = Date.now()
): Set<string> {
  const intervals: NormalizedEventInterval[] = [];
  for (const entity of entities) {
    const interval = getNormalizedEventInterval(entity, nowMs);
    if (interval) {
      intervals.push(interval);
    }
  }

  const collidingIds = new Set<string>();

  for (let i = 0; i < intervals.length; i++) {
    const a = intervals[i];
    for (let j = i + 1; j < intervals.length; j++) {
      const b = intervals[j];
      // Collision condition: startA < endB && endA > startB
      if (a.startMs < b.endMs && a.endMs > b.startMs) {
        collidingIds.add(a.entityId);
        collidingIds.add(b.entityId);
      }
    }
  }

  return collidingIds;
}

/**
 * Supports both simple recurrence (DAILY/WEEKLY/MONTHLY/YEARLY) and RRULE-style patterns.
 * Shared canonical implementation across CalendarView and calendar conflict detection.
 */
export function matchesRecurrence(
  originalDate: Date,
  targetDate: Date,
  recurrence?: RecurrenceType | string | null,
  rrule?: string
): boolean {
  if (!recurrence && !rrule) return false;

  const origDateOnly = new Date(originalDate.getFullYear(), originalDate.getMonth(), originalDate.getDate());
  const targetDateOnly = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

  if (!Number.isFinite(origDateOnly.getTime()) || !Number.isFinite(targetDateOnly.getTime()) || targetDateOnly < origDateOnly) return false;

  const origDay = originalDate.getDate();
  const origMonth = originalDate.getMonth();
  const origDayOfWeek = originalDate.getDay();

  if (rrule) {
    const bydayMatch = rrule.match(/BYDAY=(-?\d)?(\w{2})/);
    if (bydayMatch) {
      const weekNum = parseInt(bydayMatch[1] || '0', 10);
      const dayCode = bydayMatch[2];
      const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
      const targetDayOfWeek = dayMap[dayCode];
      const targetWeekOfMonth = Math.ceil(targetDate.getDate() / 7);

      if (targetDayOfWeek !== undefined && targetDate.getDay() === targetDayOfWeek) {
        if (weekNum !== 0) {
          if (weekNum > 0 && targetWeekOfMonth === weekNum) {
            return true;
          }
          if (weekNum < 0) {
            const lastDayOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
            const weeksFromEnd = Math.ceil((lastDayOfMonth - targetDate.getDate() + 1) / 7);
            if (weeksFromEnd === Math.abs(weekNum)) return true;
          }
        } else {
          return true;
        }
      }
      return false;
    }

    const intervalMatch = rrule.match(/INTERVAL=(\d+)/);
    if (intervalMatch && recurrence === 'WEEKLY') {
      const interval = parseInt(intervalMatch[1], 10);
      const calendarDays = (Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()) -
        Date.UTC(originalDate.getFullYear(), originalDate.getMonth(), originalDate.getDate())) / 86400000;
      const weeksDiff = Math.floor(calendarDays / 7);
      return weeksDiff >= 0 && weeksDiff % interval === 0 && targetDate.getDay() === origDayOfWeek;
    }
  }

  const normalizedRec = typeof recurrence === 'string' ? recurrence.toUpperCase() : null;
  switch (normalizedRec) {
    case 'DAILY':
      return targetDateOnly >= origDateOnly;
    case 'WEEKLY':
      return targetDateOnly >= origDateOnly && targetDate.getDay() === origDayOfWeek;
    case 'MONTHLY':
      return targetDate.getDate() === origDay && targetDateOnly >= origDateOnly;
    case 'YEARLY':
      return targetDate.getDate() === origDay && targetDate.getMonth() === origMonth && targetDateOnly >= origDateOnly;
    default:
      return false;
  }
}

/**
 * Detects read-only calendar conflicts for a proposed candidate time slot against existing local entities.
 * Pure function: zero side-effects, zero mutations.
 */
export function findCalendarConflicts(
  candidate: CandidateSlot,
  existingEntities: Entity[],
  nowMs: number = Date.now()
): CalendarConflict[] {
  const validation = validateCandidateSlot(candidate);
  if (!validation.isValid) return [];
  const candStartMs = validation.startMs!;
  const candEndMs = validation.endMs!;

  const conflicts: CalendarConflict[] = [];

  for (const entity of existingEntities) {
    if (candidate.candidateId && entity.id === candidate.candidateId) {
      continue;
    }

    const interval = getNormalizedEventInterval(entity, nowMs);
    if (!interval) continue;

    let directOverlapFound = false;

    // Strict Overlap condition: startA < endB && endA > startB
    if (candStartMs < interval.endMs && candEndMs > interval.startMs) {
      directOverlapFound = true;
      const overlapStart = Math.max(candStartMs, interval.startMs);
      const overlapEnd = Math.min(candEndMs, interval.endMs);
      const overlapMinutes = Math.max(1, Math.round((overlapEnd - overlapStart) / 60000));

      conflicts.push({
        collidingEventId: interval.entityId,
        collidingEventTitle: interval.title,
        startIso: interval.startIso,
        endIso: interval.endIso,
        formattedTimeSpan: formatLocalTimeSpan(new Date(interval.startMs), new Date(interval.endMs), interval.isAllDay),
        overlapMinutes,
        sourceAttribution: interval.sourceAttribution,
        freshnessStatus: interval.freshnessStatus,
        temporalStatus: interval.temporalStatus,
        syncFreshness: interval.syncFreshness,
        isAllDay: interval.isAllDay,
        schedulingCertainty: interval.schedulingCertainty
      });
    }

    // Check recurring projection on candidate day if not already overlapping on base date
    const recType = entity.recurrence || (entity as any).cadence_rrule || entity.metadata?.cadence_rrule;
    const rrule = entity.metadata?.rrule || (entity as any).rrule;
    if (!directOverlapFound && (recType || rrule)) {
      const origDate = new Date(interval.startMs);
      const durationMs = interval.endMs - interval.startMs;
      // Include occurrences beginning before the candidate (e.g. yesterday at 23:00).
      // Step in local calendar days so DST cannot shift the series' wall clock.
      const candDate = new Date(Math.max(interval.startMs, candStartMs - durationMs));
      candDate.setHours(0, 0, 0, 0);
      for (; candDate.getTime() < candEndMs; candDate.setDate(candDate.getDate() + 1)) {
        if (!matchesRecurrence(origDate, candDate, recType, rrule)) continue;
        const occStart = new Date(candDate);
        if (interval.isAllDay) {
          occStart.setHours(0, 0, 0, 0);
        } else {
          occStart.setHours(origDate.getHours(), origDate.getMinutes(), origDate.getSeconds(), origDate.getMilliseconds());
        }
        const occStartMs = occStart.getTime();
        const occEnd = new Date(occStart);
        if (interval.isAllDay) {
          const originalEnd = new Date(interval.endMs);
          const days = Math.round((Date.UTC(originalEnd.getFullYear(), originalEnd.getMonth(), originalEnd.getDate()) -
            Date.UTC(origDate.getFullYear(), origDate.getMonth(), origDate.getDate())) / 86400000);
          occEnd.setDate(occEnd.getDate() + days);
        } else {
          occEnd.setTime(occStartMs + durationMs);
        }
        const occEndMs = occEnd.getTime();

        if (candStartMs < occEndMs && candEndMs > occStartMs) {
          const overlapStart = Math.max(candStartMs, occStartMs);
          const overlapEnd = Math.min(candEndMs, occEndMs);
          const overlapMinutes = Math.max(1, Math.round((overlapEnd - overlapStart) / 60000));

          conflicts.push({
            collidingEventId: interval.entityId,
            collidingEventTitle: `${interval.title} (Recurring)`,
            startIso: new Date(occStartMs).toISOString(),
            endIso: new Date(occEndMs).toISOString(),
            formattedTimeSpan: formatLocalTimeSpan(new Date(occStartMs), new Date(occEndMs), interval.isAllDay),
            overlapMinutes,
            sourceAttribution: interval.sourceAttribution,
            freshnessStatus: interval.freshnessStatus,
            temporalStatus: occEndMs <= nowMs ? 'past' : occStartMs > nowMs ? 'future' : 'ongoing',
            syncFreshness: interval.syncFreshness,
            isAllDay: interval.isAllDay,
            schedulingCertainty: interval.schedulingCertainty
          });
          break; // One actionable warning per source event, even if multiple occurrences overlap.
        }
      }
    }
  }

  // Sort conflicts by start time
  return conflicts.sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime());
}

export type CandidateSlotStatus = 'clear' | 'conflict' | 'invalid_interval';

export interface CandidateSlotValidation {
  isValid: boolean;
  error?: string;
  startMs?: number;
  endMs?: number;
}

/**
 * Validates candidate slot intervals (detects reversed, invalid date, or malformed time spans).
 */
export function validateCandidateSlot(candidate: CandidateSlot): CandidateSlotValidation {
  if (!candidate.startTimeIso || !candidate.endTimeIso) {
    return { isValid: false, error: 'Missing start or end time' };
  }
  const start = new Date(candidate.startTimeIso);
  const end = new Date(candidate.endTimeIso);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (isNaN(startMs) || isNaN(endMs)) {
    return { isValid: false, error: 'Invalid ISO date string' };
  }

  if (candidate.isAllDay) {
    const range = allDayInterval(candidate.startTimeIso, candidate.endTimeIso);
    if (!range) return { isValid: false, error: 'Invalid or reversed all-day interval' };
    return { isValid: true, ...range };
  }

  if (endMs <= startMs) {
    return { isValid: false, error: 'End time must be after start time' };
  }
  return { isValid: true, startMs, endMs };
}

export interface CandidateSlotEvaluation {
  status: CandidateSlotStatus;
  validationError?: string;
  conflicts: CalendarConflict[];
}

/**
 * Evaluates candidate slot and distinguishes clear slot from invalid/reversed intervals.
 * Never turns an invalid or reversed interval into a false clear-slot claim.
 */
export function evaluateCandidateSlot(
  candidate: CandidateSlot,
  existingEntities: Entity[],
  nowMs: number = Date.now()
): CandidateSlotEvaluation {
  const validation = validateCandidateSlot(candidate);
  if (!validation.isValid) {
    return {
      status: 'invalid_interval',
      validationError: validation.error,
      conflicts: []
    };
  }

  const conflicts = findCalendarConflicts(candidate, existingEntities, nowMs);
  return {
    status: conflicts.length > 0 ? 'conflict' : 'clear',
    conflicts
  };
}

export interface EarliestFreeSlotResult {
  startTimeIso: string;
  endTimeIso: string;
  durationMinutes: number;
  displacementMinutes: number;
}

/**
 * Pure heuristic: Earliest Adjacent Non-Colliding Window
 * Finds the earliest non-colliding slot of matching duration starting after target startMs.
 */
export function findEarliestFreeSlot(
  candidate: CandidateSlot,
  existingEntities: Entity[],
  maxLookaheadHours: number = 8
): EarliestFreeSlotResult | null {
  const validation = validateCandidateSlot(candidate);
  if (!validation.isValid || validation.startMs === undefined || validation.endMs === undefined) return null;

  const durationMs = validation.endMs - validation.startMs;
  const stepMs = 15 * 60 * 1000; // 15-minute search quantization
  const maxSearchMs = validation.startMs + maxLookaheadHours * 60 * 60 * 1000;

  let currentStart = validation.startMs + stepMs;
  while (currentStart + durationMs <= maxSearchMs) {
    const candidateProbe: CandidateSlot = {
      startTimeIso: new Date(currentStart).toISOString(),
      endTimeIso: new Date(currentStart + durationMs).toISOString(),
      candidateId: candidate.candidateId,
      isAllDay: false
    };
    const conflicts = findCalendarConflicts(candidateProbe, existingEntities, validation.startMs);
    if (conflicts.length === 0) {
      return {
        startTimeIso: candidateProbe.startTimeIso,
        endTimeIso: candidateProbe.endTimeIso,
        durationMinutes: Math.round(durationMs / 60000),
        displacementMinutes: Math.round((currentStart - validation.startMs) / 60000)
      };
    }
    currentStart += stepMs;
  }
  return null;
}

export interface FocusSessionConflictWarning {
  hasConflict: boolean;
  validationError?: string;
  isEventOngoing: boolean;
  collidingEvent?: CalendarConflict;
  conflicts: CalendarConflict[];
  suggestedDurationMinutes?: number;
  minutesUntilNextEvent?: number;
}

/**
 * Evaluates whether launching a focus session of specified duration
 * collides with any calendar events.
 *
 * Invariants:
 * - Pure function, zero side effects
 * - Respects tombstoned entity exclusion
 * - Accurately differentiates ongoing events vs upcoming events
 * - Recommends fitting duration if window before event is > 0
 */
export function checkFocusSessionConflicts(
  targetDurationMinutes: number,
  existingEntities: Entity[],
  nowMs: number = Date.now(),
  candidateId?: string
): FocusSessionConflictWarning {
  const endMs = nowMs + targetDurationMinutes * 60000;
  if (!Number.isFinite(targetDurationMinutes) || targetDurationMinutes <= 0 ||
      !Number.isFinite(nowMs) || Math.abs(nowMs) > 8.64e15 ||
      !Number.isFinite(endMs) || Math.abs(endMs) > 8.64e15 || endMs <= nowMs) {
    return { hasConflict: false, validationError: 'Invalid focus interval', isEventOngoing: false, conflicts: [] };
  }

  const startTimeIso = new Date(nowMs).toISOString();
  const endTimeIso = new Date(endMs).toISOString();

  const candidate: CandidateSlot = {
    startTimeIso,
    endTimeIso,
    candidateId,
    isAllDay: false
  };

  const conflicts = findCalendarConflicts(candidate, existingEntities, nowMs);

  if (conflicts.length === 0) {
    return {
      hasConflict: false,
      isEventOngoing: false,
      conflicts: []
    };
  }

  // Sort conflicts by start time ascending
  const sorted = [...conflicts].sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime());
  const primary = sorted[0];
  const primaryStartMs = new Date(primary.startIso).getTime();

  const isEventOngoing = primaryStartMs <= nowMs;
  let minutesUntilNextEvent: number | undefined;
  let suggestedDurationMinutes: number | undefined;

  if (!isEventOngoing) {
    minutesUntilNextEvent = Math.max(0, Math.floor((primaryStartMs - nowMs) / 60000));
    if (minutesUntilNextEvent > 0 && minutesUntilNextEvent < targetDurationMinutes) {
      suggestedDurationMinutes = minutesUntilNextEvent;
    }
  }

  return {
    hasConflict: true,
    isEventOngoing,
    collidingEvent: primary,
    conflicts: sorted,
    minutesUntilNextEvent,
    suggestedDurationMinutes
  };
}

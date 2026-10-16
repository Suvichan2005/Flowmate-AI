import { Entity, EntityKind, EntityStatus } from '../types';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Date-only values describe a local calendar day; timestamps describe an instant. */
export function parseCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (DATE_ONLY.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatLocalDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getDeadlineState(value: string | null | undefined, now = new Date()): 'invalid' | 'overdue' | 'today' | 'upcoming' {
  const date = parseCalendarDate(value);
  if (!date || !Number.isFinite(now.getTime())) return 'invalid';
  if (DATE_ONLY.test(value!)) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    if (date < today) return 'overdue';
  } else if (date < now) {
    return 'overdue';
  }
  return formatLocalDate(date) === formatLocalDate(now) ? 'today' : 'upcoming';
}

/** Existing triage policy: overdue tasks advance from today; future tasks from their deadline.
 * Keep date-only precision, and advance timestamps by a local day rather than 24 hours.
 * Nonexistent/ambiguous DST wall times follow native Date's compatible disambiguation.
 */
export function deferDeadline(value: string, now = new Date()): string | null {
  const current = parseCalendarDate(value);
  if (!current || !Number.isFinite(now.getTime())) return null;
  const next = new Date(current < now ? now : current);
  next.setDate(next.getDate() + 1);
  if (DATE_ONLY.test(value)) return formatLocalDate(next);
  if (current < now) next.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds());
  return next.toISOString();
}

/** Keep existing all-deadlines chronological view, including distant goals/projects. */
export function selectDueEntities(entities: Entity[]): Entity[] {
  return entities.filter(entity =>
    [EntityKind.TASK, EntityKind.GOAL, EntityKind.PROJECT].includes(entity.kind) &&
    ![EntityStatus.COMPLETED, EntityStatus.ARCHIVED, EntityStatus.CANCELED].includes(entity.status) &&
    parseCalendarDate(entity.deadline) !== null
  ).sort((a, b) => parseCalendarDate(a.deadline)!.getTime() - parseCalendarDate(b.deadline)!.getTime());
}

/** Half-open local all-day range. Midnight end is exclusive; legacy same-day UI
 * values and non-midnight end dates cover their complete local calendar day.
 */
export function allDayInterval(startValue: string, endValue?: string | null): { startMs: number; endMs: number } | null {
  const start = parseCalendarDate(startValue);
  const end = endValue ? parseCalendarDate(endValue) : null;
  if (!start || (endValue && !end)) return null;
  start.setHours(0, 0, 0, 0);
  const next = new Date(start); next.setDate(next.getDate() + 1);
  if (!end) return { startMs: start.getTime(), endMs: next.getTime() };
  if (end.getTime() < start.getTime()) return null;
  if (end.getTime() === start.getTime()) return { startMs: start.getTime(), endMs: next.getTime() };
  if (end.getHours() || end.getMinutes() || end.getSeconds() || end.getMilliseconds()) {
    end.setDate(end.getDate() + 1);
    end.setHours(0, 0, 0, 0);
  }
  return { startMs: start.getTime(), endMs: end.getTime() };
}

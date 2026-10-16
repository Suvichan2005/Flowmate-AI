/**
 * Flowmate Greenfield Domain Kernel — Recurrence Engine (P1-06)
 *
 * Deterministic, platform-independent recurrence evaluation engine.
 * Pure service: does NOT mutate store, Firestore, or entities directly.
 *
 * STRICT INVARIANT: ZERO `any`
 */

export type RecurrenceCadence = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  cadence: RecurrenceCadence;
  interval?: number; // default 1 (e.g. every 2 weeks)
  days_of_week?: number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  day_of_month?: number; // 1..31
  start_date: string; // ISO 8601 string (e.g. '2026-10-01T00:00:00.000Z' or '2026-10-01')
  end_date?: string | null; // ISO 8601 string or null
  timezone?: string; // IANA timezone, e.g. 'UTC', 'America/New_York'
  count?: number; // Optional maximum total occurrences
}

export interface PeriodWindow {
  start: string; // ISO 8601 UTC
  end: string; // ISO 8601 UTC
  index: number; // 0-based offset or sequence index
  label: string; // e.g. 'Week of Oct 5 - Oct 11, 2026' or '2026-W41'
  cadence: RecurrenceCadence;
}

// ---------------------------------------------------------------------------
// Helper: Parse string or partial object into a validated RecurrenceRule
// ---------------------------------------------------------------------------

export function parseRecurrenceRule(
  raw: unknown,
  fallbackStartDate?: string
): RecurrenceRule | null {
  if (!raw) return null;

  const nowIso = fallbackStartDate || new Date().toISOString();

  // 1. If raw is a string (e.g. 'WEEKLY', 'DAILY', or RRULE string 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU,MO')
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toUpperCase();

    if (trimmed === 'DAILY' || trimmed === 'DAY') {
      return { cadence: 'daily', interval: 1, start_date: nowIso };
    }
    if (trimmed === 'WEEKLY' || trimmed === 'WEEK') {
      return { cadence: 'weekly', interval: 1, start_date: nowIso };
    }
    if (trimmed === 'MONTHLY' || trimmed === 'MONTH') {
      return { cadence: 'monthly', interval: 1, start_date: nowIso };
    }
    if (trimmed === 'YEARLY' || trimmed === 'YEAR') {
      return { cadence: 'yearly', interval: 1, start_date: nowIso };
    }

    // Parse simple RFC 5545 RRULE
    const freqMatch = trimmed.match(/FREQ=(\w+)/i);
    if (freqMatch) {
      const freq = freqMatch[1].toLowerCase();
      let cadence: RecurrenceCadence = 'weekly';
      if (freq === 'daily') cadence = 'daily';
      else if (freq === 'weekly') cadence = 'weekly';
      else if (freq === 'monthly') cadence = 'monthly';
      else if (freq === 'yearly') cadence = 'yearly';

      const intervalMatch = trimmed.match(/INTERVAL=(\d+)/i);
      const interval = intervalMatch ? Math.max(1, parseInt(intervalMatch[1], 10)) : 1;

      const byDayMatch = trimmed.match(/BYDAY=([A-Z,]+)/i);
      let daysOfWeek: number[] | undefined;
      if (byDayMatch) {
        const dayMap: Record<string, number> = {
          SU: 0,
          MO: 1,
          TU: 2,
          WE: 3,
          TH: 4,
          FR: 5,
          SA: 6,
        };
        const tokens = byDayMatch[1].split(',');
        daysOfWeek = tokens
          .map((t) => dayMap[t.trim().slice(-2)])
          .filter((d): d is number => typeof d === 'number');
      }

      const untilMatch = trimmed.match(/UNTIL=([0-9TZ]+)/i);
      let endDate: string | undefined;
      if (untilMatch) {
        endDate = untilMatch[1];
      }

      return {
        cadence,
        interval,
        days_of_week: daysOfWeek && daysOfWeek.length > 0 ? daysOfWeek : undefined,
        start_date: nowIso,
        end_date: endDate,
      };
    }

    return null;
  }

  // 2. If raw is an object
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    const rawCadence = typeof obj.cadence === 'string' ? obj.cadence.toLowerCase() : '';
    let cadence: RecurrenceCadence | null = null;
    if (rawCadence === 'daily' || rawCadence === 'day') cadence = 'daily';
    else if (rawCadence === 'weekly' || rawCadence === 'week') cadence = 'weekly';
    else if (rawCadence === 'monthly' || rawCadence === 'month') cadence = 'monthly';
    else if (rawCadence === 'yearly' || rawCadence === 'year') cadence = 'yearly';

    if (!cadence) return null;

    const interval =
      typeof obj.interval === 'number' && Number.isFinite(obj.interval)
        ? Math.max(1, Math.floor(obj.interval))
        : 1;

    let daysOfWeek: number[] | undefined;
    if (Array.isArray(obj.days_of_week)) {
      daysOfWeek = obj.days_of_week
        .filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
        .map((d) => Math.floor(d));
    }

    const dayOfMonth =
      typeof obj.day_of_month === 'number' && obj.day_of_month >= 1 && obj.day_of_month <= 31
        ? Math.floor(obj.day_of_month)
        : undefined;

    const startDate = typeof obj.start_date === 'string' ? obj.start_date : nowIso;
    const endDate = typeof obj.end_date === 'string' ? obj.end_date : null;
    const timezone = typeof obj.timezone === 'string' ? obj.timezone : undefined;
    const count = typeof obj.count === 'number' && obj.count > 0 ? Math.floor(obj.count) : undefined;

    return {
      cadence,
      interval,
      days_of_week: daysOfWeek && daysOfWeek.length > 0 ? daysOfWeek : undefined,
      day_of_month: dayOfMonth,
      start_date: startDate,
      end_date: endDate,
      timezone,
      count,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Period Boundary Calculations
// ---------------------------------------------------------------------------

/**
 * Returns the exact period window covering `targetDate`.
 * Deterministic and timezone-aligned.
 */
export function getPeriodWindow(
  rule: RecurrenceRule,
  targetDate: Date | string = new Date(),
  timezone: string = 'UTC'
): PeriodWindow {
  let d: Date;
  if (targetDate instanceof Date) {
    d = new Date(targetDate.getTime());
  } else if (typeof targetDate === 'string') {
    d = new Date(targetDate);
  } else {
    d = new Date();
  }
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid targetDate: ${String(targetDate)}`);
  }

  const tz = rule.timezone || timezone || 'UTC';
  const cadence = rule.cadence;

  if (cadence === 'daily') {
    // Start of day: 00:00:00.000 UTC
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
    const dateStr = start.toISOString().split('T')[0];
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      index: Math.floor(start.getTime() / (24 * 3600 * 1000)),
      label: `Day ${dateStr}`,
      cadence: 'daily',
    };
  }

  if (cadence === 'weekly') {
    // Week starting Monday (ISO standard):
    // d.getUTCDay(): 0 is Sunday, 1 is Monday ... 6 is Saturday
    const day = d.getUTCDay();
    const diffToMonday = (day + 6) % 7; // Monday = 0, Tuesday = 1, ..., Sunday = 6
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday, 0, 0, 0, 0));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 6, 23, 59, 59, 999));

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    const weekIndex = Math.floor(start.getTime() / (7 * 24 * 3600 * 1000));

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      index: weekIndex,
      label: `Week of ${startStr} to ${endStr}`,
      cadence: 'weekly',
    };
  }

  if (cadence === 'monthly') {
    // 1st of month to last day of month
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    // Day 0 of next month is last day of current month
    const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthIndex = year * 12 + month;

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      index: monthIndex,
      label: `Month of ${monthStr}`,
      cadence: 'monthly',
    };
  }

  // Yearly
  const year = d.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    index: year,
    label: `Year ${year}`,
    cadence: 'yearly',
  };
}

/**
 * Returns a list of past N periods ending at the current period window.
 * Useful for streak and history projection.
 */
export function getHistoricalPeriods(
  rule: RecurrenceRule,
  count: number = 5,
  referenceDate: Date | string = new Date(),
  timezone: string = 'UTC'
): PeriodWindow[] {
  const currentWindow = getPeriodWindow(rule, referenceDate, timezone);
  const periods: PeriodWindow[] = [];
  const safeCount = Math.max(1, Math.min(52, count));

  let currentRef = new Date(currentWindow.start);

  for (let i = 0; i < safeCount; i++) {
    const window = getPeriodWindow(rule, currentRef, timezone);
    periods.unshift(window);

    // Step backwards by 1 period
    if (rule.cadence === 'daily') {
      currentRef = new Date(Date.UTC(currentRef.getUTCFullYear(), currentRef.getUTCMonth(), currentRef.getUTCDate() - 1, 12, 0, 0));
    } else if (rule.cadence === 'weekly') {
      currentRef = new Date(Date.UTC(currentRef.getUTCFullYear(), currentRef.getUTCMonth(), currentRef.getUTCDate() - 7, 12, 0, 0));
    } else if (rule.cadence === 'monthly') {
      currentRef = new Date(Date.UTC(currentRef.getUTCFullYear(), currentRef.getUTCMonth() - 1, 15, 12, 0, 0));
    } else {
      currentRef = new Date(Date.UTC(currentRef.getUTCFullYear() - 1, 6, 1, 12, 0, 0));
    }
  }

  // Deduplicate by start date
  const seen = new Set<string>();
  const uniquePeriods: PeriodWindow[] = [];
  for (const p of periods) {
    if (!seen.has(p.start)) {
      seen.add(p.start);
      uniquePeriods.push(p);
    }
  }

  return uniquePeriods;
}

// ---------------------------------------------------------------------------
// Occurrence Calculations (Next, Previous, Range)
// ---------------------------------------------------------------------------

/**
 * Calculates all occurrences within [rangeStart, rangeEnd].
 */
export function getOccurrences(
  rule: RecurrenceRule,
  rangeStart: Date | string,
  rangeEnd: Date | string,
  timezone: string = 'UTC'
): string[] {
  const start = typeof rangeStart === 'string' ? new Date(rangeStart) : rangeStart;
  const end = typeof rangeEnd === 'string' ? new Date(rangeEnd) : rangeEnd;
  const ruleStart = new Date(rule.start_date);
  const ruleEnd = rule.end_date ? new Date(rule.end_date) : null;

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || isNaN(ruleStart.getTime())) {
    return [];
  }

  const effectiveStart = start.getTime() < ruleStart.getTime() ? ruleStart : start;
  const effectiveEnd = ruleEnd && ruleEnd.getTime() < end.getTime() ? ruleEnd : end;

  if (effectiveStart.getTime() > effectiveEnd.getTime()) {
    return [];
  }

  const results: string[] = [];
  const interval = rule.interval || 1;
  const selectedDays = rule.days_of_week && rule.days_of_week.length > 0 ? new Set(rule.days_of_week) : null;

  let cursor = new Date(ruleStart.getTime());
  const maxIterations = 500;
  let iterations = 0;

  while (cursor.getTime() <= effectiveEnd.getTime() && iterations < maxIterations) {
    iterations++;

    if (cursor.getTime() >= effectiveStart.getTime()) {
      if (!selectedDays || selectedDays.has(cursor.getUTCDay())) {
        results.push(cursor.toISOString());
        if (rule.count && results.length >= rule.count) break;
      }
    }

    // Advance cursor
    if (rule.cadence === 'daily') {
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + interval, cursor.getUTCHours(), cursor.getUTCMinutes()));
    } else if (rule.cadence === 'weekly') {
      if (selectedDays && selectedDays.size > 0) {
        // Step day by day until next matching day, incrementing interval on Sunday rollover
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1, cursor.getUTCHours(), cursor.getUTCMinutes()));
      } else {
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 7 * interval, cursor.getUTCHours(), cursor.getUTCMinutes()));
      }
    } else if (rule.cadence === 'monthly') {
      const targetDay = rule.day_of_month || ruleStart.getUTCDate();
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + interval, targetDay, cursor.getUTCHours(), cursor.getUTCMinutes()));
    } else {
      cursor = new Date(Date.UTC(cursor.getUTCFullYear() + interval, cursor.getUTCMonth(), cursor.getUTCDate(), cursor.getUTCHours(), cursor.getUTCMinutes()));
    }
  }

  return results;
}

/**
 * Finds the earliest occurrence strictly after `fromDate`.
 */
export function getNextOccurrence(
  rule: RecurrenceRule,
  fromDate: Date | string = new Date(),
  timezone: string = 'UTC'
): string | null {
  const from = typeof fromDate === 'string' ? new Date(fromDate) : fromDate;
  if (isNaN(from.getTime())) return null;

  // Search forward up to 1 year
  const searchEnd = new Date(from.getTime() + 366 * 24 * 3600 * 1000);
  const occurrences = getOccurrences(rule, from, searchEnd, timezone);

  for (const occ of occurrences) {
    if (new Date(occ).getTime() > from.getTime()) {
      return occ;
    }
  }

  return null;
}

/**
 * Finds the latest occurrence strictly before `fromDate`.
 */
export function getPreviousOccurrence(
  rule: RecurrenceRule,
  fromDate: Date | string = new Date(),
  timezone: string = 'UTC'
): string | null {
  const from = typeof fromDate === 'string' ? new Date(fromDate) : fromDate;
  if (isNaN(from.getTime())) return null;

  const ruleStart = new Date(rule.start_date);
  if (from.getTime() <= ruleStart.getTime()) return null;

  const occurrences = getOccurrences(rule, ruleStart, from, timezone);
  let latest: string | null = null;

  for (const occ of occurrences) {
    if (new Date(occ).getTime() < from.getTime()) {
      latest = occ;
    }
  }

  return latest;
}


import { describe, expect, it } from 'vitest';
import { Entity, EntityKind } from '../types';
import { checkFocusSessionConflicts, evaluateCandidateSlot, findCalendarConflicts, getNormalizedEventInterval, matchesRecurrence, validateCandidateSlot } from '../utils/calendarConflicts';

const event = (start: string, end?: string, extra: Partial<Entity> = {}): Entity =>
  ({ id: 'event', title: 'Fixture', kind: EntityKind.EVENT, start_time: start, end_time: end, ...extra } as Entity);
const local = (day: number, hour = 0) => new Date(2026, 2, day, hour).toISOString();

describe('Calendar reliability: half-open intervals and local days', () => {
  it('preserves an exclusive midnight all-day candidate end', () => {
    const candidate = { startTimeIso: local(8), endTimeIso: local(9), isAllDay: true };
    expect(validateCandidateSlot(candidate).endMs).toBe(Date.parse(local(9)));
    expect(findCalendarConflicts(candidate, [event(local(9, 10), local(9, 11))])).toEqual([]);
  });
  it('interprets an all-day date-only start as that local calendar day', () => {
    const interval = getNormalizedEventInterval(event('2026-03-08', undefined, { metadata: { all_day: true } }));
    expect(interval?.startMs).toBe(new Date(2026, 2, 8).getTime());
    expect(interval?.endMs).toBe(new Date(2026, 2, 9).getTime());
  });
  it('covers the final millisecond of an all-day event using an exclusive next midnight', () => {
    expect(findCalendarConflicts({ startTimeIso: new Date(Date.parse(local(9)) - 1).toISOString(), endTimeIso: local(9) },
      [event(local(8), undefined, { metadata: { all_day: true } })])).toHaveLength(1);
  });
  it.each([
    ['2026-10-15T10:00:00Z', '2026-10-15T11:00:00Z', 1],
    ['2026-10-15T09:30:00Z', '2026-10-15T10:30:00Z', 1],
    ['2026-10-15T09:00:00Z', '2026-10-15T12:00:00Z', 1],
    ['2026-10-15T11:00:00Z', '2026-10-15T12:00:00Z', 0],
    ['2026-10-15T09:00:00Z', '2026-10-15T10:00:00Z', 0],
  ])('uses half-open overlap for %s to %s', (start, end, count) => {
    expect(findCalendarConflicts({ startTimeIso: start, endTimeIso: end },
      [event('2026-10-15T10:00:00Z', '2026-10-15T11:00:00Z')])).toHaveLength(count);
  });
  it('excludes self when rescheduling and returns every other overlap', () => {
    const events = ['self', 'a', 'b'].map(id => event(local(8, 10), local(8, 11), { id }));
    expect(findCalendarConflicts({ startTimeIso: local(8, 10), endTimeIso: local(8, 11), candidateId: 'self' }, events).map(x => x.collidingEventId)).toEqual(['a', 'b']);
  });
  it('keeps malformed and zero/reversed candidates invalid', () => {
    for (const [start, end] of [['bad', local(8)], [local(8), local(8)], [local(9), local(8)]]) {
      expect(evaluateCandidateSlot({ startTimeIso: start, endTimeIso: end }, []).status).toBe('invalid_interval');
    }
  });
  it('does not call an event ongoing at its exclusive end', () => {
    expect(getNormalizedEventInterval(event(local(8, 10), local(8, 11)), Date.parse(local(8, 11)))?.temporalStatus).toBe('past');
  });
  it('does not turn an infinite duration into an invalid serialized interval', () => {
    expect(getNormalizedEventInterval(event(local(8), undefined, { duration_minutes: Infinity }))?.endMs).toBe(Date.parse(local(8)) + 3600000);
  });
  it.each([NaN, Infinity, -Infinity, 0, -1, Number.MAX_VALUE])('handles invalid focus duration %s without throwing', duration => {
    expect(() => checkFocusSessionConflicts(duration, [], Date.parse(local(8)))).not.toThrow();
    expect(checkFocusSessionConflicts(duration, [], Date.parse(local(8))).validationError).toBeDefined();
  });
  it('finds a recurring commitment continuing from the previous night', () => {
    const recurring = event(local(1, 23), new Date(2026, 2, 2, 1).toISOString(), { recurrence: 'DAILY' as any });
    expect(checkFocusSessionConflicts(25, [recurring], new Date(2026, 2, 8, 0, 15).getTime()).hasConflict).toBe(true);
  });
  it('does not project RRULE occurrences before the series begins', () => {
    expect(matchesRecurrence(new Date(2026, 2, 15), new Date(2026, 2, 8), 'WEEKLY', 'BYDAY=SU')).toBe(false);
  });
  it('keeps biweekly recurrence on its calendar week across DST', () => {
    expect(matchesRecurrence(new Date(2026, 2, 1), new Date(2026, 2, 15), 'WEEKLY', 'INTERVAL=2')).toBe(true);
  });
});


it('allows focus sessions adjacent to commitments and excludes a rescheduled session itself', () => {
  const events = [event(local(8, 10), local(8, 11), { id: 'self' }), event(local(8, 11), local(8, 12), { id: 'next' })];
  expect(checkFocusSessionConflicts(60, events, Date.parse(local(8, 10)), 'self').hasConflict).toBe(false);
  expect(checkFocusSessionConflicts(61, events, Date.parse(local(8, 10)), 'self').conflicts.map(x => x.collidingEventId)).toEqual(['next']);
});
it('retains the existing estimated-hour policy for zero-duration/malformed stored events', () => {
  for (const end of [local(8, 10), 'bad', undefined]) {
    const interval = getNormalizedEventInterval(event(local(8, 10), end));
    expect(interval?.isEstimatedDuration).toBe(true);
    expect(interval?.endMs).toBe(Date.parse(local(8, 10)) + 3600000);
  }
  expect(getNormalizedEventInterval(event('bad'))).toBeNull();
});

import { describe, expect, it } from 'vitest';
import { Entity, EntityKind, EntityStatus } from '../types';
import { parseCalendarDate, formatLocalDate, deferDeadline, getDeadlineState, selectDueEntities } from '../utils/calendarDates';

describe('Local calendar deadlines', () => {
  it.each(['2024-02-29', '2026-12-31', '2026-03-08'])('preserves date-only %s across JSON persistence', day => {
    const persisted = JSON.parse(JSON.stringify({ deadline: day })).deadline;
    expect(formatLocalDate(parseCalendarDate(persisted)!)).toBe(day);
  });
  it.each(['2026-02-29', '2026-02-30', '2026-13-01', '', 'bad'])('rejects invalid calendar day %s', day => {
    expect(parseCalendarDate(day)).toBeNull();
    expect(deferDeadline(day, new Date(2026, 1, 1))).toBeNull();
  });
  it.each([
    ['2024-02-28', '2024-02-29'], ['2024-02-29', '2024-03-01'],
    ['2026-01-31', '2026-02-01'], ['2026-12-31', '2027-01-01']
  ])('advances %s by one local calendar day', (day, next) => {
    expect(deferDeadline(day, parseCalendarDate(day)!)).toBe(next);
  });
  it('defers overdue date-only tasks from today while retaining date-only representation', () => {
    expect(deferDeadline('2026-01-01', new Date(2026, 2, 8, 23, 50))).toBe('2026-03-09');
  });
  it.each([[2026, 2, 7], [2026, 2, 28], [2026, 9, 24], [2026, 9, 31], [2026, 3, 4], [2026, 8, 26]])(
    'preserves local wall time across offset changes from %i-%i-%i', (year, month, day) => {
      const deadline = new Date(year, month, day, 12, 34, 56, 123);
      const shifted = new Date(deferDeadline(deadline.toISOString(), deadline)!);
      expect([shifted.getHours(), shifted.getMinutes(), shifted.getSeconds(), shifted.getMilliseconds()]).toEqual([12, 34, 56, 123]);
      const expected = new Date(deadline); expected.setDate(expected.getDate() + 1);
      expect(shifted.getTime()).toBe(expected.getTime());
    });
  it('distinguishes calendar due-today from an elapsed timed deadline', () => {
    const now = new Date(2026, 2, 8, 12);
    expect(getDeadlineState('2026-03-08', now)).toBe('today');
    expect(getDeadlineState('2026-03-07', now)).toBe('overdue');
    expect(getDeadlineState(new Date(2026, 2, 8, 11).toISOString(), now)).toBe('overdue');
    expect(getDeadlineState('2026-03-09', now)).toBe('upcoming');
    expect(getDeadlineState(null, now)).toBe('invalid');
  });
  it('preserves chronological triage, excludes invalid/terminal records and keeps ties stable without mutation', () => {
    const entity = (id: string, deadline: string | null, extra = {}) => ({ id, deadline, kind: EntityKind.TASK, status: EntityStatus.ACTIVE, ...extra } as Entity);
    const records = [entity('future', '2028-01-01', { kind: EntityKind.PROJECT }), entity('first', '2026-03-08'),
      entity('second', '2026-03-08'), entity('bad', 'oops'), entity('null', null),
      ...[EntityStatus.COMPLETED, EntityStatus.ARCHIVED, EntityStatus.CANCELED].map((status, i) => entity('done'+i, '2026-01-01', { status }))];
    const original = records.map(record => record.id);
    expect(selectDueEntities(records).map(record => record.id)).toEqual(['first', 'second', 'future']);
    expect(records.map(record => record.id)).toEqual(original);
  });
});

it('runs in the requested process timezone rather than relying on the host default', () => {
  const offsets: Record<string, number> = { UTC: 0, 'America/New_York': 300, 'Europe/Berlin': -60, 'Asia/Kolkata': -330, 'Pacific/Auckland': -780 };
  if (process.env.TZ && process.env.TZ in offsets) {
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(offsets[process.env.TZ]);
  }
});

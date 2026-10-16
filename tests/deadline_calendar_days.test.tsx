import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Dashboard from '../components/Dashboard';
import CalendarView from '../components/CalendarView';
import { useStore } from '../store';
import { EntityKind, EntityStatus } from '../types';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 2, 8, 12));
  useStore.setState({ entities: [], kernelEntities: {}, relationships: [], dailyBriefing: null, isHydrated: true,
    settings: { feature_toggles: {}, productivity_calc_method: 'LOGGED_TIME' } as any });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const task = (id: string, deadline: string, status = EntityStatus.ACTIVE) =>
  ({ id, title: id, kind: EntityKind.TASK, status, deadline, metadata: {}, created_at: '2026-01-01', updated_at: '2026-01-01' } as any);
function open() { render(<Dashboard />); fireEvent.click(screen.getByTestId('dashboard-due-card')); }
it('labels a date-only deadline due today for the whole local calendar day', () => {
  useStore.setState({ entities: [task('today', '2026-03-08')] }); open();
  const card = screen.getByTestId('due-item-card-today');
  expect(within(card).getByText('Due Today')).toBeInTheDocument();
  expect(within(card).queryByText('Overdue')).not.toBeInTheDocument();
});
it('defers a date-only deadline without converting it into a timestamp', () => {
  const apply = vi.spyOn(useStore.getState(), 'applyOperations').mockImplementation(() => undefined as any);
  useStore.setState({ entities: [task('future', '2026-03-09')] }); open();
  fireEvent.click(screen.getByTestId('defer-due-btn-future'));
  expect(apply.mock.calls[0][0][0].payload.deadline).toBe('2026-03-10');
});
it('excludes invalid deadlines and terminal tasks while retaining long-running projects', () => {
  useStore.setState({ entities: [task('invalid', 'not-a-date'), task('done', '2026-03-08', EntityStatus.COMPLETED),
    { ...task('long-project', '2028-01-01'), kind: EntityKind.PROJECT }] }); open();
  expect(screen.queryByTestId('due-item-card-invalid')).not.toBeInTheDocument();
  expect(screen.queryByTestId('due-item-card-done')).not.toBeInTheDocument();
  expect(screen.getByTestId('due-item-card-long-project')).toBeInTheDocument();
});




it('calendar month excludes the exclusive end day of an all-day event', () => {
  useStore.setState({ entities: [{ ...task('All-day fixture', '2026-03-08'), kind: EntityKind.EVENT,
    start_time: '2026-03-08', end_time: '2026-03-09', metadata: { all_day: true } }], calendarInitialView: 'month' });
  render(<CalendarView />);
  expect(within(screen.getByTestId('month-day-cell-8')).getByText('All-day fixture')).toBeInTheDocument();
  expect(within(screen.getByTestId('month-day-cell-9')).queryByText('All-day fixture')).not.toBeInTheDocument();
});

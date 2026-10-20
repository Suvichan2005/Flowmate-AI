import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Dashboard from '../components/Dashboard';
import { useStore } from '../store';

vi.mock('../services/ai/managedClient', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/ai/managedClient')>();
  return { ...actual, hasManagedAiIdentity: () => false };
});

describe('Dashboard managed briefing rejection notice', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useStore.setState({
      entities: [], kernelEntities: {}, relationships: [], dailyBriefing: {
        content: 'Last successful briefing stays visible.',
        source: 'managed',
        timestamp: '2026-10-20T10:00:00.000Z',
        generated_for_date: '2026-10-20',
      } as any,
      isHydrated: true,
      settings: { feature_toggles: {}, productivity_calc_method: 'LOGGED_TIME' } as any,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps a clear, actionable one-hour briefing rejection visible without replacing the previous briefing', async () => {
    const refresh = vi.fn().mockResolvedValue('BRIEFING_COST_ENVELOPE_EXHAUSTED');
    useStore.setState({ refreshDailyBriefing: refresh });
    render(<Dashboard />);

    await act(async () => { fireEvent.click(screen.getByTestId('briefing-refresh-button')); });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('This briefing is over the included-AI limit')).toBeInTheDocument();
    expect(screen.getByText(/clears automatically at .* or when dismissed/i)).toBeInTheDocument();
    expect(screen.getByText('Last successful briefing stays visible.')).toBeInTheDocument();
    const stored = JSON.parse(sessionStorage.getItem('flowmate:briefing-warning:v1') || '{}');
    expect(stored.code).toBe('BRIEFING_COST_ENVELOPE_EXHAUSTED');
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
    expect(stored.expiresAt).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss briefing warning' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(sessionStorage.getItem('flowmate:briefing-warning:v1')).toBeNull();
  });
});

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getManagedAiUsage } = vi.hoisted(() => ({ getManagedAiUsage: vi.fn() }));

vi.mock('../store', () => ({
  useStore: (selector: (state: { currentUser: { uid: string } }) => unknown) => selector({ currentUser: { uid: 'synthetic-guest' } }),
}));

vi.mock('../services/ai/managedClient', () => ({
  getManagedAiUsage,
  hasManagedAiIdentity: () => true,
}));

import ManagedAiUsagePanel from '../components/ManagedAiUsagePanel';

describe('managed AI usage panel', () => {
  beforeEach(() => {
    getManagedAiUsage.mockResolvedValue({
      tier: 'guest',
      chat: { successfulTurns: 5, monthlyLimit: 30, month: '2026-10', resetAt: '2026-11-01T00:00:00.000Z' },
      briefings: { successfulToday: 1, dailyLimit: 3, day: '2026-10-19', resetAt: '2026-10-19T18:30:00.000Z' },
      tokens: { inputThisMonth: 9200, outputThisMonth: 1800, thinkingThisMonth: 400, totalThisMonth: 11400, usageCallsThisMonth: 17, month: '2026-10' },
    });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('shows personal monthly chat, daily briefing and overall token usage without shared call telemetry', async () => {
    render(<ManagedAiUsagePanel />);
    await waitFor(() => expect(screen.getByText('AI usage')).toBeTruthy());
    expect(screen.getByText('Monthly')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('25 left')).toBeTruthy();
    expect(screen.getByText('2 left')).toBeTruthy();
    expect(screen.getByText('Overall model usage this month')).toBeTruthy();
    expect(screen.getByText('11K tokens')).toBeTruthy();
    expect(screen.queryByText(/model calls/i)).toBeNull();
    expect(screen.getByText(/not an extra token cap/)).toBeTruthy();
  });
});

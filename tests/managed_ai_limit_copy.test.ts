import { describe, expect, it } from 'vitest';
import { formatManagedAiResetAt, getManagedAiLimitCopy } from '../services/ai/managedAiLimitCopy';

describe('managed AI allowance messages', () => {
  it('explains that guest briefings are daily and offers sign-in for more', () => {
    const copy = getManagedAiLimitCopy('GUEST_BRIEFING_ALLOWANCE_EXHAUSTED');
    expect(copy.description).toContain('today’s guest briefing allowance');
    expect(copy.description).toContain('larger daily allowance');
    expect(copy.description).not.toContain('this month');
    expect(copy.signInLabel).toContain('daily briefings');
  });

  it('shows the daily reset for an account briefing allowance', () => {
    const copy = getManagedAiLimitCopy('BRIEFING_ALLOWANCE_EXHAUSTED', new Date('2026-10-20T14:30:00Z'));
    expect(copy.description).toContain('21 Oct 2026');
    expect(copy.description).toContain('IST');
    expect(copy.description).not.toContain('next month');
    expect(copy.signInLabel).toBeUndefined();
  });

  it('calculates reset boundaries in Asia/Kolkata even when the browser date differs', () => {
    expect(formatManagedAiResetAt('month', new Date('2026-10-31T17:00:00Z'))).toContain('1 Nov 2026');
    expect(formatManagedAiResetAt('day', new Date('2026-10-20T17:00:00Z'))).toContain('21 Oct 2026');
  });

  it('keeps chat allowance language monthly', () => {
    expect(getManagedAiLimitCopy('GUEST_TURN_ALLOWANCE_EXHAUSTED').description).toContain('this month’s 30 guest chat turns');
    expect(getManagedAiLimitCopy('TURN_ALLOWANCE_EXHAUSTED').description).toContain('this month’s 150 included chat turns');
  });
});

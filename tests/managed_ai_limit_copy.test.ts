import { describe, expect, it } from 'vitest';
import { getManagedAiLimitCopy } from '../services/ai/managedAiLimitCopy';

describe('managed AI allowance messages', () => {
  it('explains that guest briefings are daily and offers sign-in for more', () => {
    const copy = getManagedAiLimitCopy('GUEST_BRIEFING_ALLOWANCE_EXHAUSTED');
    expect(copy.description).toContain('today’s guest briefing allowance');
    expect(copy.description).toContain('larger daily allowance');
    expect(copy.description).not.toContain('this month');
    expect(copy.signInLabel).toContain('daily briefings');
  });

  it('shows the daily reset for an account briefing allowance', () => {
    const copy = getManagedAiLimitCopy('BRIEFING_ALLOWANCE_EXHAUSTED');
    expect(copy.description).toContain('resets at midnight IST');
    expect(copy.description).not.toContain('next month');
    expect(copy.signInLabel).toBeUndefined();
  });

  it('keeps chat allowance language monthly', () => {
    expect(getManagedAiLimitCopy('GUEST_TURN_ALLOWANCE_EXHAUSTED').description).toContain('this month’s 30 guest chat turns');
    expect(getManagedAiLimitCopy('TURN_ALLOWANCE_EXHAUSTED').description).toContain('this month’s 150 included chat turns');
  });
});

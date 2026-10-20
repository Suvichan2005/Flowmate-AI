import { describe, expect, it } from 'vitest';
import { getManagedRequestGuidance } from '../services/ai/managedRequestGuidance';

describe('managed request history guidance', () => {
  it('keeps an oversized single request separate from cumulative turn limits and offers context actions', () => {
    const guidance = getManagedRequestGuidance('REQUEST_COST_ENVELOPE_EXHAUSTED', 'not_sent');
    expect(guidance.outcome).toBe('not_sent');
    expect(guidance.description).toContain('Nothing was sent');
    expect(guidance.description).toContain('fresh chat');
    expect(guidance.actions).toContain('new_chat');
    expect(guidance.actions).toContain('settings');
  });

  it('distinguishes an application context overflow and says the account is not blocked', () => {
    const guidance = getManagedRequestGuidance('MODEL_CONTEXT_LIMIT', 'not_sent');
    expect(guidance.description).toContain('application-side context fix');
    expect(guidance.description).toContain('your account is not blocked');
  });

  it('does not tell users to resend an uncertain provider request immediately', () => {
    const guidance = getManagedRequestGuidance('GENERATION_FAILED', 'uncertain');
    expect(guidance.outcome).toBe('uncertain');
    expect(guidance.description).toContain('may have received this request');
    expect(guidance.description).toContain('avoid duplicate work');
    expect(guidance.description).toContain('You can continue chatting');
    expect(guidance.actions).toEqual([]);
  });

  it('uses real monthly reset dates for guest limits and separates them from account limits', () => {
    const guest = getManagedRequestGuidance('GUEST_TURN_ALLOWANCE_EXHAUSTED', 'not_sent', new Date('2026-10-20T12:00:00Z'));
    expect(guest.description).toContain('1 Nov 2026');
    expect(guest.actions).toContain('sign_in');
    const account = getManagedRequestGuidance('TURN_ALLOWANCE_EXHAUSTED', 'not_sent', new Date('2026-10-20T12:00:00Z'));
    expect(account.description).toContain('1 Nov 2026');
    expect(account.actions).not.toContain('sign_in');
  });

  it('makes service-side caps explicit and prevents users from trying to clear them with shorter prompts', () => {
    const guidance = getManagedRequestGuidance('MANAGED_AI_BUDGET_TEMPORARILY_UNAVAILABLE', 'not_sent', new Date('2026-10-20T12:00:00Z'));
    expect(guidance.description).toContain('service-side limit');
    expect(guidance.description).toContain('cannot be cleared by changing your message');
    expect(guidance.actions).toEqual([]);
  });

  it('offers reload for App Check failures without implying a BYOK or quota fix', () => {
    const guidance = getManagedRequestGuidance('APP_CHECK_REQUIRED', 'not_sent');
    expect(guidance.description).toContain('application-side App Check fix');
    expect(guidance.actions).toEqual(['reload']);
    expect(guidance.actions).not.toContain('settings');
  });
});

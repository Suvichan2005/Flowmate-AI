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
    expect(guidance.description).toContain('injected workspace context');
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
    expect(guest.actions).toEqual(['sign_in']);
    expect(guest.description).not.toContain('Gemini key');
    const account = getManagedRequestGuidance('TURN_ALLOWANCE_EXHAUSTED', 'not_sent', new Date('2026-10-20T12:00:00Z'));
    expect(account.description).toContain('1 Nov 2026');
    expect(account.actions).not.toContain('sign_in');
  });

  it('makes service-side caps explicit and prevents users from trying to clear them with shorter prompts', () => {
    const guidance = getManagedRequestGuidance('MANAGED_AI_BUDGET_TEMPORARILY_UNAVAILABLE', 'not_sent', new Date('2026-10-20T12:00:00Z'));
    expect(guidance.description).toContain('service-side limit');
    expect(guidance.description).toContain('cannot be cleared by changing your message');
    expect(guidance.actions).toEqual(['settings']);
  });

  it('offers reload for App Check failures without implying a BYOK or quota fix', () => {
    const guidance = getManagedRequestGuidance('APP_CHECK_REQUIRED', 'not_sent');
    expect(guidance.description).toContain('application-side App Check fix');
    expect(guidance.actions).toEqual(['reload']);
    expect(guidance.actions).not.toContain('settings');
  });

  it.each([
    ['OUTPUT_TOKEN_LIMIT', 'shorter reply length'],
    ['MODEL_NOT_ALLOWED_FOR_ACCOUNT', 'listed for your current account'],
    ['MODEL_UNAVAILABLE', 'did not switch models automatically'],
    ['MODEL_TOOL_CALLING_UNAVAILABLE', 'No workspace changes were made'],
    ['UNSUPPORTED_REASONING_LEVEL', 'reasoning levels offered'],
    ['MODEL_INPUT_UNSUPPORTED', 'Remove the unsupported attachment'],
    ['PROVIDER_RATE_LIMITED', 'Wait briefly'],
    ['REQUEST_ALREADY_PROCESSED', 'Check this conversation'],
    ['TURN_ALREADY_COMPLETE', 'Send a new message'],
    ['TURN_GENERATION_LIMIT', 'before sending another model step'],
    ['INVALID_REQUEST', 'Review the message'],
    ['MANAGED_AI_NOT_CONFIGURED', 'application-side configuration'],
    ['MANAGED_AI_UNAVAILABLE', 'application-side configuration'],
  ])('gives specific recovery guidance for %s', (code, expected) => {
    const guidance = getManagedRequestGuidance(code, 'not_sent');
    expect(guidance.outcome).toBe('not_sent');
    expect(guidance.title).not.toBe('No AI response was received');
    expect(guidance.description).toContain(expected);
  });

  it('keeps failed-request guidance durable and out of model context instead of expiring it as a toast', () => {
    const guidance = getManagedRequestGuidance('MODEL_CONTEXT_LIMIT', 'not_sent');
    expect(guidance.description).toContain('original transcript');
    expect(guidance.description).toContain('will not silently rewrite');
  });

  it('separates Chat request-size recovery from briefing request-size recovery', () => {
    const chat = getManagedRequestGuidance('REQUEST_COST_ENVELOPE_EXHAUSTED', 'not_sent');
    expect(chat.description).toContain('reasoning and reply length');
    expect(chat.description).toContain('workspace context');
    expect(chat.description).toContain('latest 12 messages');
    expect(chat.description).toContain('your account is not blocked');
    expect(chat.description).toContain('choose a smaller reply length');
    expect(chat.description).toContain('will not rewrite or downgrade');
    const briefing = getManagedRequestGuidance('BRIEFING_COST_ENVELOPE_EXHAUSTED', 'not_sent');
    expect(briefing.description).toContain('not a daily allowance');
    expect(briefing.description).toContain('retrying unchanged workspace data will not help');
  });

  it('does not show irrelevant Settings actions when the right next step is to wait or inspect the existing turn', () => {
    expect(getManagedRequestGuidance('USER_CALL_IN_PROGRESS', 'not_sent').actions).toEqual([]);
    expect(getManagedRequestGuidance('PROVIDER_RATE_LIMITED', 'not_sent').actions).toEqual([]);
    expect(getManagedRequestGuidance('REQUEST_ALREADY_PROCESSED', 'not_sent').actions).toEqual([]);
  });
});

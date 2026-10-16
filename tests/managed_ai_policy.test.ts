import { describe, expect, it } from 'vitest';
import {
  MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS, MAX_CALLS_PER_TURN, MODEL,
  MONTHLY_GENERATION_LIMIT, USER_TURN_LIMIT, RequestFailure,
  isAllowedManagedTool, isCompletedUserTurn, managedGenerationConfig, monthKey, sanitizeManagedCandidates, validateGenerationBody,
} from '../functions/src/policy';

const config = { systemInstruction: 'Be helpful.', tools: [{ functionDeclarations: [{ name: 'apply_changes' }] }] };
const request = (extra: Record<string, unknown> = {}) => ({
  turnId: 'turn_0000000000000001', callId: 'call_00000000000001',
  contents: [{ role: 'user', parts: [{ text: 'hello' }] }], config, ...extra,
});

describe('managed Gemini policy', () => {
  it('pins the managed model and quotas to the approved limits', () => {
    expect(MODEL).toBe('gemini-3.8-flash');
    expect([USER_TURN_LIMIT, MONTHLY_GENERATION_LIMIT, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS]).toEqual([10, 500, 16000, 2048]);
    expect(MAX_CALLS_PER_TURN).toBe(15);
  });

  it('forces the server-side output and reasoning ceilings', () => {
    expect(managedGenerationConfig({ maxOutputTokens: 99_999, thinkingConfig: { thinkingLevel: 'high' } })).toMatchObject({
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: 'low' },
    });
  });

  it('accepts only a bounded request with correlated turn and call identifiers', () => {
    expect(validateGenerationBody(request()).turnId).toBe('turn_0000000000000001');
    expect(() => validateGenerationBody(request({ uid: 'attacker-chosen' }))).toThrowError(RequestFailure);
    expect(() => validateGenerationBody(request({ model: 'gemini-3.1-pro-preview' }))).toThrowError(RequestFailure);
    expect(() => validateGenerationBody(request({ callId: 'short' }))).toThrowError(RequestFailure);
  });

  it('rejects tools outside the fixed Flowmate allowlist', () => {
    const invalidConfig = { systemInstruction: 'Be helpful.', tools: [{ functionDeclarations: [{ name: 'read_arbitrary_firestore' }] }] };
    expect(() => validateGenerationBody(request({ config: invalidConfig }))).toThrowError(RequestFailure);
    for (const name of ['configure_commitment', 'record_commitment_evidence', 'read_arbitrary_firestore']) {
      const mutatingConfig = { systemInstruction: 'Be helpful.', tools: [{ functionDeclarations: [{ name }] }] };
      expect(() => validateGenerationBody(request({ config: mutatingConfig }))).toThrowError(RequestFailure);
      expect(isAllowedManagedTool(name)).toBe(false);
    }
    for (const name of [
      'query_entities', 'query_relationships', 'reflect_schemas', 'query_commitment', 'read_calendar',
      'search_entities', 'lookup_food_history', 'get_productivity_stats', 'lookup_goals', 'lookup_habits',
      'lookup_travel_route', 'search_memory', 'get_relevant_context', 'propose_memory_update', 'apply_changes',
    ]) {
      const supportedConfig = { systemInstruction: 'Be helpful.', tools: [{ functionDeclarations: [{ name }] }] };
      expect(validateGenerationBody(request({ config: supportedConfig })).config).toEqual(supportedConfig);
      expect(isAllowedManagedTool(name)).toBe(true);
    }
  });

  it('rejects oversized content and malformed histories before quota reservation', () => {
    expect(() => validateGenerationBody(request({ contents: [] }))).toThrowError(RequestFailure);
    expect(() => validateGenerationBody(request({ contents: [{ text: 'x'.repeat(1_500_001) }] }))).toThrowError(RequestFailure);
  });

  it('counts only terminal assistant output or proposed writes as successful user turns', () => {
    expect(isCompletedUserTurn({ functionCalls: [{ name: 'search_entities' }] })).toBe(false);
    expect(isCompletedUserTurn({ text: 'Here is a plan.', functionCalls: [] })).toBe(true);
    expect(isCompletedUserTurn({ functionCalls: [{ name: 'apply_changes' }] })).toBe(true);
    expect(isCompletedUserTurn({ text: '', functionCalls: [] })).toBe(false);
  });

  it('strips provider-marked thought text while preserving visible output and tool signatures', () => {
    const sanitized = sanitizeManagedCandidates([{
      content: { role: 'model', parts: [
        { text: 'private thought', thought: true, thoughtSignature: 'opaque-thought-signature' },
        { text: 'Visible answer', thought: false },
        { functionCall: { name: 'apply_changes', args: {} }, thoughtSignature: 'tool-signature' },
      ] },
    }]);
    const visible = sanitized[0] as { content: { parts: unknown[] } };
    expect(visible.content.parts).toEqual([
      { text: 'Visible answer' },
      { functionCall: { name: 'apply_changes', args: {} }, thoughtSignature: 'tool-signature' },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain('private thought');
    expect(JSON.stringify(sanitized)).not.toContain('opaque-thought-signature');
  });
  it('uses the approved Asia/Kolkata calendar month for the global cap', () => {
    expect(monthKey(new Date('2026-10-31T18:29:59.000Z'))).toBe('2026-10');
    expect(monthKey(new Date('2026-10-31T18:30:00.000Z'))).toBe('2026-11');
  });
});

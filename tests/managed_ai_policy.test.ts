import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CHAT_TURN_LIMIT, ACCOUNT_MONTHLY_BRIEFING_LIMIT, DEFAULT_MODEL, GUEST_CHAT_TURN_LIMIT,
  GUEST_MONTHLY_BRIEFING_LIMIT, MANAGED_FUNCTION_TIMEOUT_SECONDS, ACTIVE_MODEL_CALL_LEASE_MS,
  RESERVATION_TTL_MS,
  RequestFailure, SUPPORTED_MANAGED_MODELS,
  authorizeManagedModel, dayKey, isAllowedManagedTool, isCompletedUserTurn, managedGenerationConfig,
  monthKey, sanitizeManagedCandidates, validateGenerationBody,
} from '../functions/src/policy';

const config = { systemInstruction: 'Be helpful.', tools: [{ functionDeclarations: [{ name: 'apply_changes' }] }] };
const request = (extra: Record<string, unknown> = {}) => ({
  turnId: 'turn_0000000000000001', callId: 'call_00000000000001',
  contents: [{ role: 'user', parts: [{ text: 'hello' }] }], config,
  model: DEFAULT_MODEL, reasoningLevel: 'low', purpose: 'chat', ...extra,
});

describe('managed Gemini policy', () => {
  it('keeps guest and account chat/briefing allowances separate from model-call reporting', () => {
    expect([GUEST_CHAT_TURN_LIMIT, ACCOUNT_CHAT_TURN_LIMIT]).toEqual([30, 150]);
    expect([GUEST_MONTHLY_BRIEFING_LIMIT, ACCOUNT_MONTHLY_BRIEFING_LIMIT]).toEqual([90, 150]);
  });

  it('retains the approved function timeout and bounded stale-call lease', () => {
    expect(MANAGED_FUNCTION_TIMEOUT_SECONDS).toBe(60);
    expect(ACTIVE_MODEL_CALL_LEASE_MS).toBeGreaterThan(MANAGED_FUNCTION_TIMEOUT_SECONDS * 1000);
    expect(ACTIVE_MODEL_CALL_LEASE_MS).toBeLessThan(RESERVATION_TTL_MS);
  });

  it('authorizes ordinary reasoning only on the everyday model and never High', () => {
    expect(() => authorizeManagedModel(DEFAULT_MODEL, 'low', false)).not.toThrow();
    expect(() => authorizeManagedModel(DEFAULT_MODEL, 'medium', false)).not.toThrow();
    expect(() => authorizeManagedModel(DEFAULT_MODEL, 'high', false)).toThrowError(RequestFailure);
    expect(() => authorizeManagedModel('gemini-3.1-pro-preview', 'medium', false)).toThrowError(RequestFailure);
    expect(() => authorizeManagedModel(DEFAULT_MODEL, 'minimal', false)).toThrowError(RequestFailure);
  });

  it('allows each documented reasoning level only for a supported model and privileged tier', () => {
    const flash = SUPPORTED_MANAGED_MODELS.find(model => model.id === 'gemini-3.8-flash')!;
    expect(flash.reasoningLevels).toEqual(['low', 'medium', 'high']);
    expect(() => authorizeManagedModel('gemini-3.8-flash', 'high', true)).not.toThrow();
    expect(() => authorizeManagedModel('gemini-3.6-flash', 'minimal', true)).not.toThrow();
    expect(() => authorizeManagedModel('gemini-3.5-flash-lite', 'high', true)).not.toThrow();
    expect(() => authorizeManagedModel('gemini-3.1-pro-preview', 'high', true)).not.toThrow();
    expect(() => authorizeManagedModel('gemini-3.8-flash', 'minimal', true)).toThrowError(RequestFailure);
    expect(() => authorizeManagedModel('gemini-3.7-flash', 'medium', true)).toThrowError(RequestFailure);
    expect(() => authorizeManagedModel('gemini-4-argon', 'medium', true)).not.toThrow();
  });

  it('ignores client-supplied thinking and does not impose an output ceiling', () => {
    expect(managedGenerationConfig({ maxOutputTokens: 65_536, thinkingConfig: { thinkingLevel: 'high' } }, 'medium')).toEqual({
      maxOutputTokens: 65_536,
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
    });
    expect(managedGenerationConfig({ temperature: 0.2 }, 'low')).toEqual({
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: 'LOW' },
    });
  });

  it('validates identity-free request structure without an arbitrary context-size limit', () => {
    const longHistory = Array.from({ length: 80 }, (_, index) => ({ role: index % 2 ? 'model' : 'user', parts: [{ text: `item ${index}` }] }));
    expect(validateGenerationBody(request({ contents: longHistory })).contents).toHaveLength(80);
    expect(() => validateGenerationBody(request({ uid: 'attacker-chosen' }))).toThrowError(RequestFailure);
    expect(() => validateGenerationBody(request({ model: 'gemini-3.7-flash' }))).toThrowError(RequestFailure);
    expect(() => validateGenerationBody(request({ callId: 'short' }))).toThrowError(RequestFailure);
    expect(() => validateGenerationBody(request({ purpose: 'workspace-sync' }))).toThrowError(RequestFailure);
    expect(validateGenerationBody(request({ purpose: 'briefing', config: { maxOutputTokens: 512, temperature: 0.7 } })).purpose).toBe('briefing');
  });

  it('rejects tools outside the fixed Flowmate tool allowlist', () => {
    const invalidConfig = { systemInstruction: 'Be helpful.', tools: [{ functionDeclarations: [{ name: 'read_arbitrary_firestore' }] }] };
    expect(() => validateGenerationBody(request({ config: invalidConfig }))).toThrowError(RequestFailure);
    for (const name of ['configure_commitment', 'record_commitment_evidence', 'read_arbitrary_firestore']) {
      const mutatingConfig = { systemInstruction: 'Be helpful.', tools: [{ functionDeclarations: [{ name }] }] };
      expect(() => validateGenerationBody(request({ config: mutatingConfig }))).toThrowError(RequestFailure);
      expect(isAllowedManagedTool(name)).toBe(false);
    }
    expect(isAllowedManagedTool('apply_changes')).toBe(true);
  });

  it('counts only terminal assistant output or human-reviewed proposals as successful turns', () => {
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

  it('uses Asia/Kolkata day and month boundaries', () => {
    expect(monthKey(new Date('2026-10-31T18:29:59.000Z'))).toBe('2026-10');
    expect(monthKey(new Date('2026-10-31T18:30:00.000Z'))).toBe('2026-11');
    expect(dayKey(new Date('2026-10-16T18:29:59.000Z'))).toBe('2026-10-16');
    expect(dayKey(new Date('2026-10-16T18:30:00.000Z'))).toBe('2026-10-17');
  });
});

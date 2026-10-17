import { describe, expect, it } from 'vitest';
import { generateArgonStateless, normalizeArgonUsage as normalizeManagedUsage } from '../functions/src/argon';
import { normalizeArgonUsage as normalizeByokUsage } from '../services/ai/argon';

describe('Gemini Interactions usage normalization', () => {
  it('maps current provider field names for managed and BYOK calls', () => {
    const usage = {
      total_input_tokens: 120,
      total_output_tokens: 45,
      total_thought_tokens: 30,
      total_cached_tokens: 12,
      total_tool_use_tokens: 7,
      total_tokens: 195,
    };
    const expected = {
      promptTokenCount: 120,
      candidatesTokenCount: 45,
      thoughtsTokenCount: 30,
      cachedContentTokenCount: 12,
      toolUsePromptTokenCount: 7,
      totalTokenCount: 195,
    };
    expect(normalizeManagedUsage(usage)).toEqual(expected);
    expect(normalizeByokUsage(usage)).toEqual(expected);
  });

  it('accepts older aliases and rejects malformed or absent usage', () => {
    expect(normalizeManagedUsage({ input_tokens: 4, output_tokens: 3, thinking_tokens: 2, total_tokens: 9 }))
      .toEqual({ promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 9, thoughtsTokenCount: 2 });
    expect(normalizeByokUsage({ total_input_tokens: -1, total_output_tokens: 'nope' })).toBeNull();
    expect(normalizeManagedUsage(undefined)).toBeNull();
    expect(normalizeManagedUsage({ total_input_tokens: -1, total_output_tokens: 'nope' })).toBeNull();
  });

  it('does not send unsupported temperature settings and rejects a non-final empty response', async () => {
    let requestBody: Record<string, unknown> | null = null;
    const successfulFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ status: 'completed', output_text: 'A genuine response', usage: {} }), { status: 200 });
    };
    const result = await generateArgonStateless({
      apiKey: 'test-key',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      config: { temperature: 0.7, maxOutputTokens: 120 },
      reasoningLevel: 'high',
      fetcher: successfulFetch as typeof fetch,
    });
    expect(result.text).toBe('A genuine response');
    expect(result.usageMetadata).toBeNull();
    expect(requestBody?.generation_config).toEqual({ thinking_level: 'high', max_output_tokens: 120 });

    const emptyFetch = async () => new Response(JSON.stringify({ status: 'in_progress', output_text: '' }), { status: 200 });
    await expect(generateArgonStateless({
      apiKey: 'test-key',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      config: {},
      reasoningLevel: 'medium',
      fetcher: emptyFetch as typeof fetch,
    })).rejects.toMatchObject({ code: 'GENERATION_FAILED' });
  });
});

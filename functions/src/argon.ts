import { RequestFailure, type ReasoningLevel } from './policy.js';

type InteractionPart = { type: 'text'; text: string } | { type: 'image'; mime_type: string; data: string };
type InteractionStep = { type: 'user_input' | 'model_output'; content: InteractionPart[] };

function toInteractionStep(value: unknown): InteractionStep {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestFailure('INVALID_REQUEST', 400);
  const item = value as Record<string, unknown>;
  const role = item.role;
  if (role !== 'user' && role !== 'model') throw new RequestFailure('INVALID_REQUEST', 400);
  if (!Array.isArray(item.parts)) throw new RequestFailure('INVALID_REQUEST', 400);
  const content: InteractionPart[] = [];
  for (const rawPart of item.parts) {
    if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) throw new RequestFailure('INVALID_REQUEST', 400);
    const part = rawPart as Record<string, unknown>;
    if (typeof part.text === 'string') {
      content.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.inlineData && typeof part.inlineData === 'object' && !Array.isArray(part.inlineData)) {
      const image = part.inlineData as Record<string, unknown>;
      if (typeof image.mimeType !== 'string' || !image.mimeType.startsWith('image/') || typeof image.data !== 'string') {
        throw new RequestFailure('MODEL_INPUT_UNSUPPORTED', 422);
      }
      content.push({ type: 'image', mime_type: image.mimeType, data: image.data });
      continue;
    }
    // Argon's Flowmate adapter intentionally does not expose function calls or
    // function results until their stateless continuation contract is verified.
    if ('functionCall' in part || 'functionResponse' in part || 'fileData' in part || 'videoMetadata' in part) {
      throw new RequestFailure('MODEL_TOOL_CALLING_UNAVAILABLE', 422);
    }
  }
  if (content.length === 0) throw new RequestFailure('INVALID_REQUEST', 400);
  return { type: role === 'user' ? 'user_input' : 'model_output', content };
}

export function toArgonInput(contents: unknown[]): InteractionStep[] {
  return contents.map(toInteractionStep);
}

export function normalizeArgonUsage(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const usage = value as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    promptTokenCount: ['total_input_tokens', 'input_tokens'],
    candidatesTokenCount: ['total_output_tokens', 'output_tokens'],
    totalTokenCount: ['total_tokens'],
    thoughtsTokenCount: ['total_thought_tokens', 'thinking_tokens'],
    cachedContentTokenCount: ['total_cached_tokens'],
    toolUsePromptTokenCount: ['total_tool_use_tokens'],
  };
  const result: Record<string, number> = {};
  for (const [target, sources] of Object.entries(fields)) {
    const source = sources.find(key => usage[key] !== undefined);
    if (!source) continue;
    const count = usage[source] === null ? Number.NaN : Number(usage[source]);
    if (Number.isSafeInteger(count) && count >= 0) result[target] = count;
  }
  return Object.keys(result).length ? result : null;
}

export async function generateArgonStateless(args: {
  apiKey: string;
  contents: unknown[];
  config: Record<string, unknown>;
  reasoningLevel: ReasoningLevel;
  fetcher?: typeof fetch;
}): Promise<{
  text: string;
  candidates: Array<{ content: { role: 'model'; parts: Array<{ text: string }> } }>;
  functionCalls: [];
  usageMetadata: Record<string, number> | null;
}> {
  const { apiKey, contents, config, reasoningLevel } = args;
  if (!apiKey) throw new RequestFailure('MANAGED_AI_NOT_CONFIGURED', 503);
  const steps = toArgonInput(contents);
  const generationConfig: Record<string, unknown> = {
    thinking_level: reasoningLevel,
  };
  if (Number.isSafeInteger(config.maxOutputTokens) && Number(config.maxOutputTokens) > 0) {
    generationConfig.max_output_tokens = config.maxOutputTokens;
  }
  const body = {
    model: 'gemini-4-argon',
    input: steps,
    store: false,
    generation_config: generationConfig,
    ...(typeof config.systemInstruction === 'string' && config.systemInstruction
      ? { system_instruction: config.systemInstruction }
      : {}),
  };
  let response: Response;
  try {
    response = await (args.fetcher || fetch)('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    throw new RequestFailure('GENERATION_FAILED', 502);
  }
  if (!response.ok) {
    // Provider bodies can contain prompt excerpts or request details; never echo or log them.
    throw new RequestFailure(response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'GENERATION_FAILED', response.status === 429 ? 429 : 502);
  }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new RequestFailure('GENERATION_FAILED', 502); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestFailure('GENERATION_FAILED', 502);
  const interaction = payload as Record<string, unknown>;
  const outputText = typeof interaction.output_text === 'string' ? interaction.output_text : '';
  const stepsOut = Array.isArray(interaction.steps) ? interaction.steps as Array<Record<string, unknown>> : [];
  const text = outputText || stepsOut
    .filter(step => step.type === 'model_output' && Array.isArray(step.content))
    .flatMap(step => (step.content as Array<Record<string, unknown>>).filter(part => part.type === 'text').map(part => String(part.text || '')))
    .join('');
  if (!text.trim()) throw new RequestFailure('GENERATION_FAILED', 502);
  return {
    text,
    candidates: [{ content: { role: 'model', parts: text ? [{ text }] : [] } }],
    functionCalls: [],
    usageMetadata: normalizeArgonUsage(interaction.usage),
  };
}

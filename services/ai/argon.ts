import type { Content } from '@google/genai';
import type { ManagedGenerationResponse, ReasoningLevel } from './managedClient';

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
  for (const [target, candidates] of Object.entries(fields)) {
    const key = candidates.find(candidate => usage[candidate] !== undefined);
    if (!key) continue;
    const count = usage[key] === null ? Number.NaN : Number(usage[key]);
    if (Number.isSafeInteger(count) && count >= 0) result[target] = count;
  }
  return Object.keys(result).length ? result : null;
}

function toSteps(contents: Content[]): Array<Record<string, unknown>> {
  return contents.map(content => {
    if (content.role !== 'user' && content.role !== 'model') throw new Error('Gemini 4 Argon received an unsupported conversation role.');
    const parts: Array<Record<string, unknown>> = [];
    for (const part of content.parts || []) {
      if ('text' in part && typeof part.text === 'string') {
        parts.push({ type: 'text', text: part.text });
      } else if ('inlineData' in part && part.inlineData?.data && part.inlineData.mimeType?.startsWith('image/')) {
        parts.push({ type: 'image', mime_type: part.inlineData.mimeType, data: part.inlineData.data });
      } else if ('functionCall' in part || 'functionResponse' in part || 'fileData' in part) {
        throw new Error('Gemini 4 Argon is currently text and image only in Flowmate; choose another listed model for tool-assisted actions.');
      }
    }
    if (!parts.length) throw new Error('Gemini 4 Argon did not receive supported text or image input.');
    return { type: content.role === 'user' ? 'user_input' : 'model_output', content: parts };
  });
}

export async function generateArgonByokContent(
  apiKey: string,
  contents: Content[],
  config: Record<string, unknown>,
  reasoningLevel: ReasoningLevel,
  signal?: AbortSignal,
): Promise<ManagedGenerationResponse> {
  const generationConfig: Record<string, unknown> = { thinking_level: reasoningLevel };
  if (Number.isSafeInteger(config.maxOutputTokens) && Number(config.maxOutputTokens) > 0) {
    generationConfig.max_output_tokens = config.maxOutputTokens;
  }
  const body = {
    model: 'gemini-4-argon',
    input: toSteps(contents),
    store: false,
    generation_config: generationConfig,
    ...(typeof config.systemInstruction === 'string' && config.systemInstruction
      ? { system_instruction: config.systemInstruction }
      : {}),
  };
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error('Gemini 4 Argon is temporarily rate-limited by the provider. Your message is still available; retry shortly.');
    throw new Error(`Gemini 4 Argon is unavailable from this key (HTTP ${response.status}). No fallback model was selected.`);
  }
  const interaction = await response.json() as {
    output_text?: string;
    steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    usage?: Record<string, number>;
  };
  const text = interaction.output_text || interaction.steps
    ?.filter(step => step.type === 'model_output')
    .flatMap(step => step.content || [])
    .filter(part => part.type === 'text')
    .map(part => part.text || '').join('') || '';
  return {
    text,
    candidates: [{ content: { role: 'model', parts: text ? [{ text }] : [] } }],
    functionCalls: [],
    usageMetadata: normalizeArgonUsage(interaction.usage),
    model: 'gemini-4-argon',
    reasoningLevel,
  };
}

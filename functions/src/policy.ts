export const MODEL = 'gemini-3.8-flash';
export const MAX_INPUT_TOKENS = 16_000;
export const MAX_OUTPUT_TOKENS = 2_048;
export const USER_TURN_LIMIT = 10;
export const MONTHLY_GENERATION_LIMIT = 500;
export const RATE_LIMIT_PER_MINUTE = 20;
export const MAX_CALLS_PER_TURN = 15;
export const TURN_RESERVATION_TTL_MS = 10 * 60 * 1000;

const ALLOWED_TOOLS = new Set([
  'query_entities', 'query_relationships', 'reflect_schemas', 'query_commitment',
  'read_calendar', 'search_entities', 'lookup_food_history', 'get_productivity_stats',
  'lookup_goals', 'lookup_habits', 'lookup_travel_route', 'search_memory',
  'get_relevant_context', 'propose_memory_update', 'apply_changes',
]);

export const isAllowedManagedTool = (name: string): boolean => ALLOWED_TOOLS.has(name);

export class RequestFailure extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

export function validateGenerationBody(body: unknown): {
  turnId: string; callId: string; contents: unknown[]; config: Record<string, unknown>;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestFailure('INVALID_REQUEST', 400);
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !['turnId', 'callId', 'contents', 'config'].includes(key))) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  const idPattern = /^[A-Za-z0-9_-]{16,80}$/;
  if (typeof value.turnId !== 'string' || !idPattern.test(value.turnId) ||
      typeof value.callId !== 'string' || !idPattern.test(value.callId)) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  if (!Array.isArray(value.contents) || value.contents.length < 1 || value.contents.length > 32) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  const serialized = JSON.stringify(value.contents);
  if (new TextEncoder().encode(serialized).byteLength > 1_500_000) throw new RequestFailure('REQUEST_TOO_LARGE', 413);
  if (!value.config || typeof value.config !== 'object' || Array.isArray(value.config)) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  const config = value.config as Record<string, unknown>;
  const allowedConfig = new Set(['tools', 'toolConfig', 'systemInstruction', 'temperature', 'thinkingConfig', 'topP', 'topK']);
  if (Object.keys(config).some(key => !allowedConfig.has(key))) throw new RequestFailure('INVALID_REQUEST', 400);
  if (typeof config.systemInstruction !== 'string' || config.systemInstruction.length > 24_000) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  const tools = config.tools;
  if (tools !== undefined) {
    if (!Array.isArray(tools) || tools.length > 2) throw new RequestFailure('INVALID_REQUEST', 400);
    for (const tool of tools) {
      const declarations = (tool as { functionDeclarations?: unknown })?.functionDeclarations;
      if (!Array.isArray(declarations) || declarations.length > 20 || declarations.some(
        declaration => !declaration || typeof declaration !== 'object' ||
          !ALLOWED_TOOLS.has(String((declaration as { name?: unknown }).name)),
      )) throw new RequestFailure('INVALID_REQUEST', 400);
    }
  }
  return { turnId: value.turnId, callId: value.callId, contents: value.contents, config };
}

/** Client hints never raise managed output or reasoning limits. */
export function managedGenerationConfig(config: Record<string, unknown>): Record<string, unknown> {
  return {
    ...config,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    thinkingConfig: { thinkingLevel: 'low' },
  };
}

export function isCompletedUserTurn(response: {
  text?: string | null;
  functionCalls?: Array<{ name?: string }> | null;
}): boolean {
  const calls = response.functionCalls || [];
  return calls.some(call => call.name === 'apply_changes') ||
    (calls.length === 0 && Boolean(response.text?.trim()));
}


/** Remove provider-marked thought text before a managed response reaches the browser.
 * Preserve visible content and function-call signatures required for tool continuation.
 */
export function sanitizeManagedCandidates(candidates: unknown[]): unknown[] {
  return candidates.map(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
    const record = candidate as Record<string, unknown>;
    const content = record.content;
    if (!content || typeof content !== 'object' || Array.isArray(content) || !Array.isArray((content as { parts?: unknown }).parts)) return candidate;
    const parts = (content as { parts: Array<Record<string, unknown>> }).parts.flatMap(part => {
      if (part.thought === true) {
        if (part.functionCall) return [{ functionCall: part.functionCall, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) }];
        return [];
      }
      const { thought: _thought, ...visiblePart } = part;
      return [visiblePart];
    });
    return { ...record, content: { ...content, parts } };
  });
}
export function monthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value || '0000';
  const month = parts.find(part => part.type === 'month')?.value || '00';
  return `${year}-${month}`;
}

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const ARGON_MODEL = 'gemini-4-argon';
export const ORDINARY_MODEL_IDS = new Set([DEFAULT_MODEL]);
export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high';
export type AiPurpose = 'chat' | 'briefing';

export interface ManagedModelPolicy {
  id: string;
  name: string;
  description: string;
  reasoningLevels: ReasoningLevel[];
  inputTokenLimit: number;
  outputTokenLimit: number;
  functionCalling: boolean;
  interactionsApi?: boolean;
  sharedContextWindow?: boolean;
}

export const SUPPORTED_MANAGED_MODELS: ManagedModelPolicy[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description: 'Fast, capable model for everyday planning and tool-assisted work.',
    reasoningLevels: ['low', 'medium', 'high'],
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
    functionCalling: true,
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    description: 'A balanced model for agentic and multimodal tasks.',
    reasoningLevels: ['minimal', 'low', 'medium', 'high'],
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
    functionCalling: true,
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    description: 'A fast, economical choice for routine requests.',
    reasoningLevels: ['minimal', 'low', 'medium', 'high'],
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
    functionCalling: true,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    description: 'Advanced reasoning for complex work; preview availability depends on the API key.',
    reasoningLevels: ['low', 'medium', 'high'],
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
    functionCalling: true,
  },
  {
    id: ARGON_MODEL,
    name: 'Gemini 4 Argon',
    description: 'Flagship reasoning with a unified 1M-token context. Flowmate supports stateless text and image requests up to the synchronous output limit; provider long-decode jobs are not enabled.',
    reasoningLevels: ['low', 'medium', 'high'],
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
    functionCalling: false,
    interactionsApi: true,
    sharedContextWindow: true,
  },
] as const;

export type ManagedModelId = typeof SUPPORTED_MANAGED_MODELS[number]['id'];
// Calendar and account allowances are deliberately separate from model-call billing.
// Generous portfolio/demo allowances; separate per-minute and provider-side
// controls remain the abuse guard while rolling resource budgets are evaluated.
export const GUEST_CHAT_TURN_LIMIT = 30;
export const ACCOUNT_CHAT_TURN_LIMIT = 150;
export const GUEST_DAILY_BRIEFING_LIMIT = 3;
export const ACCOUNT_DAILY_BRIEFING_LIMIT = 5;
// Model-call records are telemetry only. Monetary safeguards are provider-side;
// usage reporting must not become an application quota.
export const RATE_LIMIT_PER_MINUTE = 20;
export const RESERVATION_TTL_MS = 10 * 60 * 1000;
// Keep the owner-approved Gen 2 request bound and let the lease expire shortly
// after a timed-out request can no longer settle its ledger reservation.
export const ACTIVE_MODEL_CALL_LEASE_MS = 70_000;
export const MANAGED_FUNCTION_TIMEOUT_SECONDS = 60;

const ALLOWED_TOOLS = new Set([
  'query_entities', 'query_relationships', 'reflect_schemas', 'query_commitment',
  'read_calendar', 'search_entities', 'lookup_food_history', 'get_productivity_stats',
  'lookup_goals', 'lookup_habits', 'search_memory',
  'get_relevant_context', 'propose_memory_update', 'apply_changes',
]);

export const isAllowedManagedTool = (name: string): boolean => ALLOWED_TOOLS.has(name);

export class RequestFailure extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

export function validateGenerationBody(body: unknown): {
  turnId: string; callId: string; contents: unknown[]; config: Record<string, unknown>;
  model: string; reasoningLevel?: ReasoningLevel; purpose: AiPurpose;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestFailure('INVALID_REQUEST', 400);
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !['turnId', 'callId', 'contents', 'config', 'model', 'reasoningLevel', 'purpose'].includes(key))) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  const idPattern = /^[A-Za-z0-9_-]{16,80}$/;
  if (typeof value.turnId !== 'string' || !idPattern.test(value.turnId) ||
      typeof value.callId !== 'string' || !idPattern.test(value.callId)) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  if (!Array.isArray(value.contents) || value.contents.length < 1) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  if (!value.config || typeof value.config !== 'object' || Array.isArray(value.config)) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  const config = value.config as Record<string, unknown>;
  const allowedConfig = new Set(['tools', 'toolConfig', 'systemInstruction', 'temperature', 'thinkingConfig', 'topP', 'topK', 'maxOutputTokens']);
  if (Object.keys(config).some(key => !allowedConfig.has(key))) throw new RequestFailure('INVALID_REQUEST', 400);
  if (config.systemInstruction !== undefined && typeof config.systemInstruction !== 'string') {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  if (config.maxOutputTokens !== undefined && (!Number.isSafeInteger(config.maxOutputTokens) || Number(config.maxOutputTokens) < 1)) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }
  if (value.model !== undefined && (typeof value.model !== 'string' || !SUPPORTED_MANAGED_MODELS.some(model => model.id === value.model))) {
    throw new RequestFailure('MODEL_UNAVAILABLE', 422);
  }
  if (value.reasoningLevel !== undefined && !['minimal', 'low', 'medium', 'high'].includes(String(value.reasoningLevel).toLowerCase())) {
    throw new RequestFailure('UNSUPPORTED_REASONING_LEVEL', 422);
  }
  const purpose = value.purpose === undefined ? 'chat' : value.purpose;
  if (purpose !== 'chat' && purpose !== 'briefing') throw new RequestFailure('INVALID_REQUEST', 400);
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
  return {
    turnId: value.turnId,
    callId: value.callId,
    contents: value.contents,
    config: { ...config, systemInstruction: typeof config.systemInstruction === 'string' ? config.systemInstruction : '' },
    model: (value.model as string | undefined) || DEFAULT_MODEL,
    reasoningLevel: typeof value.reasoningLevel === 'string' ? value.reasoningLevel.toLowerCase() as ReasoningLevel : undefined,
    purpose,
  };
}

export function authorizeManagedModel(modelId: string, reasoning: ReasoningLevel, privileged: boolean): void {
  const model = SUPPORTED_MANAGED_MODELS.find(candidate => candidate.id === modelId);
  if (!model) throw new RequestFailure('MODEL_UNAVAILABLE', 422);
  if (!(model.reasoningLevels as readonly ReasoningLevel[]).includes(reasoning)) throw new RequestFailure('UNSUPPORTED_REASONING_LEVEL', 422);
  if (!privileged && (!ORDINARY_MODEL_IDS.has(modelId) || !['low', 'medium'].includes(reasoning))) {
    throw new RequestFailure('MODEL_NOT_ALLOWED_FOR_ACCOUNT', 403);
  }
}

/**
 * The Gemini Developer API's countTokens endpoint accepts a full
 * generateContentRequest envelope. The @google/genai SDK's countTokens
 * config.systemInstruction/tools adapters are Vertex-only and throw for the
 * Gemini API, so keep the exact model inputs in the REST request envelope.
 */
export function buildCountTokensRequest(
  modelId: string,
  contents: unknown[],
  config: Record<string, unknown>,
): { generateContentRequest: Record<string, unknown> } {
  const generateContentRequest: Record<string, unknown> = {
    model: `models/${modelId}`,
    contents,
  };
  if (typeof config.systemInstruction === 'string' && config.systemInstruction.length > 0) {
    generateContentRequest.systemInstruction = { parts: [{ text: config.systemInstruction }] };
  }
  if (Array.isArray(config.tools) && config.tools.length > 0) {
    generateContentRequest.tools = config.tools;
  }
  return { generateContentRequest };
}

/** Server-controlled reasoning is derived from verified identity and model policy. */
export function managedGenerationConfig(config: Record<string, unknown>, reasoning: ReasoningLevel): Record<string, unknown> {
  const { thinkingConfig: _clientThinking, ...safeConfig } = config;
  return {
    ...safeConfig,
    thinkingConfig: { thinkingLevel: reasoning.toUpperCase() },
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

export function dayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const read = (type: string) => parts.find(part => part.type === type)?.value || '00';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

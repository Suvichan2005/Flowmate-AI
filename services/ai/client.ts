/**
 * AI Client Configuration
 *
 * Centralized Gemini API client setup, retry configuration,
 * and shared constants for all AI operations.
 */

/// <reference types="vite/client" />

import { GoogleGenAI } from "@google/genai";
import type { RetryConfig } from "../../utils/apiRetry";
import { hasManagedAiIdentity, type ManagedLiveModelOption } from "./managedClient";
import { FLOWMATE_MODEL_CAPABILITIES, type ModelOption } from "./modelCatalog";

// ---------------------------------------------------------------------------
// Client (ephemeral browser key; local rules remain available without Gemini)
// ---------------------------------------------------------------------------

let ephemeralApiKey: string | null = null;
const apiKeyListeners = new Set<(configured: boolean) => void>();

export const subscribeToApiKeyStatus = (listener: (configured: boolean) => void): (() => void) => {
  apiKeyListeners.add(listener);
  return () => apiKeyListeners.delete(listener);
};

/**
 * Configure an optional, ephemeral user-supplied key at runtime.
 * Privileged keys must NEVER be configured as build-time VITE_* variables.
 */
export const setEphemeralApiKey = (key: string | null): void => {
  ephemeralApiKey = key;
  const configured = hasAiApiKey();
  apiKeyListeners.forEach(listener => listener(configured));
};

export const getEphemeralApiKey = (): string | null => {
  return ephemeralApiKey;
};

/** Check if Gemini API key is configured ephemerally at runtime */
export const hasAiApiKey = (): boolean => {
  const key = getEphemeralApiKey();
  return Boolean(key && key.trim() !== '');
};

/** Managed AI is available to an authenticated Firebase user; BYOK remains optional. */
export const hasAiProviderAvailable = (): boolean => hasAiApiKey() || hasManagedAiIdentity();

/** Returns a fresh GoogleGenAI instance using the ephemeral runtime API key. */
export const getAiClient = (): GoogleGenAI => {
  const key = getEphemeralApiKey();
  return new GoogleGenAI({ apiKey: key || '' });
};

/** BYOK Live uses the standard Gemini Live endpoint. */
export const getByokLiveClient = (): GoogleGenAI => {
  const key = getEphemeralApiKey();
  return new GoogleGenAI({ apiKey: key || '', httpOptions: { apiVersion: 'v1beta' } });
};

/** Return only models that both Flowmate's current adapter and this BYOK key support. */
export const getByokModelOptions = async (): Promise<ModelOption[]> => {
  if (!hasAiApiKey()) return [];
  const listed = await getAiClient().models.list({ config: { pageSize: 100 } });
  const options: ModelOption[] = [];
  for await (const providerModel of listed) {
    const id = String(providerModel.name || '').replace(/^models\//, '').split('/').pop() || '';
    const capabilities = FLOWMATE_MODEL_CAPABILITIES.find(model => model.id === id);
    if (!capabilities) continue;
    const providerSupportsAdapter = capabilities.interactionsApi
      ? id === 'gemini-4-argon'
      : Boolean(providerModel.supportedActions?.includes('generateContent'));
    if (!providerSupportsAdapter) continue;
    // Do not substitute old static limits when the live provider omits its
    // current limits. Only advertise a model when its present capabilities are
    // available from this key.
    const inputTokenLimit = providerModel.inputTokenLimit;
    const outputTokenLimit = providerModel.outputTokenLimit;
    if (!inputTokenLimit || !outputTokenLimit) continue;
    options.push({
      ...capabilities,
      inputTokenLimit,
      outputTokenLimit,
    });
  }
  return options;
};

export const getByokLiveModelOptions = async (): Promise<ManagedLiveModelOption[]> => {
  if (!hasAiApiKey()) return [];
  const listed = await getAiClient().models.list({ config: { pageSize: 100 } });
  const supported = new Set<string>();
  for await (const model of listed) {
    const id = String(model.name || '').replace(/^models\//, '').split('/').pop() || '';
    if (model.supportedActions?.includes('bidiGenerateContent')) supported.add(id);
  }
  return [
    ...(supported.has('gemini-3.8-live') ? [{ id: 'gemini-3.8-live' as const, name: 'Gemini 3.8 Live', reasoningLevels: [] as const }] : []),
    ...(supported.has('gemini-3.8-live-extended-thinking') ? [{ id: 'gemini-3.8-live-extended-thinking' as const, name: 'Gemini 3.8 Live Extended Thinking', reasoningLevels: ['low', 'medium', 'high'] as const }] : []),
  ].map(option => ({ ...option, reasoningLevels: [...option.reasoningLevels] }));
};

// ---------------------------------------------------------------------------
// Retry Policy
// ---------------------------------------------------------------------------

export const GEMINI_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 15_000,
  backoffMultiplier: 2,
  jitter: true,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  retryableErrors: [
    'RESOURCE_EXHAUSTED',
    'UNAVAILABLE',
    'DEADLINE_EXCEEDED',
    'NetworkError',
  ],
  nonRetryableCodes: [
    'MANAGED_AI_DISABLED', 'GUEST_TURN_ALLOWANCE_EXHAUSTED', 'GUEST_BRIEFING_ALLOWANCE_EXHAUSTED',
    'TURN_ALLOWANCE_EXHAUSTED', 'BRIEFING_ALLOWANCE_EXHAUSTED', 'MODEL_NOT_ALLOWED_FOR_ACCOUNT',
    'MODEL_UNAVAILABLE', 'UNSUPPORTED_REASONING_LEVEL', 'MODEL_CONTEXT_LIMIT', 'OUTPUT_TOKEN_LIMIT',
      'REQUEST_ALREADY_PROCESSED', 'TURN_ALREADY_COMPLETE', 'PROVIDER_RATE_LIMITED',
  ],
};

// ---------------------------------------------------------------------------
// Authoritative Model Configuration
// ---------------------------------------------------------------------------

export const AI_MODELS = {
  BALANCED: 'gemini-3.8-flash',
  FAST_LITE: 'gemini-3.5-flash-lite',
  REASONING: 'gemini-3.1-pro-preview',
  LIVE: 'gemini-3.8-live',
} as const;

export type AiModelId = typeof AI_MODELS[keyof typeof AI_MODELS];

export const DEFAULT_MODEL = AI_MODELS.BALANCED;
export const HISTORY_WINDOW = 12;

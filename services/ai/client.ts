/**
 * AI Client Configuration
 *
 * Centralized Gemini API client setup, retry configuration,
 * and shared constants for all AI operations.
 */

/// <reference types="vite/client" />

import { GoogleGenAI } from "@google/genai";
import type { RetryConfig } from "../../utils/apiRetry";
import { hasManagedAiIdentity } from "./managedClient";

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
  nonRetryableCodes: ['MANAGED_AI_DISABLED', 'GLOBAL_LIMIT_REACHED'],
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
export const MAX_FUNCTION_TURNS = 5;
export const HISTORY_WINDOW = 12;

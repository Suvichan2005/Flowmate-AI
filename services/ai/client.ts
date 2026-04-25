/**
 * AI Client Configuration
 *
 * Centralized Gemini API client setup, retry configuration,
 * and shared constants for all AI operations.
 */

/// <reference types="vite/client" />

import { GoogleGenAI } from "@google/genai";
import type { RetryConfig } from "../../utils/apiRetry";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** Returns a fresh GoogleGenAI instance using the current API key. */
export const getAiClient = (): GoogleGenAI => {
  return new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || '' });
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
};

// ---------------------------------------------------------------------------
// Shared Constants
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = 'gemini-3-flash';
export const MAX_FUNCTION_TURNS = 5;
export const HISTORY_WINDOW = 12;

import type { ReasoningLevel } from './managedClient';

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  reasoningLevels: ReasoningLevel[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportsFunctionCalling: boolean;
  interactionsApi?: boolean;
  sharedContextWindow?: boolean;
}

/** Public API capabilities verified against Google's model and thinking documentation.
 * Runtime availability is still filtered through models.list for the active key.
 */
export const FLOWMATE_MODEL_CAPABILITIES: readonly ModelOption[] = [
  {
    id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash',
    description: 'Fast, capable model for everyday planning and tool-assisted work.',
    reasoningLevels: ['low', 'medium', 'high'], inputTokenLimit: 1_048_576, outputTokenLimit: 65_536, supportsFunctionCalling: true,
  },
  {
    id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash',
    description: 'Balanced model for agentic and multimodal work.',
    reasoningLevels: ['minimal', 'low', 'medium', 'high'], inputTokenLimit: 1_048_576, outputTokenLimit: 65_536, supportsFunctionCalling: true,
  },
  {
    id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite',
    description: 'Fast, economical model for routine requests.',
    reasoningLevels: ['minimal', 'low', 'medium', 'high'], inputTokenLimit: 1_048_576, outputTokenLimit: 65_536, supportsFunctionCalling: true,
  },
  {
    id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview',
    description: 'Advanced reasoning for complex work; preview availability depends on the API key.',
    reasoningLevels: ['low', 'medium', 'high'], inputTokenLimit: 1_048_576, outputTokenLimit: 65_536, supportsFunctionCalling: true,
  },
  {
    id: 'gemini-4-argon', name: 'Gemini 4 Argon',
    description: 'Flagship reasoning with a unified 1M-token context. Flowmate supports stateless text and image requests up to the synchronous output limit; entity-action tools and provider long-decode jobs are not enabled.',
    reasoningLevels: ['low', 'medium', 'high'], inputTokenLimit: 1_048_576, outputTokenLimit: 65_536, supportsFunctionCalling: false,
    interactionsApi: true, sharedContextWindow: true,
  },
];

export const GEMINI_4_ARGON_UNAVAILABLE_REASON =
  'Gemini 4 Argon uses Flowmate’s stateless Interactions API adapter. It supports text and image input, but not Flowmate action tools or provider long-decode jobs yet.';

export function defaultReasoningForIdentity(anonymous: boolean, saved?: ReasoningLevel): ReasoningLevel {
  return saved || (anonymous ? 'low' : 'medium');
}

/**
 * Flowmate Greenfield Domain Kernel — Memory Write Policy (P1-07)
 *
 * Evaluates candidate memory writes before mutation:
 * 1. Classification: persist_memory, set_situational, discard_low_value, require_confirmation
 * 2. Inference Gating: AI inferences can NEVER self-confirm (user_confirmed: false, is_inferred: true)
 * 3. Temporal Extraction: Infers valid_from and valid_until for temporary situational states
 * 4. Sensitivity & Privacy Classification: Tags items with appropriate PrivacyTier
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { PrivacyTier } from '../kernel/types';
import {
  MemoryCategory,
  MemorySourceType,
  MemoryWriteEvaluation,
} from './memoryTypes';

export interface CandidateMemoryInput {
  content: string;
  sourceType?: MemorySourceType;
  category?: MemoryCategory;
  explicitSensitivity?: PrivacyTier;
  contextDate?: string; // ISO date string to anchor relative temporal phrases
}

// Low-value chatter patterns to discard
const DISCARD_PATTERNS: RegExp[] = [
  /^(hi|hello|hey|yo|howdy|good morning|good evening|good afternoon|sup)\b/i,
  /^(thanks|thank you|thx|cheers|appreciated|ty)\b/i,
  /^(ok|okay|cool|got it|sure|sounds good|great|nice|awesome|yep|yes|no|nope)\b/i,
  /^(what is|who is|how do i|search for|google|calculate|convert)\b/i,
  /^(bye|goodbye|see you|cya)\b/i,
];

// Situational keywords indicating bounded temporal states
const SITUATIONAL_PATTERNS: RegExp[] = [
  /\b(this week|next week|today|tomorrow|for now|currently|temporarily|this month|until|through)\b/i,
  /\b(traveling to|staying at|visiting|in hotel|on a trip|working from)\b/i,
  /\b(recovering from|sick with|fever|flu|headache)\b/i,
  /\b(busy with|cramming for|prepping for|sprint|exam season)\b/i,
];

// Sensitive/Restricted keywords
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(password|pin|secret|api[-_ ]?key|token|credential|seed phrase)\b/i,
  /\b(credit card|bank account|cvv|ssn|aadhaar|pan card|passport number)\b/i,
  /\b(medical condition|diagnosis|prescription|doctor's note|therapy)\b/i,
];

/**
 * Extracts approximate temporal boundaries from natural text.
 */
export function extractTemporalBounds(
  text: string,
  anchorIso: string = new Date().toISOString()
): { valid_from: string; valid_until: string } | undefined {
  const anchor = new Date(anchorIso);
  const lower = text.toLowerCase();

  const valid_from = anchor.toISOString();
  let untilDate: Date | null = null;

  if (lower.includes('today')) {
    untilDate = new Date(anchor);
    untilDate.setHours(23, 59, 59, 999);
  } else if (lower.includes('tomorrow')) {
    untilDate = new Date(anchor.getTime() + 24 * 60 * 60 * 1000);
    untilDate.setHours(23, 59, 59, 999);
  } else if (lower.includes('this week') || lower.includes('for now') || lower.includes('currently')) {
    // End of current 7-day window
    untilDate = new Date(anchor.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else if (lower.includes('next week')) {
    untilDate = new Date(anchor.getTime() + 14 * 24 * 60 * 60 * 1000);
  } else if (lower.includes('this month')) {
    untilDate = new Date(anchor.getTime() + 30 * 24 * 60 * 60 * 1000);
  } else if (lower.includes('temporarily')) {
    untilDate = new Date(anchor.getTime() + 3 * 24 * 60 * 60 * 1000);
  }

  if (untilDate) {
    return {
      valid_from,
      valid_until: untilDate.toISOString(),
    };
  }

  return undefined;
}

/**
 * Categorizes a memory candidate based on semantic content.
 */
export function detectMemoryCategory(text: string): MemoryCategory {
  const lower = text.toLowerCase();
  if (/\b(prefer|like|dislike|hate|love|always|never|favorite|favourite|style)\b/i.test(lower)) {
    return 'preference';
  }
  if (/\b(goal|aspire|aim|want to achieve|target|plan to)\b/i.test(lower)) {
    return 'goal_aspiration';
  }
  if (/\b(every day|daily|weekly|routine|habit|always at|morning ritual)\b/i.test(lower)) {
    return 'routine';
  }
  if (/\b(friend|wife|husband|partner|brother|sister|mother|father|colleague|boss|mentor)\b/i.test(lower)) {
    return 'relationship';
  }
  if (/\b(project|repository|repo|flowmate|app|client|deadline|deliverable|stack)\b/i.test(lower)) {
    return 'project_context';
  }
  return 'fact';
}

/**
 * Assesses the sensitivity tier of candidate memory.
 */
export function detectSensitivityTier(text: string): PrivacyTier {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      return 'sensitive';
    }
  }
  if (/\b(private|confidential|secret|personal|salary|income|address|phone)\b/i.test(text)) {
    return 'sensitive';
  }
  return 'private';
}

/**
 * Evaluates candidate memory writes before mutation.
 * Implements strict AI inference gating and write policy rules.
 */
export function evaluateMemoryWrite(input: CandidateMemoryInput): MemoryWriteEvaluation {
  const trimmed = input.content.trim();
  const lower = trimmed.toLowerCase();

  // 1. Check for empty or negligible length
  if (trimmed.length < 3) {
    return {
      action: 'discard_low_value',
      confidence: 0,
      reason: 'Content too brief or empty',
      sensitivity: 'public',
    };
  }

  // 2. Check for low-value chatter
  for (const pattern of DISCARD_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        action: 'discard_low_value',
        confidence: 0.1,
        reason: 'Low-value conversational pleasantry or transient query',
        sensitivity: 'public',
      };
    }
  }

  const sensitivity = input.explicitSensitivity || detectSensitivityTier(trimmed);
  const category = input.category || detectMemoryCategory(trimmed);
  const sourceType = input.sourceType || 'user_explicit';

  // 3. Sensitive data requires explicit confirmation
  if (sensitivity === 'sensitive') {
    return {
      action: 'require_confirmation',
      confidence: sourceType === 'user_explicit' ? 0.95 : 0.6,
      reason: `Sensitive content (${sensitivity}) requires explicit human confirmation`,
      category,
      sensitivity,
      requires_confirmation: true,
      is_inferred: sourceType !== 'user_explicit',
      user_confirmed: false,
    };
  }

  // 4. Check for Situational State (bounded temporal conditions)
  const isSituational = SITUATIONAL_PATTERNS.some((p) => p.test(trimmed));
  const temporalBounds = extractTemporalBounds(trimmed, input.contextDate);

  if (isSituational && temporalBounds) {
    return {
      action: 'set_situational',
      confidence: sourceType === 'user_explicit' ? 0.95 : 0.8,
      reason: 'Temporal boundaries detected; belongs in temporary situational state',
      category,
      temporalBounds,
      sensitivity,
      requires_confirmation: sourceType !== 'user_explicit',
      is_inferred: sourceType !== 'user_explicit',
      user_confirmed: sourceType === 'user_explicit',
    };
  }

  // 5. Inferred memories CANNOT self-confirm
  if (sourceType === 'inferred' || sourceType === 'observed') {
    // If confidence is moderate, propose for confirmation or store unconfirmed
    return {
      action: 'require_confirmation',
      confidence: 0.75,
      reason: 'AI-inferred memory cannot self-confirm; requires user confirmation',
      category,
      sensitivity,
      requires_confirmation: true,
      is_inferred: true,
      user_confirmed: false,
    };
  }

  // 6. Durable user-explicit persistent memory
  return {
    action: 'persist_memory',
    confidence: 1.0,
    reason: 'Explicit durable user fact or preference',
    category,
    sensitivity,
    requires_confirmation: false,
    is_inferred: false,
    user_confirmed: true,
  };
}

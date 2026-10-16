/**
 * Flowmate Greenfield Domain Kernel — Memory Contradiction Engine (P1-07)
 *
 * Detects and handles conflicting or contradicting persistent memories:
 * - Detects topic/polar contradiction between new and existing memories
 * - Evaluates temporal precedence and provenance to determine whether to supersede or mark conflicted
 * - Prevents silent overwriting while surfacing ambiguity transparently
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { PersistentMemoryItem } from './memoryTypes';

// Opposing polarity patterns
interface PolarityPair {
  topic: string;
  positive: RegExp;
  negative: RegExp;
}

const POLARITY_PAIRS: PolarityPair[] = [
  {
    topic: 'response_length',
    positive: /\b(concise|brief|short|succinct|bullet\s*points?|terse)\b/i,
    negative: /\b(detailed|in-depth|thorough|verbose|long|elaborate|deep\s*dive)\b/i,
  },
  {
    topic: 'dietary_preference',
    positive: /\b(vegetarian|vegan|plant-based)\b/i,
    negative: /\b(non-veg|meat|carnivore|eats\s*chicken|eats\s*fish|eats\s*meat)\b/i,
  },
  {
    topic: 'ui_theme',
    positive: /\b(dark\s*mode|dark\s*theme)\b/i,
    negative: /\b(light\s*mode|light\s*theme)\b/i,
  },
  {
    topic: 'work_location',
    positive: /\b(remote|work\s*from\s*home|wfh)\b/i,
    negative: /\b(in-office|at\s*the\s*office|hybrid|on-site)\b/i,
  },
  {
    topic: 'wake_time',
    positive: /\b(early\s*bird|wake\s*up\s*at\s*(?:5|6|7)\s*(?:am)?)\b/i,
    negative: /\b(night\s*owl|wake\s*up\s*at\s*(?:9|10|11)\s*(?:am)?)\b/i,
  },
  {
    topic: 'notification_frequency',
    positive: /\b(mute|silent|do\s*not\s*disturb|minimal\s*notifications?)\b/i,
    negative: /\b(notify\s*immediately|urgent\s*alerts|ping\s*me\s*always)\b/i,
  },
];

export interface ContradictionResult {
  isConflict: boolean;
  topic?: string;
  reason?: string;
}

/**
 * Checks if two pieces of memory text contradict each other.
 */
export function evaluateContradiction(textA: string, textB: string): ContradictionResult {
  const normA = textA.trim().toLowerCase();
  const normB = textB.trim().toLowerCase();

  // If text is identical or nearly identical, not a contradiction (it's a duplicate)
  if (normA === normB) {
    return { isConflict: false };
  }

  for (const pair of POLARITY_PAIRS) {
    const aPos = pair.positive.test(normA);
    const aNeg = pair.negative.test(normA);
    const bPos = pair.positive.test(normB);
    const bNeg = pair.negative.test(normB);

    if ((aPos && bNeg) || (aNeg && bPos)) {
      return {
        isConflict: true,
        topic: pair.topic,
        reason: `Direct contradiction on ${pair.topic}: "${textA}" vs "${textB}"`,
      };
    }
  }

  // Check explicit negation on same subject: "prefer X" vs "do not prefer X" / "never X"
  const preferRegex = /\bprefer(?:s)?\s+([a-zA-Z0-9_-]+)/i;
  const matchA = normA.match(preferRegex);
  const matchB = normB.match(preferRegex);

  if (matchA && matchB && matchA[1] !== matchB[1]) {
    // Both define a preferred X in the same sentence structure
    if (normA.includes(matchA[1]) && normB.includes(matchB[1])) {
      // Check if they are mutually exclusive categories
      if (
        (normA.includes('coffee') && normB.includes('tea')) ||
        (normA.includes('mac') && normB.includes('windows')) ||
        (normA.includes('chrome') && normB.includes('firefox'))
      ) {
        return {
          isConflict: true,
          topic: 'preference_override',
          reason: `Competing preferences: "${textA}" vs "${textB}"`,
        };
      }
    }
  }

  return { isConflict: false };
}

export type ContradictionResolutionStrategy =
  | 'supersede'
  | 'mark_conflicted'
  | 'keep_both';

export interface ContradictionResolution {
  strategy: ContradictionResolutionStrategy;
  reason: string;
}

/**
 * Resolves a contradiction between an existing memory and a new incoming memory.
 * - If incoming is explicit and newer than existing, incoming supersedes existing.
 * - If incoming is inferred while existing is explicit, existing wins, mark incoming conflicted or discard.
 * - If ambiguous, mark both as conflicted to prompt human clarification.
 */
export function resolveContradiction(
  existing: PersistentMemoryItem,
  incoming: PersistentMemoryItem
): ContradictionResolution {
  const check = evaluateContradiction(existing.content, incoming.content);
  if (!check.isConflict) {
    return {
      strategy: 'keep_both',
      reason: 'No contradiction detected',
    };
  }

  // 1. Explicit user statement vs inferred/observed
  if (incoming.source_type === 'user_explicit' && existing.source_type !== 'user_explicit') {
    return {
      strategy: 'supersede',
      reason: `User explicit instruction overrides older ${existing.source_type} memory: ${check.reason}`,
    };
  }

  if (existing.source_type === 'user_explicit' && incoming.source_type !== 'user_explicit') {
    return {
      strategy: 'mark_conflicted',
      reason: `Incoming inferred memory cannot override explicit user memory: ${check.reason}`,
    };
  }

  // 2. Both explicit — check timestamps
  if (incoming.source_type === 'user_explicit' && existing.source_type === 'user_explicit') {
    const existingDate = new Date(existing.updated_at || existing.created_at).getTime();
    const incomingDate = new Date(incoming.updated_at || incoming.created_at).getTime();

    if (incomingDate > existingDate) {
      return {
        strategy: 'supersede',
        reason: `Newer explicit user instruction supersedes older memory: ${check.reason}`,
      };
    }
  }

  // 3. Ambiguous or low confidence -> mark conflicted
  return {
    strategy: 'mark_conflicted',
    reason: `Direct contradiction requires user clarification: ${check.reason}`,
  };
}

/**
 * Scans an array of memories and finds all contradictory pairs.
 */
export function findMemoryContradictions(
  memories: PersistentMemoryItem[]
): Array<{ itemA: PersistentMemoryItem; itemB: PersistentMemoryItem; reason: string }> {
  const conflicts: Array<{ itemA: PersistentMemoryItem; itemB: PersistentMemoryItem; reason: string }> = [];

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i];
      const b = memories[j];
      if (a.status === 'superseded' || b.status === 'superseded') continue;
      if (a.status === 'deleted' || b.status === 'deleted') continue;

      const evalRes = evaluateContradiction(a.content, b.content);
      if (evalRes.isConflict) {
        conflicts.push({
          itemA: a,
          itemB: b,
          reason: evalRes.reason || 'Contradiction detected',
        });
      }
    }
  }

  return conflicts;
}

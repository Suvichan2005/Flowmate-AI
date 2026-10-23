/**
 * Flowmate Greenfield Domain Kernel — Context & Memory Types (P1-07)
 *
 * Infrastructure data models for:
 * - User Profile Context (stable facts/preferences)
 * - Persistent Memory (durable knowledge with provenance & lifecycle)
 * - Situational State (temporary context with explicit temporal bounds)
 * - Live Context (ephemeral device/session readings)
 * - Entity Graph Context (relevant kernel entities & capabilities)
 * - External Observations (connected signals with provenance)
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { Provenance, PrivacyTier } from '../kernel/types';

export type MemoryCategory =
  | 'preference'
  | 'fact'
  | 'project_context'
  | 'relationship'
  | 'goal_aspiration'
  | 'routine';

export type MemorySourceType =
  | 'user_explicit'
  | 'user_confirmed'
  | 'observed'
  | 'inferred'
  | 'imported'
  | 'system';

export type MemoryStatus =
  | 'active'
  | 'superseded'
  | 'expired'
  | 'conflicted'
  | 'halted'
  | 'deleted';

export interface PersistentMemoryItem {
  id: string;
  title?: string;
  content: string;
  category: MemoryCategory;
  source_type: MemorySourceType;
  confidence: number; // 0.0 to 1.0
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
  last_relevant_at?: string; // ISO 8601 UTC
  valid_from?: string; // ISO 8601 UTC
  valid_until?: string; // ISO 8601 UTC (optional expiration)
  privacy_tier: PrivacyTier;
  associated_entity_ids?: string[];
  tags?: string[];
  status: MemoryStatus;
  superseded_by?: string;
  supersedes?: string;
  reversal_reason?: string;
  source_turn?: number;
  source_excerpt?: string;
  speaker?: 'user' | 'assistant';
  epistemic_status?:
    | 'user_decision'
    | 'assistant_proposal'
    | 'observed_code'
    | 'inferred_preference'
    | 'superseded'
    | 'rejected';
  implementation_evidence?: {
    files?: string[];
    verified_at_turn?: number;
    verified_at?: string;
  };
  conflict_with?: string[];
  provenance: Provenance;
}

export interface SituationalStateItem {
  id: string;
  topic: string;
  details: string;
  valid_from: string; // ISO 8601 UTC
  valid_until: string; // ISO 8601 UTC (strict temporal bounds)
  confidence: number;
  source_type: MemorySourceType;
  privacy_tier: PrivacyTier;
  associated_entity_ids?: string[];
  tags?: string[];
  provenance: Provenance;
}

export interface UserProfileContext {
  userId: string;
  name?: string;
  nickname?: string;
  email?: string;
  timezone: string;
  stable_preferences: string[];
}

export interface ContextBudgetConfig {
  maxMemoryItems: number; // e.g. 5
  maxSituationalItems: number; // e.g. 3
  maxEntityItems: number; // e.g. 5
  maxContextTokensApprox: number; // e.g. 1500 tokens (~6000 chars)
  maxTotalChars?: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudgetConfig = {
  maxMemoryItems: 5,
  maxSituationalItems: 3,
  maxEntityItems: 5,
  maxContextTokensApprox: 1500,
};

export interface ResolvedContext {
  userProfile: UserProfileContext;
  currentTimestamp: {
    iso: string;
    localFormatted: string;
    timeOfDay: string;
    timezone: string;
  };
  situationalContext: SituationalStateItem[];
  relevantMemories: PersistentMemoryItem[];
  conflictedMemories: Array<{
    itemA: PersistentMemoryItem;
    itemB: PersistentMemoryItem;
    reason: string;
  }>;
  relevantEntities: Array<{
    id: string;
    title: string;
    schema_id: string;
    status?: string;
    summary?: string;
  }>;
  serializedPromptSection: string;
  budgetStats: {
    totalCharacters: number;
    memoriesIncluded: number;
    entitiesIncluded: number;
    situationalIncluded: number;
  };
}

export interface MemoryWriteEvaluation {
  action: 'persist_memory' | 'set_situational' | 'discard_low_value' | 'require_confirmation';
  confidence: number;
  reason: string;
  category?: MemoryCategory;
  temporalBounds?: {
    valid_from: string;
    valid_until: string;
  };
  sensitivity: PrivacyTier;
  requires_confirmation?: boolean;
  is_inferred?: boolean;
  user_confirmed?: boolean;
}

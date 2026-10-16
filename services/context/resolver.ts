/**
 * Flowmate Greenfield Domain Kernel — Unified Context Resolver Engine (P1-07)
 *
 * READ/ASSEMBLY ONLY infrastructure that constructs rich, bounded, privacy-filtered
 * context for both text AI (orchestrator) and voice AI (Gemini Live).
 *
 * Internal Context Classes:
 * 1. User Profile: Stable identity facts, timezone, home base, communication preferences
 * 2. Persistent Memory: Durable knowledge with decay ranking and privacy filters
 * 3. Situational State: Temporally-bounded conditions with natural expiration
 * 4. Live Context: Ephemeral device/session readings governed by P1-03 privacy
 * 5. Domain Entities & Capabilities: Canonical entities + P1-06 commitment/streak projections
 * 6. External Observations: Connected signals with provenance
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { useStore } from '../../store';
import { UserSettings } from '../../types';
import { Entity as KernelEntity, PrivacyTier } from '../kernel/types';
import {
  evaluateCommitmentProgress,
  calculateStreakProjection,
  parseCommitmentTarget,
  parseEvidenceItems,
} from '../kernel';
import { privacyManager } from './privacy';
import { liveContext } from './liveContext';
import {
  isLocationRelevantQuery,
  formatLiveLocationForContext,
  buildTimeContext,
} from '../ai/context';
import {
  PersistentMemoryItem,
  SituationalStateItem,
  UserProfileContext,
  ContextBudgetConfig,
  DEFAULT_CONTEXT_BUDGET,
  ResolvedContext,
  MemoryCategory,
  MemorySourceType,
  MemoryStatus,
} from './memoryTypes';
import { findMemoryContradictions } from './contradiction';

export interface ContextResolverOptions {
  userMessage?: string;
  source?: 'text_chat' | 'voice_session' | 'background_agent';
  budgetConfig?: Partial<ContextBudgetConfig>;
  forceFreshLocation?: boolean;
  skipLocationAcquisition?: boolean;
}

// ---------------------------------------------------------------------------
// Pure Type-Safe Extractors (ZERO any)
// ---------------------------------------------------------------------------

function getStringAttr(attributes: Record<string, unknown>, key: string, fallback = ''): string {
  const val = attributes[key];
  return typeof val === 'string' ? val : fallback;
}

function getNumberAttr(attributes: Record<string, unknown>, key: string, fallback = 0): number {
  const val = attributes[key];
  return typeof val === 'number' ? val : fallback;
}

function getStringArrayAttr(attributes: Record<string, unknown>, key: string): string[] {
  const val = attributes[key];
  if (Array.isArray(val)) {
    return val.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

/**
 * Authoritative boundary check for egress to external model or wire.
 * Returns true if an entity is soft-deleted, tombstoned, or privacy-restricted to device_local / local_only.
 */
export function isEntityExcludedFromEgress(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const rec = item as Record<string, unknown>;
  const meta = rec.metadata && typeof rec.metadata === 'object' ? (rec.metadata as Record<string, unknown>) : undefined;
  const attrs = rec.attributes && typeof rec.attributes === 'object' ? (rec.attributes as Record<string, unknown>) : undefined;
  const lc = rec.lifecycle && typeof rec.lifecycle === 'object' ? (rec.lifecycle as Record<string, unknown>) : undefined;

  // Deletion markers
  if (rec.deleted === true || meta?.deleted === true || attrs?.deleted === true || lc?.deleted === true) return true;
  if (rec.status === 'deleted' || meta?.status === 'deleted' || attrs?.status === 'deleted' || lc?.status === 'deleted') return true;
  if (rec.deleted_at !== null && rec.deleted_at !== undefined) return true;
  if (meta?.deleted_at !== null && meta?.deleted_at !== undefined) return true;
  if (attrs?.deleted_at !== null && attrs?.deleted_at !== undefined) return true;
  if (lc?.deleted_at !== null && lc?.deleted_at !== undefined) return true;

  // Privacy tier markers (device_local / local_only must never egress)
  const tiers = [rec.privacy_tier, meta?.privacy_tier, attrs?.privacy_tier, lc?.privacy_tier];
  if (tiers.some(t => typeof t === 'string' && (t === 'device_local' || t === 'local_only'))) return true;

  return false;
}

/**
 * Checks whether an entity has been superseded.
 * Strictly ignores string 'false' so active items are not falsely excluded.
 */
export function isEntitySuperseded(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const rec = item as Record<string, unknown>;
  const meta = rec.metadata && typeof rec.metadata === 'object' ? (rec.metadata as Record<string, unknown>) : undefined;
  const attrs = rec.attributes && typeof rec.attributes === 'object' ? (rec.attributes as Record<string, unknown>) : undefined;
  const lc = rec.lifecycle && typeof rec.lifecycle === 'object' ? (rec.lifecycle as Record<string, unknown>) : undefined;

  const isSup = (val: unknown) => val === true || val === 'true';

  if (isSup(rec.superseded) || isSup(meta?.superseded) || isSup(attrs?.superseded) || isSup(lc?.superseded)) return true;
  if (rec.status === 'superseded' || meta?.status === 'superseded' || attrs?.status === 'superseded' || lc?.status === 'superseded') return true;

  const isEpistemicExcluded = (val: unknown) => val === 'superseded' || val === 'rejected';
  if (isEpistemicExcluded(rec.epistemic_status) || isEpistemicExcluded(meta?.epistemic_status) || isEpistemicExcluded(attrs?.epistemic_status) || isEpistemicExcluded(lc?.epistemic_status)) return true;

  const supersededBy = rec.superseded_by ?? attrs?.superseded_by ?? meta?.superseded_by;
  if (typeof supersededBy === 'string' && supersededBy.trim() !== '') return true;

  return false;
}

/**
 * Extracts a PersistentMemoryItem from a canonical KernelEntity.
 */
export function extractMemoryItem(e: KernelEntity): PersistentMemoryItem {
  const eObj = e as unknown as Record<string, unknown>;
  const meta = eObj.metadata && typeof eObj.metadata === 'object' ? (eObj.metadata as Record<string, unknown>) : undefined;
  const attrs = (e.attributes || {}) as Record<string, unknown>;
  const valid_from = typeof attrs.valid_from === 'string' ? attrs.valid_from : undefined;
  const valid_until = typeof attrs.valid_until === 'string' ? attrs.valid_until : undefined;
  const last_relevant_at = typeof attrs.last_relevant_at === 'string' ? attrs.last_relevant_at : undefined;
  const superseded_by = typeof attrs.superseded_by === 'string' ? attrs.superseded_by : undefined;
  const supersedes = typeof attrs.supersedes === 'string' ? attrs.supersedes : undefined;
  const reversal_reason = typeof attrs.reversal_reason === 'string' ? attrs.reversal_reason : undefined;
  const source_turn = typeof attrs.source_turn === 'number' ? attrs.source_turn : undefined;
  const source_excerpt = typeof attrs.source_excerpt === 'string' ? attrs.source_excerpt : undefined;
  const speaker = attrs.speaker === 'user' || attrs.speaker === 'assistant' ? attrs.speaker : undefined;
  const rawEpistemic = typeof attrs.epistemic_status === 'string' ? attrs.epistemic_status : undefined;
  const epistemic_status = (
    rawEpistemic === 'user_decision' ||
    rawEpistemic === 'assistant_proposal' ||
    rawEpistemic === 'observed_code' ||
    rawEpistemic === 'inferred_preference' ||
    rawEpistemic === 'superseded' ||
    rawEpistemic === 'rejected'
  ) ? (rawEpistemic as PersistentMemoryItem['epistemic_status']) : undefined;
  const implementation_evidence = attrs.implementation_evidence && typeof attrs.implementation_evidence === 'object'
    ? (attrs.implementation_evidence as PersistentMemoryItem['implementation_evidence'])
    : undefined;

  const isLocal = (
    attrs.privacy_tier === 'device_local' || attrs.privacy_tier === 'local_only' ||
    eObj.privacy_tier === 'device_local' || eObj.privacy_tier === 'local_only' ||
    meta?.privacy_tier === 'device_local' || meta?.privacy_tier === 'local_only'
  );

  const rawTier = getStringAttr(attrs, 'privacy_tier', '') || (typeof eObj.privacy_tier === 'string' ? eObj.privacy_tier : '') || (typeof meta?.privacy_tier === 'string' ? meta.privacy_tier : '') || 'private';
  const privacy_tier: PrivacyTier = (isLocal ? 'device_local' : rawTier) as PrivacyTier;

  const superseded = isEntitySuperseded(e);

  return {
    id: e.id,
    title: e.title || undefined,
    content: getStringAttr(attrs, 'content', e.title),
    category: (getStringAttr(attrs, 'category', 'fact') as MemoryCategory) || 'fact',
    source_type: (getStringAttr(attrs, 'source_type', 'user_explicit') as MemorySourceType) || 'user_explicit',
    confidence: getNumberAttr(attrs, 'confidence', 1.0),
    created_at: e.lifecycle.created_at,
    updated_at: e.lifecycle.updated_at,
    last_relevant_at,
    valid_from,
    valid_until,
    privacy_tier,
    associated_entity_ids: getStringArrayAttr(attrs, 'associated_entity_ids'),
    tags: getStringArrayAttr(attrs, 'tags'),
    status: superseded
      ? 'superseded'
      : ((getStringAttr(attrs, 'status', 'active') as MemoryStatus) || 'active'),
    superseded_by,
    supersedes,
    reversal_reason,
    source_turn,
    source_excerpt,
    speaker,
    epistemic_status,
    implementation_evidence,
    conflict_with: getStringArrayAttr(attrs, 'conflict_with'),
    provenance: e.provenance,
  };
}

/**
 * Extracts a SituationalStateItem from a canonical KernelEntity.
 */
export function extractSituationalItem(e: KernelEntity): SituationalStateItem {
  const attrs = e.attributes as Record<string, unknown>;
  return {
    id: e.id,
    topic: getStringAttr(attrs, 'topic', e.title),
    details: getStringAttr(attrs, 'details', ''),
    valid_from: getStringAttr(attrs, 'valid_from', e.lifecycle.created_at),
    valid_until: getStringAttr(attrs, 'valid_until', new Date(Date.now() + 7 * 86400000).toISOString()),
    confidence: getNumberAttr(attrs, 'confidence', 1.0),
    source_type: (getStringAttr(attrs, 'source_type', 'user_explicit') as MemorySourceType) || 'user_explicit',
    privacy_tier: (getStringAttr(attrs, 'privacy_tier', 'private') as PrivacyTier) || 'private',
    associated_entity_ids: getStringArrayAttr(attrs, 'associated_entity_ids'),
    tags: getStringArrayAttr(attrs, 'tags'),
    provenance: e.provenance,
  };
}

/**
 * Calculates keyword relevance between text and query.
 */
function calculateTextRelevance(text: string, query: string): number {
  if (!query) return 0.5;
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (qWords.length === 0) return 0.5;

  const lowerText = text.toLowerCase();
  let matches = 0;
  for (const w of qWords) {
    if (lowerText.includes(w)) {
      matches++;
    }
  }
  return matches / qWords.length;
}

// ---------------------------------------------------------------------------
// Context Resolver Engine
// ---------------------------------------------------------------------------

export class ContextResolver {
  /**
   * Resolves the complete context snapshot for the current turn or session.
   */
  async resolveContext(options: ContextResolverOptions = {}): Promise<ResolvedContext> {
    const storeState = useStore.getState();
    const settings: Partial<UserSettings> = storeState.settings || {};
    const currentUser = storeState.currentUser;
    const kernelEntities = storeState.kernelEntities || {};
    const userMessage = options.userMessage || '';

    const budget: ContextBudgetConfig = {
      ...DEFAULT_CONTEXT_BUDGET,
      ...options.budgetConfig,
    };

    // 1. User Profile Context
    const timezone = settings.timezone || 'Asia/Kolkata';
    const stablePreferences: string[] = [];
    if (settings.custom_instructions) {
      stablePreferences.push(settings.custom_instructions);
    }
    if (settings.home_location) {
      stablePreferences.push(`Home location: ${settings.home_location}`);
    }

    const userProfile: UserProfileContext = {
      userId: currentUser?.uid || 'local_user',
      name: currentUser?.displayName || settings.username || undefined,
      nickname: settings.nickname || undefined,
      email: currentUser?.email || undefined,
      timezone,
      home_location: settings.home_location || undefined,
      stable_preferences: stablePreferences,
    };

    // 2. Current Time Context
    const timeCtx = buildTimeContext(timezone);
    const currentTimestamp = {
      iso: timeCtx.isoDate,
      localFormatted: timeCtx.timeString,
      timeOfDay: timeCtx.timeOfDay,
      timezone,
    };

    // 3. Live Context (Device Location) with Privacy Gate
    let liveLocationContext: string | null = null;
    const isLocationSensitive = isLocationRelevantQuery(userMessage);

    if (!options.skipLocationAcquisition && isLocationSensitive) {
      const privacyDecision = privacyManager.checkPermission(
        'device_location',
        'read',
        settings.privacy_preferences
      );

      if (privacyDecision.permitted) {
        try {
          const reading = await liveContext.acquireLocation({
            forceFresh: options.forceFreshLocation ?? true,
            maxAgeMs: 60000,
            reason: 'Context enrichment for current turn',
          });
          if (reading) {
            const placeName = await liveContext.reverseGeocode(reading.lat, reading.lon);
            liveLocationContext = formatLiveLocationForContext(reading, placeName);
            privacyManager.recordAccess(
              'device_location',
              'read',
              'Context enrichment for current turn',
              settings.privacy_preferences
            );
          }
        } catch {
          // Fall back gracefully
          liveLocationContext = null;
        }
      } else {
        liveLocationContext = 'Device location access is currently disabled by privacy policy.';
      }
    }

    // 4. Situational State Extraction (temporal bounded, natural expiration)
    const nowMs = new Date(currentTimestamp.iso).getTime();
    const allEntities = Object.values(kernelEntities);

    const situationalItems: SituationalStateItem[] = [];
    for (const e of allEntities) {
      if (e.schema_id === 'system/situational_state' && !isEntityExcludedFromEgress(e)) {
        const item = extractSituationalItem(e);
        const fromMs = new Date(item.valid_from).getTime();
        const untilMs = new Date(item.valid_until).getTime();

        // Enforce natural temporal expiration: must be currently active
        if (nowMs >= fromMs && nowMs <= untilMs) {
          situationalItems.push(item);
        }
      }
    }

    // Sort situational states by relevance or recency
    situationalItems.sort((a, b) => {
      const scoreA = calculateTextRelevance(`${a.topic} ${a.details}`, userMessage);
      const scoreB = calculateTextRelevance(`${b.topic} ${b.details}`, userMessage);
      return scoreB - scoreA;
    });
    const boundedSituational = situationalItems.slice(0, budget.maxSituationalItems);

    // 5. Persistent Memory Extraction & Decay Ranking (P0 Safety Invariant)
    const memoryItems: PersistentMemoryItem[] = [];
    for (const e of allEntities) {
      if (e.schema_id === 'system/memory_item') {
        // Strict boundary check (deletion, tombstone, device_local, local_only)
        if (isEntityExcludedFromEgress(e)) continue;

        // Strict supersession check
        if (isEntitySuperseded(e)) continue;

        const item = extractMemoryItem(e);

        // Strict device_local exclusion fallback
        if (item.privacy_tier === 'device_local' || (item.privacy_tier as string) === 'local_only') continue;

        // Strict expiration check
        if (item.status === 'expired') continue;
        if (item.valid_until) {
          const expMs = new Date(item.valid_until).getTime();
          if (!isNaN(expMs) && expMs <= nowMs) continue;
        }

        // Strict supersession check fallback
        if (item.status === 'superseded') continue;
        if (item.superseded_by !== undefined && item.superseded_by !== null && item.superseded_by !== '') continue;

        if (item.status === 'active' || item.status === 'conflicted') {
          // Check privacy ceiling: skip sensitive memories unless explicitly allowed
          if (item.privacy_tier !== 'sensitive') {
            memoryItems.push(item);
          }
        }
      }
    }

    // Score memories: (relevance * 0.6) + (confidence * 0.3) + (recency * 0.1)
    const scoredMemories = memoryItems.map((m) => {
      const relScore = calculateTextRelevance(m.content, userMessage);
      const confScore = m.confidence || 1.0;
      const ageHours = (nowMs - new Date(m.updated_at || m.created_at).getTime()) / 3600000;
      const recencyScore = Math.max(0, 1 - ageHours / (30 * 24)); // 30-day linear decay
      const totalScore = relScore * 0.6 + confScore * 0.3 + recencyScore * 0.1;
      return { item: m, score: totalScore };
    });

    scoredMemories.sort((a, b) => b.score - a.score);
    const boundedMemories = scoredMemories.slice(0, budget.maxMemoryItems).map((s) => s.item);

    // 6. Contradiction Detection
    const contradictionResults = findMemoryContradictions(boundedMemories);

    // 7. Domain Entities & Capabilities (Task, Goal, Habit, Project with P1-06 streaks/commitments)
    const domainEntities: Array<{
      id: string;
      title: string;
      schema_id: string;
      status?: string;
      summary?: string;
    }> = [];

    const nonSystemEntities = allEntities.filter(
      (e) =>
        e.schema_id !== 'system/memory_item' &&
        e.schema_id !== 'system/situational_state' &&
        !isEntityExcludedFromEgress(e)
    );

    // Score domain entities
    const scoredEntities = nonSystemEntities.map((e) => {
      const text = `${e.title} ${JSON.stringify(e.attributes)}`;
      const rel = calculateTextRelevance(text, userMessage);
      return { entity: e, score: rel };
    });

    scoredEntities.sort((a, b) => b.score - a.score);
    const topEntities = scoredEntities.slice(0, budget.maxEntityItems).map((s) => s.entity);

    for (const e of topEntities) {
      let summary = '';
      const attrs = e.attributes as Record<string, unknown>;

      // Check for P1-06 Commitment Capability
      if (attrs.commitment && typeof attrs.commitment === 'object') {
        const target = parseCommitmentTarget(attrs.commitment);
        if (target) {
          const evidence = parseEvidenceItems(attrs.evidence);
          const progress = evaluateCommitmentProgress(target, evidence, undefined, new Date(nowMs), timezone);
          const streak = calculateStreakProjection(target, evidence, undefined, 10, new Date(nowMs), timezone);
          summary = `Commitment: ${target.min_count}x ${target.period.toLowerCase()} (Progress: ${progress.current_count}/${progress.target_count}, Streak: ${streak.current_streak})`;
        }
      }

      if (!summary && attrs.notes && typeof attrs.notes === 'string') {
        summary = attrs.notes.slice(0, 80);
      }

      domainEntities.push({
        id: e.id,
        title: e.title,
        schema_id: e.schema_id,
        status: e.lifecycle.status,
        summary: summary || undefined,
      });
    }

    // 8. Serialize Prompt Section & Compute Budget Stats
    let serializedPromptSection = this.formatForTextTurn({
      userProfile,
      currentTimestamp,
      liveLocationContext,
      situationalContext: boundedSituational,
      relevantMemories: boundedMemories,
      conflictedMemories: contradictionResults,
      relevantEntities: domainEntities,
    });

    const maxAllowedChars = budget.maxTotalChars ?? (budget.maxContextTokensApprox * 4);
    if (serializedPromptSection.length > maxAllowedChars) {
      serializedPromptSection = serializedPromptSection.slice(0, maxAllowedChars) + '\n... [budget capped]';
    }

    return {
      userProfile,
      currentTimestamp,
      liveLocationContext,
      situationalContext: boundedSituational,
      relevantMemories: boundedMemories,
      conflictedMemories: contradictionResults,
      relevantEntities: domainEntities,
      serializedPromptSection,
      budgetStats: {
        totalCharacters: serializedPromptSection.length,
        memoriesIncluded: boundedMemories.length,
        entitiesIncluded: domainEntities.length,
        situationalIncluded: boundedSituational.length,
      },
    };
  }

  /**
   * Formats resolved context into dense structured blocks for Gemini Text Orchestration.
   */
  formatForTextTurn(resolved: Omit<ResolvedContext, 'serializedPromptSection' | 'budgetStats'>): string {
    const sections: string[] = [];

    // [User Profile]
    const profileParts: string[] = [];
    if (resolved.userProfile.name) profileParts.push(`Name: ${resolved.userProfile.name}`);
    if (resolved.userProfile.nickname) profileParts.push(`Nickname: ${resolved.userProfile.nickname}`);
    profileParts.push(`Timezone: ${resolved.userProfile.timezone}`);
    if (resolved.userProfile.home_location) profileParts.push(`Home: ${resolved.userProfile.home_location}`);
    if (resolved.userProfile.stable_preferences.length > 0) {
      profileParts.push(`Preferences: ${resolved.userProfile.stable_preferences.join('; ')}`);
    }
    sections.push(`[USER PROFILE]\n${profileParts.join(' | ')}`);

    // [Current Situation & Time]
    const timeParts = [
      `Local: ${resolved.currentTimestamp.localFormatted} (${resolved.currentTimestamp.timeOfDay})`,
      `ISO: ${resolved.currentTimestamp.iso}`,
    ];
    if (resolved.liveLocationContext) {
      timeParts.push(resolved.liveLocationContext);
    }
    sections.push(`[CURRENT TIME & SITUATION]\n${timeParts.join(' | ')}`);

    // [Situational State]
    if (resolved.situationalContext.length > 0) {
      const sitList = resolved.situationalContext.map(
        (s) => `- ${s.topic}: ${s.details} [valid: ${s.valid_from.split('T')[0]} to ${s.valid_until.split('T')[0]}]`
      );
      sections.push(`[ACTIVE SITUATIONAL STATE]\n${sitList.join('\n')}`);
    }

    // [Persistent Memory]
    if (resolved.relevantMemories.length > 0) {
      const memList = resolved.relevantMemories.map((m) => {
        const metaParts: string[] = [];
        if (m.epistemic_status) {
          metaParts.push(`epistemic: ${m.epistemic_status}`);
        }
        if (m.status && m.status !== 'active') {
          metaParts.push(`status: ${m.status}`);
        }
        metaParts.push(`confidence: ${m.confidence.toFixed(2)}`);
        metaParts.push(`source: ${m.source_type}`);
        if (m.source_turn !== undefined) {
          metaParts.push(`turn: ${m.source_turn}`);
        }
        const metaSuffix = metaParts.length > 0 ? ` [${metaParts.join(', ')}]` : '';
        const reversalSuffix = m.reversal_reason ? ` (Reversal reason: ${m.reversal_reason})` : '';
        return `- (${m.category}) ${m.content}${metaSuffix}${reversalSuffix}`;
      });
      sections.push(`[RELEVANT MEMORY]\n${memList.join('\n')}`);
    }

    // [Memory Conflicts/Ambiguities]
    if (resolved.conflictedMemories.length > 0) {
      const conflictList = resolved.conflictedMemories.map(
        (c) => `- CONFLICT: "${c.itemA.content}" vs "${c.itemB.content}" (${c.reason})`
      );
      sections.push(`[MEMORY AMBIGUITIES — VERIFY WITH USER IF RELEVANT]\n${conflictList.join('\n')}`);
    }

    // [Relevant Entities & Capabilities]
    if (resolved.relevantEntities.length > 0) {
      const entList = resolved.relevantEntities.map((e) => {
        const extra = e.summary ? ` — ${e.summary}` : '';
        return `- ${e.schema_id} "${e.title}" [status: ${e.status || 'ACTIVE'}]${extra}`;
      });
      sections.push(`[RELEVANT ENTITIES & CAPABILITIES]\n${entList.join('\n')}`);
    }

    return sections.join('\n\n');
  }

  /**
   * Formats resolved context into natural, conversational instructions for Gemini Live voice.
   */
  formatForVoiceSession(resolved: ResolvedContext): string {
    const lines: string[] = [
      `You are Flowmate, a seamless personal productivity and life operating assistant.`,
      `Keep spoken responses concise, natural, conversational, and direct.`,
      ``,
      `CURRENT CONTEXT:`,
      `- Local Time: ${resolved.currentTimestamp.localFormatted} (${resolved.currentTimestamp.timezone})`,
    ];

    if (resolved.userProfile.name) {
      lines.push(`- User: ${resolved.userProfile.name}`);
    }

    if (resolved.liveLocationContext) {
      lines.push(`- Location: ${resolved.liveLocationContext}`);
    }

    if (resolved.situationalContext.length > 0) {
      lines.push(`- Current Situation: ${resolved.situationalContext.map((s) => `${s.topic} (${s.details})`).join('; ')}`);
    }

    if (resolved.relevantMemories.length > 0) {
      lines.push(
        `- Key Knowledge: ${resolved.relevantMemories
          .map((m) => {
            if (m.epistemic_status === 'assistant_proposal') {
              return `[Proposal] ${m.content}`;
            }
            if (m.status === 'halted') {
              return `[Halted] ${m.content}`;
            }
            return m.content;
          })
          .join('; ')}`
      );
    }

    if (resolved.conflictedMemories.length > 0) {
      lines.push(`- Conflicting Preferences: Ask gently for clarification if relevant.`);
    }

    if (resolved.relevantEntities.length > 0) {
      lines.push(`- Relevant Items: ${resolved.relevantEntities.map((e) => `${e.title}${e.summary ? ` (${e.summary})` : ''}`).join(', ')}`);
    }

    return lines.join('\n');
  }
}

export const contextResolver = new ContextResolver();

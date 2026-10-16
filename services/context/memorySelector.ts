/**
 * Flowmate Shared Context & Memory Selector (P1 Safety Hardening)
 *
 * Implements authoritative, shared filtering and privacy-boundary enforcement for
 * memory items and situational state.
 *
 * Guarantees:
 * 1. Tombstone Supremacy: Deleted memories (lifecycle.deleted_at, status='deleted') are NEVER returned.
 * 2. Temporal Validity: Expired memories (valid_until in the past, status='expired') are strictly excluded by default.
 * 3. Privacy Boundary Ceiling: `device_local` / local-only memories are NEVER exposed over the wire or to external model tool responses.
 * 4. Epistemic Hygiene: Superseded or rejected beliefs are excluded unless explicitly requested with include_superseded.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { Entity as KernelEntity, PrivacyTier } from '../kernel/types';
import { PersistentMemoryItem, MemoryCategory, SituationalStateItem } from './memoryTypes';
import { extractMemoryItem, extractSituationalItem } from './resolver';

export interface MemorySelectorOptions {
  readonly query?: string;
  readonly category?: string;
  readonly include_superseded?: boolean;
  readonly include_situational?: boolean;
  readonly include_expired?: boolean;
  readonly allow_device_local?: boolean; // Defaults to false
  readonly max_privacy_tier?: 'public' | 'private' | 'sensitive';
  readonly limit?: number;
  readonly now?: string | Date;
}

export interface SelectedMemoryMatch {
  readonly id: string;
  readonly schema_id: string;
  readonly content: string;
  readonly title?: string;
  readonly category: string;
  readonly epistemic_status?: string;
  readonly privacy_tier: PrivacyTier;
  readonly confidence: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly valid_until?: string;
  readonly tags?: string[];
  readonly score: number;
  readonly entity: KernelEntity;
  readonly itemRecord: Record<string, unknown>;
}

const PRIVACY_RANKS: Record<string, number> = {
  public: 1,
  private: 2,
  sensitive: 3,
  device_local: 4,
  local_only: 4,
};

const STOPWORDS = new Set<string>([
  'what', 'which', 'who', 'how', 'why', 'when', 'where',
  'did', 'does', 'doing', 'done',
  'the', 'and', 'for', 'with', 'about', 'from', 'into',
  'user', 'assistant', 'say', 'tell', 'said',
  'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
  'this', 'that', 'these', 'those', 'any', 'all',
]);

/**
 * Returns true if an entity is a tombstone (soft-deleted).
 */
/**
 * Returns true if an entity is a tombstone (soft-deleted).
 */
export function isEntityTombstone(e: KernelEntity): boolean {
  if (!e) return false;
  if (e.lifecycle?.status === 'deleted') return true;
  if (e.lifecycle?.deleted_at !== null && e.lifecycle?.deleted_at !== undefined) return true;
  if (((e.lifecycle as unknown) as Record<string, unknown> | undefined)?.deleted === true) return true;

  const top = e as unknown as Record<string, unknown>;
  if (top.deleted === true || top.status === 'deleted') return true;
  if (top.deleted_at !== null && top.deleted_at !== undefined) return true;

  if (top.metadata && typeof top.metadata === 'object') {
    const meta = top.metadata as Record<string, unknown>;
    if (meta.deleted === true || meta.status === 'deleted') return true;
    if (meta.deleted_at !== null && meta.deleted_at !== undefined) return true;
  }

  if (top.attributes && typeof top.attributes === 'object') {
    const attrs = top.attributes as Record<string, unknown>;
    if (attrs.deleted === true || attrs.status === 'deleted') return true;
    if (attrs.deleted_at !== null && attrs.deleted_at !== undefined) return true;
  }

  return false;
}

/**
 * Returns true if a memory timestamp has passed expiration.
 */
export function isMemoryExpired(validUntil: string | undefined | null, nowMs: number, entity?: KernelEntity): boolean {
  if (validUntil) {
    const expTime = new Date(validUntil).getTime();
    if (!isNaN(expTime) && expTime <= nowMs) return true;
  }
  if (entity) {
    const entRec = entity as unknown as Record<string, unknown>;
    const attrs = entRec.attributes as Record<string, unknown> | undefined;
    if (attrs && typeof attrs.valid_until === 'string') {
      const expTime = new Date(attrs.valid_until).getTime();
      if (!isNaN(expTime) && expTime <= nowMs) return true;
    }
    if (attrs && attrs.status === 'expired') return true;
  }
  return false;
}

/**
 * Returns true if privacy tier is restricted to device local only.
 * Inspects tier string, top-level property, metadata, attributes, and lifecycle.
 */
export function isDeviceLocal(entityOrTier: unknown): boolean {
  if (!entityOrTier) return false;
  if (typeof entityOrTier === 'string') {
    return entityOrTier === 'device_local' || entityOrTier === 'local_only';
  }
  if (typeof entityOrTier === 'object') {
    const rec = entityOrTier as Record<string, unknown>;
    const meta = rec.metadata as Record<string, unknown> | undefined;
    const attrs = rec.attributes as Record<string, unknown> | undefined;
    const lc = rec.lifecycle as Record<string, unknown> | undefined;
    const tiers = [rec.privacy_tier, meta?.privacy_tier, attrs?.privacy_tier, lc?.privacy_tier];
    return tiers.some(t => typeof t === 'string' && (t === 'device_local' || t === 'local_only'));
  }
  return false;
}

/**
 * Returns true if memory belief has been superseded or rejected.
 */
export function isMemorySuperseded(item: PersistentMemoryItem, entity?: KernelEntity): boolean {
  if (item.status === 'superseded') return true;
  if ((item.epistemic_status as unknown) === 'superseded' || (item.epistemic_status as unknown) === 'rejected') return true;
  if (item.superseded_by !== undefined && item.superseded_by !== null && item.superseded_by !== '') return true;

  const isSup = (val: unknown) => val === true || val === 'true';

  const itemRec = item as unknown as Record<string, unknown>;
  if (isSup(itemRec.superseded)) return true;

  if (entity) {
    const entRec = entity as unknown as Record<string, unknown>;
    const attrs = entRec.attributes as Record<string, unknown> | undefined;
    const meta = entRec.metadata as Record<string, unknown> | undefined;
    const lc = entRec.lifecycle as Record<string, unknown> | undefined;
    if (isSup(entRec.superseded) || isSup(attrs?.superseded) || isSup(meta?.superseded) || isSup(lc?.superseded)) return true;
    if (attrs?.status === 'superseded' || meta?.status === 'superseded' || lc?.status === 'superseded') return true;
    if (attrs?.epistemic_status === 'superseded' || attrs?.epistemic_status === 'rejected') return true;
    if (attrs?.superseded_by !== undefined && attrs?.superseded_by !== null && attrs?.superseded_by !== '') return true;
  }

  return false;
}

/**
 * Cleans query tokens by removing punctuation and stopwords.
 */
export function extractSearchTokens(query: string): string[] {
  const qClean = query.toLowerCase().trim();
  if (!qClean) return [];

  const tokens = qClean
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  return tokens.length > 0 ? tokens : qClean.split(/\s+/).filter(Boolean);
}

/**
 * Primary shared selector for memories and situational context.
 * Enforces tombstone supremacy, expiration checks, privacy boundaries, and epistemic hygiene.
 */
export function selectEligibleMemories(
  entities: KernelEntity[],
  options: MemorySelectorOptions = {}
): SelectedMemoryMatch[] {
  const nowMs = options.now
    ? new Date(options.now).getTime()
    : Date.now();

  const query = (options.query || '').toLowerCase().trim();
  const qTokens = extractSearchTokens(query);
  const categoryFilter = options.category?.toLowerCase();
  const includeSuperseded = Boolean(options.include_superseded);
  const includeSituational = Boolean(options.include_situational);
  const includeExpired = Boolean(options.include_expired);
  const allowDeviceLocal = Boolean(options.allow_device_local);
  const maxPrivacyRank = options.max_privacy_tier
    ? PRIVACY_RANKS[options.max_privacy_tier] || 3
    : 3; // Default ceiling: sensitive

  const limit = Math.min(Math.max(1, options.limit || 10), 50);
  const scoredMatches: SelectedMemoryMatch[] = [];

  for (const e of entities) {
    // 1. Tombstone Supremacy Check
    if (isEntityTombstone(e)) {
      continue;
    }

    // 2. Strict Device-Local Protection Check on Entity Level
    if (!allowDeviceLocal && isDeviceLocal(e)) {
      continue;
    }

    if (e.schema_id === 'system/memory_item') {
      const item = extractMemoryItem(e);

      // 3. Epistemic Hygiene Check (Superseded & Rejected)
      if (!includeSuperseded && isMemorySuperseded(item, e)) {
        continue;
      }

      // 4. Expiration Check
      if (!includeExpired) {
        if (item.status === 'expired') continue;
        if (isMemoryExpired(item.valid_until, nowMs, e)) continue;
      }

      // 5. Privacy Ceiling & Device-Local Protection
      const tierStr = (isDeviceLocal(e) ? 'device_local' : (item.privacy_tier as string)) || 'private';
      if (!allowDeviceLocal && isDeviceLocal(tierStr)) {
        continue;
      }
      const itemRank = PRIVACY_RANKS[tierStr] || 2;
      if (itemRank > maxPrivacyRank) {
        continue;
      }

      // 6. Category Filter
      if (categoryFilter && item.category.toLowerCase() !== categoryFilter) {
        continue;
      }

      // 6. Query Keyword Match & Relevance Scoring
      let score = 1.0;
      if (qTokens.length > 0) {
        const searchableText = `${e.title || ''} ${item.content} ${(item.tags || []).join(' ')}`.toLowerCase();
        let matches = 0;
        for (const tok of qTokens) {
          if (searchableText.includes(tok)) {
            matches++;
          }
        }
        if (matches === 0) continue;
        score = matches / qTokens.length;
      }

      const itemRecord: Record<string, unknown> = {
        id: item.id,
        type: 'persistent_memory',
        source: 'persisted_memory',
        title: item.title,
        category: item.category,
        content: item.content,
        confidence: item.confidence,
        status: item.status,
        source_type: item.source_type,
        created_at: item.created_at,
        tags: item.tags,
        superseded_by: item.superseded_by,
        supersedes: item.supersedes,
        reversal_reason: item.reversal_reason,
        source_turn: item.source_turn,
        source_excerpt: item.source_excerpt,
        speaker: item.speaker,
        epistemic_status: item.epistemic_status,
        implementation_evidence: item.implementation_evidence,
        provenance: {
          is_inferred: item.provenance.is_inferred,
          user_confirmed: item.provenance.user_confirmed,
          source_type: item.provenance.source_type,
          source_id: item.provenance.source_id,
        },
      };

      scoredMatches.push({
        id: item.id,
        schema_id: e.schema_id,
        content: item.content,
        title: item.title,
        category: item.category,
        epistemic_status: item.epistemic_status,
        privacy_tier: item.privacy_tier,
        confidence: item.confidence,
        created_at: item.created_at,
        updated_at: item.updated_at,
        valid_until: item.valid_until,
        tags: item.tags,
        score,
        entity: e,
        itemRecord,
      });
    } else if (includeSituational && e.schema_id === 'system/situational_state') {
      const item: SituationalStateItem = extractSituationalItem(e);

      // Expiration check
      if (!includeExpired) {
        if (isMemoryExpired(item.valid_until, nowMs)) continue;
      }

      // Privacy ceiling
      const tierStr = (item.privacy_tier as string) || 'private';
      if (!allowDeviceLocal && isDeviceLocal(tierStr)) {
        continue;
      }
      const itemRank = PRIVACY_RANKS[tierStr] || 2;
      if (itemRank > maxPrivacyRank) {
        continue;
      }

      // Query Keyword Match
      let score = 1.0;
      if (qTokens.length > 0) {
        const searchableText = `${item.topic} ${item.details} ${(item.tags || []).join(' ')}`.toLowerCase();
        let matches = 0;
        for (const tok of qTokens) {
          if (searchableText.includes(tok)) {
            matches++;
          }
        }
        if (matches === 0) continue;
        score = matches / qTokens.length;
      }

      const itemRecord: Record<string, unknown> = {
        id: item.id,
        type: 'situational_state',
        source: 'situational_state',
        topic: item.topic,
        details: item.details,
        valid_from: item.valid_from,
        valid_until: item.valid_until,
        confidence: item.confidence,
        source_type: item.source_type,
      };

      scoredMatches.push({
        id: item.id,
        schema_id: e.schema_id,
        content: `${item.topic}: ${item.details}`,
        title: item.topic,
        category: 'situational_state',
        privacy_tier: item.privacy_tier,
        confidence: item.confidence,
        created_at: item.valid_from,
        updated_at: item.valid_from,
        valid_until: item.valid_until,
        tags: item.tags,
        score,
        entity: e,
        itemRecord,
      });
    }
  }

  // Sort by match score descending, then recency
  scoredMatches.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aTime = new Date(a.updated_at || a.created_at).getTime();
    const bTime = new Date(b.updated_at || b.created_at).getTime();
    return bTime - aTime;
  });

  return scoredMatches.slice(0, limit);
}

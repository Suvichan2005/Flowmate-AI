/**
 * AI Tool Executors
 *
 * Pure functions that execute Gemini function-call tool requests
 * against the local Zustand store / kernel entity snapshot.
 * STRICT INVARIANT: ZERO `any`
 */

import { Entity, EntityKind, EntityStatus, FoodLogEntry, Relationship } from "../../types";
import { useStore } from "../../store";
import {
  KernelAuthorizer,
  QueryAuthorizationContext,
  schemaRegistry,
  capabilityRegistry,
  compactSchemaDigest,
  SchemaDefinition,
  Entity as KernelEntity,
  AttributeValue,
  parseCommitmentTarget,
  parseEvidenceItems,
  evaluateCommitmentProgress,
  calculateStreakProjection,
  EvidenceItem,
  parseReminderPolicy,
  evaluateReminderPolicy,
} from "../kernel";
import { PrivacyTier } from "../kernel/types";
import {
  contextResolver,
  evaluateMemoryWrite,
  extractMemoryItem,
  extractSituationalItem,
  MemoryCategory,
  selectEligibleMemories,
} from "../context";

// ---------------------------------------------------------------------------
// Argument Interfaces
// ---------------------------------------------------------------------------

export interface SearchMemoryArgs {
  query?: string;
  category?: string;
  include_situational?: boolean;
  include_superseded?: boolean;
  limit?: number;
}

export interface GetRelevantContextArgs {
  include_entities?: boolean;
  include_memories?: boolean;
}

export interface ProposeMemoryUpdateArgs {
  content: string;
  category?: string;
  is_situational?: boolean;
  valid_until?: string;
  privacy_tier?: string;
}

export interface QueryRelationshipsArgs {
  entity_id?: string;
  from?: string;
  to?: string;
  type?: string;
  limit?: number;
}

export interface ReadCalendarArgs {
  start_date?: string;
  end_date?: string;
}

export interface SearchEntitiesArgs {
  query?: string;
  tags?: string[];
  kind?: string;
  status?: string;
  limit?: number;
}

export interface LookupFoodHistoryArgs {
  days?: number;
  source?: string;
  vendor?: string;
  limit?: number;
}

export interface GetProductivityStatsArgs {
  start_date?: string;
  end_date?: string;
}

export interface LookupGoalsArgs {
  status?: string;
  include_subtasks?: boolean;
  limit?: number;
}

export interface LookupHabitsArgs {
  include_streaks?: boolean;
  limit?: number;
}

export interface QueryEntitiesArgs {
  query?: string;
  schema_id?: string;
  capability?: string;
  status?: string;
  date_range?: {
    start?: string;
    end?: string;
  };
  tags?: string[];
  limit?: number;
}

export interface ReflectSchemasArgs {
  scope?: string;
  schema_id?: string;
}

export interface QueryCommitmentArgs {
  entity_id: string;
  reference_date?: string;
}

export interface ConfigureCommitmentArgs {
  entity_id: string;
  target_count: number;
  period: 'day' | 'week' | 'month' | 'year';
  target_unit?: string;
  reminder_enabled?: boolean;
  reminder_time?: string;
  reminder_day?: number;
}

export interface RecordCommitmentEvidenceArgs {
  entity_id: string;
  quantity?: number;
  timestamp?: string;
  note?: string;
  user_confirmed?: boolean;
}

export interface QueryEntitiesResult {
  total_matched: number;
  limit: number;
  entities: Array<{
    id: string;
    schema_id: string;
    title: string;
    description: string | null;
    status: string;
    attributes: Record<string, AttributeValue>;
    validity?: { valid_from?: string; valid_until?: string };
    updated_at: string;
  }>;
  error?: string;
}

export type ToolResultItem = {
  id?: string;
  title?: string;
  kind?: string;
  status?: string;
  time?: string;
  tags?: string[];
  progress?: number;
  subtasks?: Array<{ title: string; done?: boolean }>;
  streak?: number;
  last_done?: string;
  food?: string;
  date?: string;
  source?: string;
  vendor?: string;
  cost?: number;
  notes?: string;
  rating?: number;
  [key: string]: unknown;
};

export interface ToolDispatchResultData {
  status?: string;
  total_matched?: number;
  limit?: number;
  entities?: Array<Record<string, unknown>>;
  schemas?: Array<Record<string, unknown>>;
  schema?: Record<string, unknown>;
  length?: number;
  [key: string]: unknown;
  [index: number]: ToolResultItem;
}

export interface ToolDispatchResponse {
  result?: ToolDispatchResultData;
  error?: string;
  [key: string]: unknown;
}

interface ActivityLogItem {
  timestamp: string;
  duration_minutes?: number;
  productivity?: string;
}

interface SubtaskItem {
  title: string;
  completed?: boolean;
}

// ---------------------------------------------------------------------------
// Relevance Scoring
// ---------------------------------------------------------------------------

/** Score an entity's relevance to a user message based on keyword overlap + recency. */
export function calculateRelevance(entity: Entity, userMessage: string): number {
  const terms = userMessage.toLowerCase().split(/\s+/);
  let score = 0;

  const title = (entity.title || '').toLowerCase();
  const kind = entity.kind.toLowerCase();

  // Contexts are high-level containers — slight boost
  if (entity.kind === EntityKind.CONTEXT) score += 8;

  for (const term of terms) {
    if (term.length < 3) continue;
    if (title.includes(term)) score += 5;
    if ((entity.canonical_tags || []).join(' ').toLowerCase().includes(term)) score += 3;
    if ((entity.description || '').toLowerCase().includes(term)) score += 1;
    if (kind.includes(term)) score += 1;
  }

  // Recency boost
  const daysSinceUpdate =
    (Date.now() - new Date(entity.updated_at).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate < 1) score += 2;
  else if (daysSinceUpdate < 7) score += 1;

  return score;
}

// ---------------------------------------------------------------------------
// Greenfield Kernel: query_entities
// ---------------------------------------------------------------------------

/**
 * Unified, bounded, authorized query tool across the kernel graph.
 */
export function executeQueryEntities(
  args: QueryEntitiesArgs = {},
  fallbackEntities?: Entity[]
): QueryEntitiesResult {
  const store = useStore.getState();
  const authorizer = new KernelAuthorizer();
  const authContext: QueryAuthorizationContext = {
    actor: 'ai_agent',
    authenticated_user_id: store.currentUser?.uid || '',
  };

  const authResult = authorizer.authorizeQuery(authContext, 'all');
  if (!authResult.authorized) {
    return {
      total_matched: 0,
      limit: 0,
      entities: [],
      error: authResult.reason || 'Query unauthorized',
    };
  }

  // 1. Gather all registered schemas
  const schemasMap: Record<string, SchemaDefinition> =
    store.schemas && Object.keys(store.schemas).length > 0
      ? store.schemas
      : Object.fromEntries(schemaRegistry.list().map(s => [s.id, s]));

  // 2. Gather candidates: prefer authoritative kernelEntities from store
  let candidates: KernelEntity[] = [];
  if (store.kernelEntities && Object.keys(store.kernelEntities).length > 0) {
    candidates = Object.values(store.kernelEntities);
  } else if (fallbackEntities && fallbackEntities.length > 0) {
    candidates = fallbackEntities.map(e => ({
      id: e.id,
      schema_id: (e as { schema_id?: string }).schema_id || `system/${e.kind.toLowerCase()}`,
      version: 1,
      title: e.title,
      attributes: (e as { attributes?: Record<string, AttributeValue> }).attributes || {
        description: e.description,
        status: e.status,
        priority: e.priority,
        start_time: e.start_time,
        end_time: e.end_time,
        deadline: e.deadline,
        duration_minutes: e.duration_minutes,
        recurrence: e.recurrence,
        canonical_tags: e.canonical_tags,
        ...(e.metadata || {}),
      },
      lifecycle: {
        status: (e.status || 'active').toLowerCase(),
        created_at: e.created_at,
        updated_at: e.updated_at,
        deleted_at: e.metadata?.deleted ? e.updated_at : null,
      },
      provenance: {
        source_type: 'user',
        observed_at: e.created_at,
        confidence: 1.0,
        is_inferred: false,
        user_confirmed: true,
      },
    }));
  }

  // 3. User workspace isolation: reject entities owned by a different user
  if (authContext.authenticated_user_id) {
    candidates = candidates.filter(e => {
      const owner = e.attributes?.owner_id || e.attributes?.user_id;
      if (typeof owner === 'string' && owner.trim()) {
        return owner === authContext.authenticated_user_id;
      }
      return true;
    });
  }

  // 4. Exclude soft-deleted entities (tombstones)
  candidates = candidates.filter(e => {
    if (e.lifecycle?.status === 'deleted' || e.lifecycle?.deleted_at != null) return false;
    const metaDeleted = (e.attributes as Record<string, unknown>)?.deleted;
    if (metaDeleted === true) return false;
    return true;
  });

  // 5. Privacy tier and scope ceiling enforcement (AI agent restricted to allowed scopes & private tier ceiling)
  candidates = candidates.filter(e => {
    const schema = schemasMap[e.schema_id];
    if (schema) {
      if (schema.scope && !authResult.effective_scopes.includes(schema.scope)) return false;
      if (authResult.max_privacy_tier === 'public' && schema.privacy_tier !== 'public') return false;
      if (
        authResult.max_privacy_tier === 'private' &&
        (schema.privacy_tier === 'sensitive' || schema.privacy_tier === 'device_local')
      ) {
        return false;
      }
    }
    // Also verify entity-level privacy tier override if present
    const entityTier = e.attributes?.privacy_tier;
    if (typeof entityTier === 'string') {
      if (authResult.max_privacy_tier === 'public' && entityTier !== 'public') return false;
      if (authResult.max_privacy_tier === 'private' && (entityTier === 'sensitive' || entityTier === 'device_local')) {
        return false;
      }
    }
    return true;
  });

  // 5. Filter by schema_id if requested
  if (args.schema_id && args.schema_id.trim()) {
    const rawTarget = args.schema_id.trim().toLowerCase();
    const targetSchemaId = rawTarget.startsWith('system/') ? rawTarget : `system/${rawTarget}`;
    candidates = candidates.filter(e => {
      const eid = e.schema_id.toLowerCase();
      return eid === rawTarget || eid === targetSchemaId;
    });
  }

  // 6. Filter by capability if requested
  if (args.capability && args.capability.trim()) {
    const targetCap = args.capability.trim().toLowerCase();
    candidates = candidates.filter(e => {
      const schema = schemasMap[e.schema_id];
      if (schema && schema.capabilities) {
        if (schema.capabilities.some(c => c.toLowerCase() === targetCap)) return true;
        if (capabilityRegistry.get(targetCap)) return true;
      }
      return false;
    });
  }

  // 7. Filter by status if requested
  if (args.status && args.status.trim()) {
    const targetStatus = args.status.trim().toLowerCase();
    candidates = candidates.filter(e => {
      const st = (e.lifecycle?.status || '').toLowerCase();
      const attrSt = String(e.attributes?.status || '').toLowerCase();
      return st === targetStatus || attrSt === targetStatus;
    });
  }

  // 8. Filter by tags if requested
  if (args.tags && args.tags.length > 0) {
    const filterTags = args.tags.map(t => t.toLowerCase());
    candidates = candidates.filter(e => {
      const entityTags: string[] = [];
      if (Array.isArray(e.attributes?.tags)) {
        entityTags.push(...e.attributes.tags.map(String));
      }
      if (Array.isArray(e.attributes?.canonical_tags)) {
        entityTags.push(...e.attributes.canonical_tags.map(String));
      }
      const lowerEntityTags = entityTags.map(t => t.toLowerCase());
      return filterTags.some(t => lowerEntityTags.includes(t));
    });
  }

  // 9. Filter by date_range if requested
  if (args.date_range?.start || args.date_range?.end) {
    const startTime = args.date_range.start ? new Date(args.date_range.start).getTime() : -Infinity;
    const endTime = args.date_range.end ? new Date(args.date_range.end).getTime() : Infinity;

    candidates = candidates.filter(e => {
      const datesToCheck: number[] = [];
      if (e.validity?.valid_from) datesToCheck.push(new Date(e.validity.valid_from).getTime());
      if (e.validity?.valid_until) datesToCheck.push(new Date(e.validity.valid_until).getTime());
      if (typeof e.attributes?.start_time === 'string') datesToCheck.push(new Date(e.attributes.start_time).getTime());
      if (typeof e.attributes?.deadline === 'string') datesToCheck.push(new Date(e.attributes.deadline).getTime());
      if (typeof e.attributes?.date === 'string') datesToCheck.push(new Date(e.attributes.date).getTime());

      if (datesToCheck.length === 0) return false;
      return datesToCheck.some(t => !isNaN(t) && t >= startTime && t <= endTime);
    });
  }

  // 10. Filter by text query if requested
  if (args.query && args.query.trim()) {
    const q = args.query.trim().toLowerCase();
    candidates = candidates.filter(e => {
      if (e.title.toLowerCase().includes(q)) return true;
      const desc = typeof e.attributes?.description === 'string' ? e.attributes.description : '';
      if (desc.toLowerCase().includes(q)) return true;
      for (const val of Object.values(e.attributes)) {
        if (typeof val === 'string' && val.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }

  const totalMatched = candidates.length;
  // Bounded results: clamped strictly between 1 and 25
  const safeLimit = Math.min(Math.max(1, typeof args.limit === 'number' ? args.limit : 10), 25);

  // Sort by updated_at descending
  candidates.sort((a, b) => new Date(b.lifecycle.updated_at).getTime() - new Date(a.lifecycle.updated_at).getTime());

  const sliced = candidates.slice(0, safeLimit);

  return {
    total_matched: totalMatched,
    limit: safeLimit,
    entities: sliced.map(e => ({
      id: e.id,
      schema_id: e.schema_id,
      title: e.title,
      description: typeof e.attributes?.description === 'string' ? e.attributes.description : null,
      status: e.lifecycle.status,
      attributes: e.attributes,
      validity: e.validity,
      updated_at: e.lifecycle.updated_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Greenfield Kernel: reflect_schemas
// ---------------------------------------------------------------------------

/**
 * Reflects available schemas and capability contracts to the AI.
 */
export function executeReflectSchemas(
  args: ReflectSchemasArgs = {}
): Record<string, unknown> {
  const store = useStore.getState();
  const allSchemas: SchemaDefinition[] =
    store.schemas && Object.keys(store.schemas).length > 0
      ? Object.values(store.schemas)
      : schemaRegistry.list();

  if (args.schema_id && args.schema_id.trim()) {
    const target = args.schema_id.trim();
    const found = allSchemas.find(
      s => s.id === target || s.id === `system/${target}` || s.id.toLowerCase() === target.toLowerCase()
    );
    if (!found) {
      return { error: `Schema not found: ${args.schema_id}` };
    }
    return { schema: found };
  }

  const scopeFilter = args.scope?.toLowerCase();
  const filtered = allSchemas.filter(s => {
    if (scopeFilter === 'system' && s.scope !== 'system') return false;
    if (scopeFilter === 'user' && s.scope !== 'user') return false;
    return true;
  });

  return {
    total: filtered.length,
    schemas: filtered.map(s => compactSchemaDigest(s)),
  };
}

// ---------------------------------------------------------------------------
// Greenfield Kernel: query_commitment
// ---------------------------------------------------------------------------

export function executeQueryCommitment(
  args: QueryCommitmentArgs
): Record<string, unknown> {
  const store = useStore.getState();
  const authorizer = new KernelAuthorizer();
  const authContext: QueryAuthorizationContext = {
    actor: 'ai_agent',
    authenticated_user_id: store.currentUser?.uid || '',
  };
  const authResult = authorizer.authorizeQuery(authContext, 'all');
  if (!authResult.authorized) {
    return { error: authResult.reason || 'Query unauthorized' };
  }

  const entity = store.kernelEntities?.[args.entity_id];
  if (!entity || entity.lifecycle.status === 'deleted' || entity.attributes.deleted === true) {
    return { error: `Entity not found or deleted: ${args.entity_id}` };
  }

  const rawCommitment = entity.attributes.commitment || entity.attributes;
  const commitment = parseCommitmentTarget(rawCommitment);
  if (!commitment) {
    return { error: `Entity '${entity.title}' does not have a commitment configured.` };
  }

  const evidence = parseEvidenceItems(entity.attributes.evidence);
  const refDate = args.reference_date || new Date().toISOString();

  const progress = evaluateCommitmentProgress(commitment, evidence, undefined, refDate);
  const streak = calculateStreakProjection(commitment, evidence, undefined, 8, refDate);

  const rawReminder = entity.attributes.reminder_policy || entity.attributes.reminder;
  const reminderPolicy = parseReminderPolicy(rawReminder);
  const reminderResult = reminderPolicy
    ? evaluateReminderPolicy(reminderPolicy, progress, entity.title, entity.id, refDate)
    : null;

  return {
    entity_id: entity.id,
    title: entity.title,
    target: {
      min_count: commitment.min_count,
      period: commitment.period,
      unit: commitment.target_unit || 'times',
    },
    current_period: {
      label: progress.period_window.label,
      start: progress.period_window.start,
      end: progress.period_window.end,
      current_count: progress.current_count,
      target_count: progress.target_count,
      percentage: progress.percentage,
      is_completed: progress.is_completed,
    },
    streak: {
      current_streak: streak.current_streak,
      longest_streak: streak.longest_streak,
      completed_periods: streak.completed_periods,
      missed_periods: streak.missed_periods,
    },
    evidence_count: progress.valid_evidence.length,
    pending_inferred_count: progress.pending_inferred_evidence.length,
    reminder: reminderResult
      ? {
          should_notify: reminderResult.should_notify,
          scheduled_at: reminderResult.scheduled_at,
          reason: reminderResult.reason,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Greenfield Kernel: configure_commitment
// ---------------------------------------------------------------------------

export function executeConfigureCommitment(
  args: ConfigureCommitmentArgs
): Record<string, unknown> {
  const store = useStore.getState();
  const entity = store.kernelEntities?.[args.entity_id];
  if (!entity || entity.lifecycle.status === 'deleted' || entity.attributes.deleted === true) {
    return { error: `Entity not found or deleted: ${args.entity_id}` };
  }

  const periodMap: Record<string, 'daily' | 'weekly' | 'monthly' | 'yearly'> = {
    day: 'daily',
    week: 'weekly',
    month: 'monthly',
    year: 'yearly',
  };
  const cadence = periodMap[args.period] || 'weekly';

  const commitmentObj: Record<string, AttributeValue> = {
    min_count: Math.max(1, args.target_count),
    period: args.period,
    target_unit: args.target_unit || 'times',
  };

  const recurrenceObj: Record<string, AttributeValue> = {
    cadence,
    interval: 1,
    start_date: new Date().toISOString(),
  };

  const reminderObj: Record<string, AttributeValue> | undefined = args.reminder_enabled !== false ? {
    id: `reminder-${args.entity_id}`,
    enabled: true,
    trigger: 'period_end_approaching',
    lead_time_hours: 24,
    preferred_time_of_day: args.reminder_time || '18:00',
    preferred_day_of_week: typeof args.reminder_day === 'number' ? args.reminder_day : 0,
    channel: 'in_app',
    suppress_when_completed: true,
  } : undefined;

  store.applyOperations([
    {
      type: 'update_entity',
      payload: {
        id: args.entity_id,
        fields: {
          metadata: {
            commitment: commitmentObj,
            recurrence: recurrenceObj,
            ...(reminderObj ? { reminder_policy: reminderObj } : {}),
          },
          attributes: {
            commitment: commitmentObj,
            recurrence: recurrenceObj,
            ...(reminderObj ? { reminder_policy: reminderObj } : {}),
          },
        },
      },
    },
  ]);

  return {
    success: true,
    entity_id: args.entity_id,
    title: entity.title,
    commitment: commitmentObj,
    recurrence: recurrenceObj,
    reminder_policy: reminderObj || null,
  };
}

// ---------------------------------------------------------------------------
// Greenfield Kernel: record_commitment_evidence
// ---------------------------------------------------------------------------

export function executeRecordCommitmentEvidence(
  args: RecordCommitmentEvidenceArgs
): Record<string, unknown> {
  const store = useStore.getState();
  const entity = store.kernelEntities?.[args.entity_id];
  if (!entity || entity.lifecycle.status === 'deleted' || entity.attributes.deleted === true) {
    return { error: `Entity not found or deleted: ${args.entity_id}` };
  }

  const existingEvidence = parseEvidenceItems(entity.attributes.evidence);
  const nowIso = args.timestamp || new Date().toISOString();
  const isConfirmed = Boolean(args.user_confirmed);

  const newEvidence: EvidenceItem = {
    id: `evidence-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: nowIso,
    quantity: typeof args.quantity === 'number' ? args.quantity : 1,
    note: args.note || 'Recorded commitment evidence',
    provenance: {
      source_type: isConfirmed ? 'user' : 'agent',
      observed_at: nowIso,
      confidence: isConfirmed ? 1.0 : 0.9,
      is_inferred: !isConfirmed,
      user_confirmed: isConfirmed,
    },
  };

  const nextEvidence = [...existingEvidence, newEvidence];

  const evidenceAttributeValue: AttributeValue[] = nextEvidence.map(e => ({
    id: e.id,
    timestamp: e.timestamp,
    quantity: e.quantity || 1,
    note: e.note || '',
    provenance: {
      source_type: e.provenance.source_type,
      observed_at: e.provenance.observed_at,
      confidence: e.provenance.confidence,
      is_inferred: e.provenance.is_inferred,
      user_confirmed: e.provenance.user_confirmed,
    },
  }));

  store.applyOperations([
    {
      type: 'update_entity',
      payload: {
        id: args.entity_id,
        fields: {
          metadata: { evidence: evidenceAttributeValue },
          attributes: { evidence: evidenceAttributeValue },
        },
      },
    },
  ]);

  const rawCommitment = entity.attributes.commitment || entity.attributes;
  const commitment = parseCommitmentTarget(rawCommitment);
  let progressSummary: Record<string, unknown> | null = null;
  if (commitment) {
    const progress = evaluateCommitmentProgress(commitment, nextEvidence);
    const streak = calculateStreakProjection(commitment, nextEvidence);
    progressSummary = {
      current_count: progress.current_count,
      target_count: progress.target_count,
      percentage: progress.percentage,
      is_completed: progress.is_completed,
      current_streak: streak.current_streak,
    };
  }

  return {
    success: true,
    entity_id: args.entity_id,
    recorded_evidence: {
      id: newEvidence.id,
      timestamp: newEvidence.timestamp,
      quantity: newEvidence.quantity,
      note: newEvidence.note,
      is_inferred: newEvidence.provenance.is_inferred,
      user_confirmed: newEvidence.provenance.user_confirmed,
    },
    total_evidence_count: nextEvidence.length,
    progress: progressSummary,
  };
}

// ---------------------------------------------------------------------------
// read_calendar
// ---------------------------------------------------------------------------

export function executeReadCalendar(
  args: ReadCalendarArgs,
  allEntities: Entity[]
): Array<Record<string, unknown>> {
  const startStr = typeof args.start_date === 'string' && args.start_date.length === 10
    ? `${args.start_date}T00:00:00`
    : args.start_date;
  const endStr = typeof args.end_date === 'string' && args.end_date.length === 10
    ? `${args.end_date}T23:59:59.999`
    : args.end_date;

  if (!startStr || !endStr) return [{ error: "Missing start_date or end_date" }];

  const start = new Date(startStr);
  const end = new Date(endStr);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [{ error: "Invalid dates" }];

  return allEntities
    .filter(e => {
      if (e.metadata?.deleted) return false;
      if (e.status === EntityStatus.ARCHIVED || e.status === EntityStatus.CANCELED) return false;

      let dateToCheck: Date | null = null;
      if (e.kind === EntityKind.EVENT && e.start_time) dateToCheck = new Date(e.start_time);
      else if (e.kind === EntityKind.TASK && e.deadline) dateToCheck = new Date(e.deadline);

      return dateToCheck ? dateToCheck >= start && dateToCheck <= end : false;
    })
    .map(e => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      time: e.start_time || e.deadline,
      status: e.status,
      scheduling_certainty: e.scheduling_certainty || (e.metadata?.scheduling_certainty as string | undefined) || 'unknown',
    }));
}

// ---------------------------------------------------------------------------
// search_entities
// ---------------------------------------------------------------------------

export function executeSearchEntities(
  args: SearchEntitiesArgs,
  allEntities: Entity[]
): Array<Record<string, unknown>> {
  const query = (args.query || '').toLowerCase();
  const tags = args.tags || [];
  const kind = args.kind ? args.kind.toUpperCase() : null;
  const status = args.status ? args.status.toUpperCase() : null;
  const limit = args.limit || 15;

  const results = allEntities.filter(e => {
    if (e.metadata?.deleted) return false;
    if (status && e.status !== status) return false;
    if (kind && e.kind !== kind) return false;

    if (tags.length > 0) {
      const entityTags = (e.canonical_tags || []).map(t => t.toLowerCase());
      if (!tags.some(t => entityTags.includes(t.toLowerCase()))) return false;
    }

    if (query) {
      const inTitle = (e.title || '').toLowerCase().includes(query);
      const inDesc = (e.description || '').toLowerCase().includes(query);
      if (!inTitle && !inDesc) return false;
    }

    return true;
  });

  // Sort by relevance when query provided, otherwise by updated_at
  if (query) {
    results.sort((a, b) => {
      const at = (a.title || '').toLowerCase();
      const bt = (b.title || '').toLowerCase();
      if (at === query) return -1;
      if (bt === query) return 1;
      if (at.startsWith(query)) return -1;
      if (bt.startsWith(query)) return 1;
      return 0;
    });
  } else {
    results.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }

  return results.slice(0, limit).map(e => ({
    id: e.id,
    title: e.title,
    kind: e.kind,
    status: e.status,
    tags: e.canonical_tags,
    scheduling_certainty: e.scheduling_certainty || (e.metadata?.scheduling_certainty as string | undefined),
  }));
}

// ---------------------------------------------------------------------------
// lookup_food_history
// ---------------------------------------------------------------------------

export function executeLookupFoodHistory(
  args: LookupFoodHistoryArgs = {}
): Array<Record<string, unknown>> {
  const { foodLogs } = useStore.getState();
  const days = args.days || 30;
  const source = args.source?.toLowerCase();
  const vendor = args.vendor?.toLowerCase();
  const limit = args.limit || 20;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const results = (foodLogs as FoodLogEntry[]).filter(l => {
    if (new Date(l.timestamp) < cutoff) return false;
    if (source && l.source?.toLowerCase() !== source) return false;
    if (vendor && !l.vendor?.toLowerCase().includes(vendor)) return false;
    return true;
  });

  return results
    .slice(-limit)
    .reverse()
    .map(l => ({
      food: l.food_name,
      date: l.timestamp.split('T')[0],
      source: l.source,
      vendor: l.vendor,
      cost: l.cost,
      tags: l.health_tags,
      notes: l.quality_notes,
      rating: l.rating,
    }));
}

// ---------------------------------------------------------------------------
// get_productivity_stats
// ---------------------------------------------------------------------------

export function executeGetProductivityStats(
  args: GetProductivityStatsArgs,
  allEntities: Entity[]
): Record<string, unknown> {
  const startDate = args.start_date
    ? new Date(args.start_date)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = args.end_date ? new Date(args.end_date) : new Date();
  endDate.setHours(23, 59, 59, 999);

  let productiveMinutes = 0;
  let totalMinutes = 0;

  for (const e of allEntities) {
    if (!e.metadata?.activity_log) continue;
    const activityLogs = Array.isArray(e.metadata.activity_log)
      ? (e.metadata.activity_log as ActivityLogItem[])
      : [];
    for (const log of activityLogs) {
      const logDate = new Date(log.timestamp);
      if (logDate < startDate || logDate > endDate) continue;
      const dur = log.duration_minutes || 0;
      totalMinutes += dur;
      if (log.productivity === 'PRODUCTIVE') productiveMinutes += dur;
    }
  }

  const focusScore = totalMinutes > 0
    ? Math.round((productiveMinutes / totalMinutes) * 100)
    : 0;

  const completedTasks = allEntities.filter(e => {
    const updated = new Date(e.updated_at);
    return (
      e.kind === EntityKind.TASK &&
      e.status === EntityStatus.COMPLETED &&
      updated >= startDate &&
      updated <= endDate
    );
  }).length;

  return {
    date_range: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
    focus_score: focusScore + '%',
    productive_hours: Math.round((productiveMinutes / 60) * 10) / 10,
    total_hours: Math.round((totalMinutes / 60) * 10) / 10,
    tasks_completed: completedTasks,
  };
}

// ---------------------------------------------------------------------------
// lookup_goals
// ---------------------------------------------------------------------------

export function executeLookupGoals(
  args: LookupGoalsArgs,
  allEntities: Entity[]
): Array<Record<string, unknown>> {
  const status = args.status?.toUpperCase() || 'ACTIVE';
  const includeSubtasks = args.include_subtasks || false;
  const limit = args.limit || 10;

  let goals = allEntities.filter(e => e.kind === EntityKind.GOAL);
  if (status !== 'ALL') goals = goals.filter(e => e.status === status);

  return goals.slice(0, limit).map(g => {
    const result: Record<string, unknown> = {
      id: g.id,
      title: g.title,
      status: g.status,
      progress: (g.metadata as Record<string, unknown>)?.progress || 0,
    };
    if (includeSubtasks && Array.isArray((g.metadata as Record<string, unknown>)?.subtasks)) {
      const subtasks = (g.metadata as Record<string, unknown>).subtasks as SubtaskItem[];
      result.subtasks = subtasks.map(s => ({
        title: s.title,
        done: s.completed,
      }));
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// lookup_habits
// ---------------------------------------------------------------------------

export function executeLookupHabits(
  args: LookupHabitsArgs,
  allEntities: Entity[]
): Array<Record<string, unknown>> {
  const includeStreaks = args.include_streaks !== false;
  const limit = args.limit || 10;

  const habits = allEntities.filter(e => e.kind === EntityKind.HABIT).slice(0, limit);

  return habits.map(h => {
    const result: Record<string, unknown> = {
      id: h.id,
      title: h.title,
      status: h.status,
    };
    if (includeStreaks) {
      result.streak = (h.metadata as Record<string, unknown>)?.streak_current || 0;
      result.last_done = (h.metadata as Record<string, unknown>)?.last_completed_at;
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// P1-07 Context & Memory Executors
// ---------------------------------------------------------------------------

export function executeSearchMemory(
  args: SearchMemoryArgs
): Array<Record<string, unknown>> {
  const store = useStore.getState();
  const kernelEntities = store.kernelEntities || {};
  const query = args.query;
  const category = args.category;
  const includeSituational = args.include_situational !== false;
  const includeSuperseded = Boolean(args.include_superseded);
  const limit = Math.min(Math.max(1, args.limit || 10), 50);

  const matched = selectEligibleMemories(Object.values(kernelEntities), {
    query,
    category,
    include_superseded: includeSuperseded,
    include_situational: includeSituational,
    include_expired: false,
    allow_device_local: false, // Protected: device_local tier is never returned by default tool executor
    max_privacy_tier: 'sensitive',
    limit,
  });

  return matched.map(m => m.itemRecord);
}


export async function executeGetRelevantContext(
  args: GetRelevantContextArgs
): Promise<Record<string, unknown>> {
  const resolved = await contextResolver.resolveContext({
    budgetConfig: {
      maxEntityItems: args.include_entities === false ? 0 : 5,
      maxMemoryItems: args.include_memories === false ? 0 : 5,
    },
  });

  return {
    user_profile: resolved.userProfile,
    current_time: resolved.currentTimestamp,
    situational_state: resolved.situationalContext.map(s => ({
      topic: s.topic,
      details: s.details,
      valid_until: s.valid_until,
    })),
    relevant_memories: resolved.relevantMemories.map(m => ({
      category: m.category,
      content: m.content,
      confidence: m.confidence,
    })),
    conflicted_memories: resolved.conflictedMemories.map(c => ({
      itemA: c.itemA.content,
      itemB: c.itemB.content,
      reason: c.reason,
    })),
    relevant_entities: resolved.relevantEntities,
  };
}

export function executeProposeMemoryUpdate(
  args: ProposeMemoryUpdateArgs
): Record<string, unknown> {
  if (!args.content || typeof args.content !== 'string') {
    return { error: 'Content is required to propose memory update' };
  }

  const evalResult = evaluateMemoryWrite({
    content: args.content,
    category: args.category as MemoryCategory,
    explicitSensitivity: args.privacy_tier as PrivacyTier,
    sourceType: 'inferred',
  });

  if (evalResult.action === 'discard_low_value') {
    return {
      success: false,
      reason: evalResult.reason,
      recommendation: 'Did not create memory proposal as content is low-value or transient.',
    };
  }

  const isSituational = Boolean(args.is_situational || evalResult.action === 'set_situational');
  const nowIso = new Date().toISOString();

  let proposedOp: Record<string, unknown>;

  if (isSituational) {
    const validUntil =
      args.valid_until ||
      evalResult.temporalBounds?.valid_until ||
      new Date(Date.now() + 7 * 86400000).toISOString();

    proposedOp = {
      type: 'create_entity',
      payload: {
        schema_id: 'system/situational_state',
        title: args.content.slice(0, 60),
        lifecycle: { status: 'active' },
        attributes: {
          topic: args.content.slice(0, 60),
          details: args.content,
          valid_from: nowIso,
          valid_until: validUntil,
          confidence: evalResult.confidence,
          source_type: 'inferred',
          privacy_tier: args.privacy_tier || evalResult.sensitivity || 'internal',
        },
      },
    };
  } else {
    proposedOp = {
      type: 'create_entity',
      payload: {
        schema_id: 'system/memory_item',
        title: args.content.slice(0, 60),
        lifecycle: { status: 'active' },
        attributes: {
          content: args.content,
          category: args.category || evalResult.category || 'fact',
          source_type: 'inferred',
          confidence: evalResult.confidence,
          status: 'active',
          privacy_tier: args.privacy_tier || evalResult.sensitivity || 'internal',
        },
      },
    };
  }

  return {
    evaluation: {
      action: evalResult.action,
      confidence: evalResult.confidence,
      reason: evalResult.reason,
      category: evalResult.category,
      sensitivity: evalResult.sensitivity,
      requires_confirmation: true,
    },
    proposed_operation: proposedOp,
    instruction_to_model:
      'In accordance with Flowmate Memory Safety Policy, AI cannot self-confirm memories. Call apply_changes with this operation so the user can inspect and confirm.',
  };
}

/**
 * Executes a 1-hop query against explicit, persisted relationships.
 * Bounded to max 50 items. Resolves linked entity titles and kinds.
 */
export function executeQueryRelationships(
  args: QueryRelationshipsArgs,
  entities: Entity[],
  relationships?: Relationship[]
): {
  relationships: Array<{
    id: string;
    from: string;
    from_title: string;
    from_kind: string;
    to: string;
    to_title: string;
    to_kind: string;
    type: string;
    source: string;
    created_at: string;
    meta: Record<string, unknown>;
  }>;
  total_found: number;
  source: string;
} {
  const store = useStore.getState();
  const relList = relationships || store.relationships || [];
  const entitiesMap = new Map<string, Entity>();
  for (const e of entities) {
    entitiesMap.set(e.id, e);
  }
  if (store.entities) {
    for (const e of store.entities) {
      if (!entitiesMap.has(e.id)) {
        entitiesMap.set(e.id, e);
      }
    }
  }

  const queryEntityId = args.entity_id?.trim();
  const queryFrom = args.from?.trim();
  const queryTo = args.to?.trim();
  const queryType = args.type?.trim().toUpperCase();

  const filtered = relList.filter((r) => {
    if (queryEntityId && r.from !== queryEntityId && r.to !== queryEntityId) {
      return false;
    }
    if (queryFrom && r.from !== queryFrom) {
      return false;
    }
    if (queryTo && r.to !== queryTo) {
      return false;
    }
    if (queryType && r.type.toUpperCase() !== queryType) {
      return false;
    }
    return true;
  });

  const limit = Math.min(Math.max(1, args.limit || 20), 50);
  const sliced = filtered.slice(0, limit);

  const mapped = sliced.map((r) => {
    const fromEntity = entitiesMap.get(r.from);
    const toEntity = entitiesMap.get(r.to);
    return {
      id: r.id,
      from: r.from,
      from_title: fromEntity?.title || 'Unknown Entity',
      from_kind: fromEntity?.kind || 'UNKNOWN',
      to: r.to,
      to_title: toEntity?.title || 'Unknown Entity',
      to_kind: toEntity?.kind || 'UNKNOWN',
      type: r.type,
      source: 'explicit_persisted',
      created_at: r.created_at,
      meta: (r.meta as Record<string, unknown>) || {},
    };
  });

  return {
    relationships: mapped,
    total_found: filtered.length,
    source: 'explicit_persisted',
  };
}

// ---------------------------------------------------------------------------
// Dispatch Map
// ---------------------------------------------------------------------------

/**
 * Routes a function call from the model to the correct executor.
 * Returns the tool response payload.
 */
export async function dispatchToolCall(
  call: { name: string; args?: Record<string, unknown> },
  entities: Entity[]
): Promise<{ name: string; response: ToolDispatchResponse }> {
  const activeEntities = entities.filter(e => !e.metadata?.deleted);
  const args = call.args || {};

  switch (call.name) {
    case 'query_entities':
      return {
        name: call.name,
        response: { result: executeQueryEntities(args as unknown as QueryEntitiesArgs, activeEntities) as unknown as ToolDispatchResultData },
      };
    case 'query_relationships':
      return {
        name: call.name,
        response: { result: executeQueryRelationships(args as unknown as QueryRelationshipsArgs, activeEntities) as unknown as ToolDispatchResultData },
      };
    case 'reflect_schemas':
      return {
        name: call.name,
        response: { result: executeReflectSchemas(args as unknown as ReflectSchemasArgs) as unknown as ToolDispatchResultData },
      };
    case 'query_commitment':
      return {
        name: call.name,
        response: { result: executeQueryCommitment(args as unknown as QueryCommitmentArgs) as unknown as ToolDispatchResultData },
      };
    case 'configure_commitment':
      return {
        name: call.name,
        response: { result: executeConfigureCommitment(args as unknown as ConfigureCommitmentArgs) as unknown as ToolDispatchResultData },
      };
    case 'record_commitment_evidence':
      return {
        name: call.name,
        response: { result: executeRecordCommitmentEvidence(args as unknown as RecordCommitmentEvidenceArgs) as unknown as ToolDispatchResultData },
      };
    case 'search_memory':
      return {
        name: call.name,
        response: { result: executeSearchMemory(args as unknown as SearchMemoryArgs) as unknown as ToolDispatchResultData },
      };
    case 'get_relevant_context':
      return {
        name: call.name,
        response: { result: (await executeGetRelevantContext(args as unknown as GetRelevantContextArgs)) as unknown as ToolDispatchResultData },
      };
    case 'propose_memory_update':
      return {
        name: call.name,
        response: { result: executeProposeMemoryUpdate(args as unknown as ProposeMemoryUpdateArgs) as unknown as ToolDispatchResultData },
      };
    case 'read_calendar':
      return {
        name: call.name,
        response: { result: executeReadCalendar(args as unknown as ReadCalendarArgs, activeEntities) as unknown as ToolDispatchResultData },
      };
    case 'search_entities':
      return {
        name: call.name,
        response: { result: executeSearchEntities(args as unknown as SearchEntitiesArgs, activeEntities) as unknown as ToolDispatchResultData },
      };
    case 'lookup_food_history':
      return {
        name: call.name,
        response: { result: executeLookupFoodHistory(args as unknown as LookupFoodHistoryArgs) as unknown as ToolDispatchResultData },
      };
    case 'get_productivity_stats':
      return {
        name: call.name,
        response: { result: executeGetProductivityStats(args as unknown as GetProductivityStatsArgs, activeEntities) as unknown as ToolDispatchResultData },
      };
    case 'lookup_goals':
      return {
        name: call.name,
        response: { result: executeLookupGoals(args as unknown as LookupGoalsArgs, activeEntities) as unknown as ToolDispatchResultData },
      };
    case 'lookup_habits':
      return {
        name: call.name,
        response: { result: executeLookupHabits(args as unknown as LookupHabitsArgs, activeEntities) as unknown as ToolDispatchResultData },
      };
    default:
      return { name: call.name, response: { error: "Unknown tool or action handled separately." } };
  }
}


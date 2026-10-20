/**
 * AI Context Builder
 *
 * Builds the context window sent to the model on each turn:
 * - Entity selection (date window + keyword relevance)
 * - Conversation history with rolling summarization
 * - Food context aggregation
 * - Time-of-day awareness
 */

import type { Content } from "@google/genai";
import type { Entity, Message, Relationship } from "../../types";
import { EntityKind, EntityStatus } from "../../types";
import { useStore } from "../../store";
import { stripBase64Prefix, getMimeType } from "../../utils/imageProcessing";
import { calculateRelevance } from "./executors";
import { HISTORY_WINDOW } from "./client";

// ---------------------------------------------------------------------------
// Entity Context
// ---------------------------------------------------------------------------

interface ContextSnapshot {
  entities: Array<Record<string, unknown>>;
  relationships: Array<{ f: string; t: string; tp: string }>;
}

/** Compact entity representation — drops null fields to save tokens. */
function compactEntity(e: Entity): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    id: e.id,
    k: e.kind,
    s_id: (e as { schema_id?: string }).schema_id || `system/${e.kind.toLowerCase()}`,
    t: e.title,
    s: e.status,
  };
  if (e.parent_id) obj.p_id = e.parent_id;
  if (e.deadline) obj.dl = e.deadline;
  if (e.start_time) obj.st = e.start_time;
  if (e.canonical_tags?.length) obj.tags = e.canonical_tags;
  const certainty = e.scheduling_certainty || (e.metadata?.scheduling_certainty as string | undefined);
  if (certainty) obj.cert = certainty;

  const subtasks = e.subtasks || (e.metadata?.subtasks as typeof e.subtasks | undefined);
  if (Array.isArray(subtasks) && subtasks.length > 0) {
    obj.subtasks = subtasks.map(s => ({
      id: s.id,
      t: s.title,
      c: Boolean(s.completed),
    }));
  }
  return obj;
}

/**
 * Select the most contextually relevant entities for the current turn.
 *
 * Strategy:
 * 1. Date-window filter (±7 days around now)
 * 2. Keyword-relevance ranking against the user message (top 10)
 * 3. Deduplicate and merge both sets
 */
export function buildEntityContext(
  entities: Entity[],
  relationships: Relationship[],
  userMessage: string,
): ContextSnapshot {
  const now = Date.now();
  const DAY = 86_400_000;
  const windowStart = now - 7 * DAY;
  const windowEnd = now + 7 * DAY;

  // Exclude hidden and deleted entities
  const visible = entities.filter(e => !e.metadata?.hidden && !e.metadata?.deleted);

  // 1) Date-window entities
  const inWindow = visible.filter(e => {
    const dates = [e.created_at, e.updated_at, e.deadline, e.start_time, e.end_time].filter(Boolean);
    return dates.some(d => {
      const ts = new Date(d!).getTime();
      return ts >= windowStart && ts <= windowEnd;
    });
  });

  // 2) Keyword-relevant entities (top 10)
  const relevant = [...visible]
    .map(e => ({ entity: e, score: calculateRelevance(e, userMessage) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(x => x.entity);

  // Merge & dedupe
  const contextMap = new Map<string, Entity>();
  for (const e of inWindow) contextMap.set(e.id, e);
  for (const e of relevant) contextMap.set(e.id, e);

  // Include 1-hop connected entities for selected items (up to 15 max)
  let hopCount = 0;
  for (const r of relationships) {
    if (hopCount >= 15) break;
    if (contextMap.has(r.from) && !contextMap.has(r.to)) {
      const target = visible.find(e => e.id === r.to);
      if (target) {
        contextMap.set(target.id, target);
        hopCount++;
      }
    } else if (contextMap.has(r.to) && !contextMap.has(r.from)) {
      const source = visible.find(e => e.id === r.from);
      if (source) {
        contextMap.set(source.id, source);
        hopCount++;
      }
    }
  }

  const selected = Array.from(contextMap.values());
  const filteredRels = relationships.filter(
    r => contextMap.has(r.from) && contextMap.has(r.to),
  );

  return {
    entities: selected.map(compactEntity),
    relationships: filteredRels.map(r => ({ f: r.from, t: r.to, tp: r.type })),
  };
}

// ---------------------------------------------------------------------------
// Food Context
// ---------------------------------------------------------------------------

export interface FoodContextData {
  summary: string;
  recentMeals: string;
}

/** Aggregate food logs from the last 30 days into a compact context string. */
export function buildFoodContext(): FoodContextData {
  const { foodLogs } = useStore.getState();
  const now = Date.now();
  const DAY = 86_400_000;

  const recent = foodLogs.filter(
    l => (now - new Date(l.timestamp).getTime()) / DAY <= 30,
  );

  if (recent.length === 0) {
    return { summary: '', recentMeals: '' };
  }

  // Vendor frequency
  const vendorCounts = new Map<string, number>();
  const topFoods = new Map<string, number>();
  let totalSpent = 0;

  for (const log of recent) {
    if (log.vendor) vendorCounts.set(log.vendor, (vendorCounts.get(log.vendor) || 0) + 1);
    if (log.food_name) topFoods.set(log.food_name, (topFoods.get(log.food_name) || 0) + 1);
    if (log.cost) totalSpent += log.cost;
  }

  const topVendors = [...vendorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([v, c]) => `${v}(${c})`)
    .join(', ');

  const topItems = [...topFoods.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([f, c]) => `${f}(${c})`)
    .join(', ');

  const summary = [
    `Food(30d): ${recent.length} logs`,
    totalSpent > 0 ? `₹${totalSpent} spent` : null,
    topVendors ? `Top: ${topVendors}` : null,
    topItems ? `Fav: ${topItems}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  // Last 3 meals for immediate context
  const recentMeals = recent
    .slice(-3)
    .map(l => `${l.food_name}(${l.source || '?'})`)
    .join(', ');

  return { summary, recentMeals };
}

// ---------------------------------------------------------------------------
// Time Context
// ---------------------------------------------------------------------------

export function buildTimeContext(timezone: string): { timeString: string; timeOfDay: string; isoDate: string } {
  const now = new Date();
  const timeString = now.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });

  const hour = parseInt(
    now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }),
  );

  let timeOfDay: string;
  if (hour >= 5 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  else timeOfDay = 'night';

  const isoDate = now.toISOString();
  return { timeString, timeOfDay, isoDate };
}

// ---------------------------------------------------------------------------
// Conversation History  (sliding window + rolling summary)
// ---------------------------------------------------------------------------

/**
 * Sliding-window history builder with rolling summarization.
 *
 * When the conversation exceeds HISTORY_WINDOW messages, older messages
 * are compressed into a one-paragraph summary that's prepended to the
 * context. This preserves long-term memory without exploding token usage.
 */
export function buildHistory(
  messages: Message[],
  conversationSummary: string | null,
  attachmentDataUrl?: string | null,
): Content[] {
  const contents: Content[] = [];

  // Rejected/uncertain turns remain visible in the transcript as a record,
  // but must not be replayed as conversation context on a later request.
  // In particular, a provider may already have seen an uncertain turn, so
  // silently resending it could duplicate work or charges.
  const contextMessages = messages.filter(msg => {
    if (msg.role === 'user' && msg.turn_metadata?.managed_failure) return false;
    if (
      msg.role === 'assistant' &&
      msg.status === 'failed' &&
      msg.turn_metadata?.response_source === 'unavailable' &&
      !msg.text.trim()
    ) return false;
    return true;
  });

  // Prepend rolling summary if available
  if (conversationSummary) {
    contents.push({
      role: 'user',
      parts: [{ text: `[Previous conversation context]: ${conversationSummary}` }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Understood, I have the context from our earlier conversation.' }],
    });
  }

  // Sliding window of recent messages
  const messageWindow = contextMessages.slice(-HISTORY_WINDOW);

  for (const msg of messageWindow) {
    if (msg.role === 'user') {
      const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
        { text: msg.text },
      ];

      // Attach image on the last user message if provided
      if (msg === messageWindow[messageWindow.length - 1] && attachmentDataUrl) {
        try {
          parts.push({
            inlineData: {
              data: stripBase64Prefix(attachmentDataUrl),
              mimeType: getMimeType(attachmentDataUrl),
            },
          });
        } catch {
          // Skip malformed attachment silently
        }
      }

      contents.push({ role: 'user', parts });
    } else if (msg.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: msg.text }] });
    }
  }

  return contents;
}

/**
 * Summarize older conversation messages into a compact paragraph.
 *
 * Called locally (no LLM) — extracts key entities and topics mentioned
 * to create a lightweight rolling memory.
 */
export function summarizeOlderMessages(messages: Message[]): string | null {
  const contextMessages = messages.filter(msg => {
    if (msg.role === 'user' && msg.turn_metadata?.managed_failure) return false;
    if (
      msg.role === 'assistant' &&
      msg.status === 'failed' &&
      msg.turn_metadata?.response_source === 'unavailable' &&
      !msg.text.trim()
    ) return false;
    return true;
  });
  if (contextMessages.length <= HISTORY_WINDOW) return null;

  const older = contextMessages.slice(0, -HISTORY_WINDOW);

  // Extract key themes from older messages
  const topics = new Set<string>();
  const entityMentions = new Set<string>();

  for (const msg of older) {
    const text = msg.text.toLowerCase();

    // Extract quoted entity names and capitalized phrases
    const quoted = msg.text.match(/"([^"]+)"/g);
    if (quoted) quoted.forEach(q => entityMentions.add(q.replace(/"/g, '')));

    // Extract action verbs and topics
    if (text.includes('create') || text.includes('created')) topics.add('created entities');
    if (text.includes('task')) topics.add('tasks');
    if (text.includes('goal')) topics.add('goals');
    if (text.includes('schedule') || text.includes('event')) topics.add('scheduling');
    if (text.includes('food') || text.includes('ate') || text.includes('meal')) topics.add('food tracking');
    if (text.includes('habit')) topics.add('habits');
    if (text.includes('project')) topics.add('projects');
    if (text.includes('deadline') || text.includes('due')) topics.add('deadlines');
    if (text.includes('progress') || text.includes('update')) topics.add('progress updates');
  }

  if (topics.size === 0 && entityMentions.size === 0) return null;

  const parts: string[] = [];
  if (topics.size > 0) {
    parts.push(`Topics discussed: ${[...topics].join(', ')}`);
  }
  if (entityMentions.size > 0) {
    const mentions = [...entityMentions].slice(0, 8).join(', ');
    parts.push(`Entities mentioned: ${mentions}`);
  }
  parts.push(`(${older.length} earlier messages summarized)`);

  return parts.join('. ');
}

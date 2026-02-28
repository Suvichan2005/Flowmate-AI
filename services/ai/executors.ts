/**
 * AI Tool Executors
 *
 * Pure functions that execute Gemini function-call tool requests
 * against the local Zustand store / entity snapshot.
 */

import { Entity, EntityKind, EntityStatus } from "../../types";
import { useStore } from "../../store";

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
// read_calendar
// ---------------------------------------------------------------------------

export function executeReadCalendar(args: any, allEntities: Entity[]): any[] {
  const start = new Date(args.start_date);
  const end = new Date(args.end_date);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [{ error: "Invalid dates" }];

  return allEntities
    .filter(e => {
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
    }));
}

// ---------------------------------------------------------------------------
// search_entities
// ---------------------------------------------------------------------------

export function executeSearchEntities(args: any, allEntities: Entity[]): any[] {
  const query = (args.query || '').toLowerCase();
  const tags = (args.tags || []) as string[];
  const kind = args.kind ? args.kind.toUpperCase() : null;
  const status = args.status ? args.status.toUpperCase() : null;
  const limit = args.limit || 15;

  let results = allEntities.filter(e => {
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
  }));
}

// ---------------------------------------------------------------------------
// lookup_food_history
// ---------------------------------------------------------------------------

export function executeLookupFoodHistory(args: any): any[] {
  const { foodLogs } = useStore.getState();
  const days = args.days || 30;
  const source = args.source?.toLowerCase();
  const vendor = args.vendor?.toLowerCase();
  const limit = args.limit || 20;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const results = foodLogs.filter((l: any) => {
    if (new Date(l.timestamp) < cutoff) return false;
    if (source && l.source?.toLowerCase() !== source) return false;
    if (vendor && !l.vendor?.toLowerCase().includes(vendor)) return false;
    return true;
  });

  return results
    .slice(-limit)
    .reverse()
    .map((l: any) => ({
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

export function executeGetProductivityStats(args: any, allEntities: Entity[]): any {
  const startDate = args.start_date
    ? new Date(args.start_date)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = args.end_date ? new Date(args.end_date) : new Date();
  endDate.setHours(23, 59, 59, 999);

  let productiveMinutes = 0;
  let totalMinutes = 0;

  for (const e of allEntities) {
    if (!e.metadata?.activity_log) continue;
    for (const log of e.metadata.activity_log as any[]) {
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

export function executeLookupGoals(args: any, allEntities: Entity[]): any[] {
  const status = args.status?.toUpperCase() || 'ACTIVE';
  const includeSubtasks = args.include_subtasks || false;
  const limit = args.limit || 10;

  let goals = allEntities.filter(e => e.kind === EntityKind.GOAL);
  if (status !== 'ALL') goals = goals.filter(e => e.status === status);

  return goals.slice(0, limit).map(g => {
    const result: any = {
      id: g.id,
      title: g.title,
      status: g.status,
      progress: g.metadata?.progress || 0,
    };
    if (includeSubtasks && g.metadata?.subtasks) {
      result.subtasks = (g.metadata.subtasks as any[]).map((s: any) => ({
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

export function executeLookupHabits(args: any, allEntities: Entity[]): any[] {
  const includeStreaks = args.include_streaks !== false;
  const limit = args.limit || 10;

  const habits = allEntities.filter(e => e.kind === EntityKind.HABIT).slice(0, limit);

  return habits.map(h => {
    const result: any = {
      id: h.id,
      title: h.title,
      status: h.status,
    };
    if (includeStreaks) {
      result.streak = h.metadata?.streak_current || 0;
      result.last_done = h.metadata?.last_completed_at;
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Dispatch Map
// ---------------------------------------------------------------------------

/**
 * Routes a function call from the model to the correct executor.
 * Returns the tool response payload.
 */
export function dispatchToolCall(
  call: { name: string; args: any },
  entities: Entity[]
): { name: string; response: any } {
  switch (call.name) {
    case 'read_calendar':
      return { name: call.name, response: { result: executeReadCalendar(call.args, entities) } };
    case 'search_entities':
      return { name: call.name, response: { result: executeSearchEntities(call.args, entities) } };
    case 'lookup_food_history':
      return { name: call.name, response: { result: executeLookupFoodHistory(call.args) } };
    case 'get_productivity_stats':
      return { name: call.name, response: { result: executeGetProductivityStats(call.args, entities) } };
    case 'lookup_goals':
      return { name: call.name, response: { result: executeLookupGoals(call.args, entities) } };
    case 'lookup_habits':
      return { name: call.name, response: { result: executeLookupHabits(call.args, entities) } };
    default:
      return { name: call.name, response: { error: "Unknown tool or action handled separately." } };
  }
}

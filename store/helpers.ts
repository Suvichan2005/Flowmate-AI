// Store Helpers — Pure utility functions for operation normalization and entity resolution

import {
    Entity,
    EntityKind,
    Relationship,
    RelationshipType,
    ToonOperationType,
    RecurrenceType,
    ChatSession,
} from '../types';
import type { Entity as KernelEntity } from '../services/kernel';

// --- Payload Normalization ---

/**
 * Normalize LLM-generated payloads to canonical field names.
 * Handles short aliases (k→kind), common typos (name→title),
 * date aliases (due_date→deadline), and kind validation.
 */
export const normalizePayload = (type: ToonOperationType, payload: Record<string, unknown> | null | undefined): Record<string, any> => {
    if (!payload) return {};
    const p: Record<string, any> = { ...payload };

    // Short field aliases (token optimization)
    if (p.k && !p.kind) p.kind = p.k;
    if (p.t && !p.title) p.title = p.t;
    if (p.d && !p.description) p.description = p.d;
    if (p.p && !p.parent && !p.parent_id) p.parent = p.p;
    if (p.s && !p.status) p.status = p.s;
    if (p.m && !p.metadata) p.metadata = p.m;
    if (p.dur && !p.duration_minutes) p.duration_minutes = p.dur;
    if (p.start && !p.start_time) p.start_time = p.start;
    if (p.end && !p.end_time) p.end_time = p.end;
    if (p.due && !p.deadline) p.deadline = p.due;
    if (p.rec && !p.recurrence) p.recurrence = p.rec;
    if (p.repeat && !p.recurrence) p.recurrence = p.repeat;
    if (p.freq && !p.recurrence) p.recurrence = p.freq;
    if (typeof p.recurrence === 'string') {
        const upperRec = p.recurrence.toUpperCase();
        if (['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(upperRec)) {
            p.recurrence = upperRec;
        }
    }

    // Common field aliases (LLM hallucination fixes)
    if (p.name && !p.title) p.title = p.name;
    if (p.desc && !p.description) p.description = p.desc;
    if (p.details && !p.description) p.description = p.details;
    if (p.notes && !p.description) p.description = p.notes;

    // Date and time aliases (handles varied LLM output formats)
    if (p.startTime && !p.start_time) p.start_time = p.startTime;
    if (p.endTime && !p.end_time) p.end_time = p.endTime;
    if (p.start_date && !p.start_time) p.start_time = p.start_date;
    if (p.end_date && !p.end_time) p.end_time = p.end_date;
    if (p.due_date && !p.deadline) p.deadline = p.due_date;
    if (p.target_date && !p.deadline) p.deadline = p.target_date;
    if (p.date && !p.start_time) p.start_time = p.date;
    if (p.start && !p.start_time) p.start_time = p.start;

    // ISO timestamp normalization with IST (+05:30) guarantee
    if (p.start_time && typeof p.start_time === 'string') {
        if (!p.start_time.includes('T')) {
            p.start_time = `${p.start_time}T00:00:00+05:30`;
        } else if (!p.start_time.includes('+') && !p.start_time.endsWith('Z')) {
            p.start_time = `${p.start_time}+05:30`;
        }
    }
    if (p.end_time && typeof p.end_time === 'string') {
        if (!p.end_time.includes('T')) {
            p.end_time = `${p.end_time}T23:59:59+05:30`;
        } else if (!p.end_time.includes('+') && !p.end_time.endsWith('Z')) {
            p.end_time = `${p.end_time}+05:30`;
        }
    }

    // Calculate end_time from start_time + duration_minutes if missing
    if (p.start_time && typeof p.start_time === 'string' && typeof p.duration_minutes === 'number' && p.duration_minutes > 0 && !p.end_time) {
        const startMs = new Date(p.start_time).getTime();
        if (!isNaN(startMs)) {
            const offsetMatch = p.start_time.match(/([+-]\d{2}:\d{2})$/);
            const offset = offsetMatch ? offsetMatch[1] : (p.start_time.endsWith('Z') ? 'Z' : '+05:30');
            if (offset === 'Z') {
                p.end_time = new Date(startMs + p.duration_minutes * 60000).toISOString();
            } else {
                const match = offset.match(/([+-])(\d{2}):(\d{2})/);
                const sign = match && match[1] === '+' ? 1 : -1;
                const hours = match ? parseInt(match[2], 10) : 5;
                const mins = match ? parseInt(match[3], 10) : 30;
                const totalOffsetMs = sign * (hours * 60 + mins) * 60000;
                const targetMs = startMs + p.duration_minutes * 60000;
                const localDate = new Date(targetMs + totalOffsetMs);
                const y = localDate.getUTCFullYear();
                const mo = String(localDate.getUTCMonth() + 1).padStart(2, '0');
                const d = String(localDate.getUTCDate()).padStart(2, '0');
                const hh = String(localDate.getUTCHours()).padStart(2, '0');
                const mm = String(localDate.getUTCMinutes()).padStart(2, '0');
                const ss = String(localDate.getUTCSeconds()).padStart(2, '0');
                p.end_time = `${y}-${mo}-${d}T${hh}:${mm}:${ss}${offset}`;
            }
        }
    }

    // Tags normalization
    if (Array.isArray(p.tags) && !p.canonical_tags) {
        p.canonical_tags = p.tags;
    } else if (Array.isArray(p.canonical_tags) && !p.tags) {
        p.tags = p.canonical_tags;
    }

    // Context field normalization into tags
    if (typeof p.context === 'string' && p.context.trim()) {
        const ctx = p.context.trim();
        const currentTags: string[] = Array.isArray(p.tags) ? [...p.tags] : [];
        if (!currentTags.includes(ctx)) {
            currentTags.push(ctx);
        }
        p.tags = currentTags;
        p.canonical_tags = currentTags;
    }

    // Productivity classification normalization
    if (p.metadata && typeof p.metadata === 'object' && p.metadata.productivity && !p.productivity) {
        p.productivity = p.metadata.productivity;
    }
    if (p.productivity) {
        const prodUpper = String(p.productivity).toUpperCase();
        p.productivity = prodUpper;
        if (!p.metadata || typeof p.metadata !== 'object') {
            p.metadata = { productivity: prodUpper };
        } else {
            p.metadata = { ...p.metadata, productivity: prodUpper };
        }
    }

    // log_activity specific
    if (type === 'log_activity') {
        if (p.end && !p.end_time) p.end_time = p.end;
        if (p.duration && !p.duration_minutes) p.duration_minutes = p.duration;
    }

    // Relationship aliases
    if (type === 'link_entities' || type === 'unlink_entities') {
        if (!p.from && p.source) p.from = p.source;
        if (!p.from && p.source_id) p.from = p.source_id;
        if (!p.from && p.from_entity_id) p.from = p.from_entity_id;
        if (!p.from && p.origin) p.from = p.origin;

        if (!p.to && p.target) p.to = p.target;
        if (!p.to && p.target_id) p.to = p.target_id;
        if (!p.to && p.to_entity_id) p.to = p.to_entity_id;
        if (!p.to && p.destination) p.to = p.destination;

        if (!p.type && p.relationship) p.type = p.relationship;
        if (!p.type && p.rel) p.type = p.rel;
        if (!p.type) p.type = RelationshipType.DEPENDS_ON;
    }

    // Kind validation/normalization
    if (p.kind) {
        const k = p.kind.toUpperCase();

        const shortKindMap: Record<string, EntityKind> = {
            'CTX': EntityKind.CONTEXT,
            'GOL': EntityKind.GOAL,
            'PRJ': EntityKind.PROJECT,
            'TSK': EntityKind.TASK,
            'EVT': EntityKind.EVENT,
            'HAB': EntityKind.HABIT,
            'NOT': EntityKind.NOTE,
            'PER': EntityKind.PERSON,
            'MEETING': EntityKind.EVENT,
            'REMINDER': EntityKind.TASK,
            'SUBTASK': EntityKind.TASK,
            'IDEA': EntityKind.NOTE,
            'AREA': EntityKind.CONTEXT,
            'DOMAIN': EntityKind.CONTEXT,
            'SPACE': EntityKind.CONTEXT,
        };

        if (Object.values(EntityKind).includes(k as EntityKind)) {
            p.kind = k;
        } else if (shortKindMap[k]) {
            p.kind = shortKindMap[k];
        } else {
            p.kind = EntityKind.TASK;
        }
    }

    return p;
};

// --- Short Operation Type Expansion ---

const SHORT_OP_MAP: Record<string, ToonOperationType> = {
    'c': 'create_entity',
    'u': 'update_entity',
    'd': 'delete_entity',
    'l': 'link_entities',
    's': 'add_subtask',
    'f': 'log_food',
    'log': 'log_to_entity',
    'arc': 'archive_entity',
};

export const expandOperationType = (shortType: string): ToonOperationType => {
    return (SHORT_OP_MAP[shortType] || shortType) as ToonOperationType;
};

// --- Recurrence Calculation ---

export const calculateNextDate = (currentDate: string, recurrence: RecurrenceType): string | null => {
    if (!currentDate || !recurrence) return null;
    const date = new Date(currentDate);

    switch (recurrence) {
        case 'DAILY': date.setDate(date.getDate() + 1); break;
        case 'WEEKLY': date.setDate(date.getDate() + 7); break;
        case 'MONTHLY': date.setMonth(date.getMonth() + 1); break;
        case 'YEARLY': date.setFullYear(date.getFullYear() + 1); break;
        default: return null;
    }
    return date.toISOString();
};

// --- Entity ID Resolution ---

/**
 * Three-pass entity resolution:
 * 1. Direct UUID match
 * 2. Case-insensitive title match (reverse scan for most-recent)
 * 3. Prefix match for truncated UUIDs from LLM
 */
export const resolveEntityId = (identifier: string, entities: ReadonlyArray<Readonly<Entity>> | Entity[]): string | null => {
    if (!identifier) return null;

    const byId = entities.find(e => e.id === identifier);
    if (byId) return byId.id;

    for (let i = entities.length - 1; i >= 0; i--) {
        if (entities[i].title.toLowerCase() === identifier.toLowerCase()) {
            return entities[i].id;
        }
    }

    if (identifier.length > 20) {
        const byPrefix = entities.find(e => e.id.startsWith(identifier));
        if (byPrefix) return byPrefix.id;
    }

    return null;
};

export interface HistorySnapshot {
    entities: Entity[];
    relationships: Relationship[];
    timestamp: number;
    kernelEntities?: Record<string, KernelEntity>;
}

// --- Active Entity Selectors (Exclude Soft-Deleted Tombstones) ---

/**
 * Returns true if an entity is active and not soft-deleted.
 */
export const isEntityActive = (entity: Readonly<Entity> | Entity | undefined | null): boolean => {
    if (!entity) return false;
    if (entity.metadata?.deleted) return false;
    const record = entity as Record<string, unknown>;
    return !record.deleted;
};

/**
 * Filters an array of entities to exclude soft-deleted tombstones.
 */
export const getActiveEntities = (entities: ReadonlyArray<Readonly<Entity>> | Entity[] | undefined | null): Entity[] => {
    if (!Array.isArray(entities)) return [];
    return entities.filter(isEntityActive) as Entity[];
};

// --- Active ChatSession Selectors (Exclude Soft-Deleted Tombstones) ---

/**
 * Returns true if a chat session is active and not soft-deleted.
 */
export const isChatSessionActive = (session: ChatSession | undefined | null): boolean => {
    return !!session && !session.deleted;
};

/**
 * Filters an array of chat sessions to exclude soft-deleted tombstones.
 */
export const getActiveChatSessions = (sessions: ChatSession[] | undefined | null): ChatSession[] => {
    if (!Array.isArray(sessions)) return [];
    return sessions.filter(isChatSessionActive);
};


// Store Helpers — Pure utility functions for operation normalization and entity resolution

import {
    Entity,
    EntityKind,
    RelationshipType,
    ToonOperationType,
    RecurrenceType,
} from '../types';

// --- Payload Normalization ---

/**
 * Normalize LLM-generated payloads to canonical field names.
 * Handles short aliases (k→kind), common typos (name→title),
 * date aliases (due_date→deadline), and kind validation.
 */
export const normalizePayload = (type: ToonOperationType, payload: any): any => {
    if (!payload) return {};
    const p = { ...payload };

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

    // Common field aliases (LLM hallucination fixes)
    if (p.name && !p.title) p.title = p.name;
    if (p.desc && !p.description) p.description = p.desc;
    if (p.details && !p.description) p.description = p.details;
    if (p.notes && !p.description) p.description = p.notes;

    // Date aliases
    if (p.due_date && !p.deadline) p.deadline = p.due_date;
    if (p.target_date && !p.deadline) p.deadline = p.target_date;
    if (p.date && !p.start_time) p.start_time = p.date;
    if (p.start && !p.start_time) p.start_time = p.start;

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
export const resolveEntityId = (identifier: string, entities: Entity[]): string | null => {
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

// --- History Snapshot ---

export interface HistorySnapshot {
    entities: Entity[];
    relationships: Relationship[];
    timestamp: number;
}

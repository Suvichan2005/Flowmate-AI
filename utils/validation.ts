/**
 * Data Validation Utilities
 * 
 * Provides schema validation for Flowmate data structures.
 * Prevents corrupted data from crashing the application.
 */

import { Entity, Relationship, EntityKind, EntityStatus, RelationshipType, ToonOperation, ToonOperationType } from '../types';

// --- Entity Validation ---

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    sanitized?: any;
}

/**
 * Validates and sanitizes a single entity
 */
export const validateEntity = (entity: any): ValidationResult => {
    const errors: string[] = [];

    if (!entity || typeof entity !== 'object') {
        return { valid: false, errors: ['Entity must be an object'] };
    }

    // Required fields
    if (!entity.id || typeof entity.id !== 'string') {
        errors.push('Entity missing valid id');
    }
    if (!entity.title || typeof entity.title !== 'string') {
        errors.push('Entity missing valid title');
    }
    if (!entity.kind || !Object.values(EntityKind).includes(entity.kind)) {
        errors.push(`Entity has invalid kind: ${entity.kind}`);
    }

    // Sanitize the entity with defaults for missing optional fields
    const sanitized: Entity = {
        id: entity.id || '',
        kind: Object.values(EntityKind).includes(entity.kind) ? entity.kind : EntityKind.NOTE,
        title: entity.title || 'Untitled',
        description: typeof entity.description === 'string' ? entity.description : null,
        status: Object.values(EntityStatus).includes(entity.status) ? entity.status : EntityStatus.ACTIVE,
        priority: typeof entity.priority === 'number' ? entity.priority : 1,
        start_time: typeof entity.start_time === 'string' ? entity.start_time : null,
        end_time: typeof entity.end_time === 'string' ? entity.end_time : null,
        deadline: typeof entity.deadline === 'string' ? entity.deadline : null,
        duration_minutes: typeof entity.duration_minutes === 'number' ? entity.duration_minutes : null,
        recurrence: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', null].includes(entity.recurrence) ? entity.recurrence : null,
        metadata: typeof entity.metadata === 'object' && entity.metadata !== null ? entity.metadata : {},
        created_at: typeof entity.created_at === 'string' ? entity.created_at : new Date().toISOString(),
        updated_at: typeof entity.updated_at === 'string' ? entity.updated_at : new Date().toISOString(),
        canonical_tags: Array.isArray(entity.canonical_tags) ? entity.canonical_tags.filter((t: any) => typeof t === 'string') : [],
        parent_id: typeof entity.parent_id === 'string' ? entity.parent_id : null
    };

    return {
        valid: errors.length === 0,
        errors,
        sanitized
    };
};

/**
 * Validates and sanitizes a relationship
 */
export const validateRelationship = (rel: any): ValidationResult => {
    const errors: string[] = [];

    if (!rel || typeof rel !== 'object') {
        return { valid: false, errors: ['Relationship must be an object'] };
    }

    if (!rel.id || typeof rel.id !== 'string') {
        errors.push('Relationship missing valid id');
    }
    if (!rel.from || typeof rel.from !== 'string') {
        errors.push('Relationship missing valid from');
    }
    if (!rel.to || typeof rel.to !== 'string') {
        errors.push('Relationship missing valid to');
    }
    if (!rel.type || !Object.values(RelationshipType).includes(rel.type)) {
        errors.push(`Relationship has invalid type: ${rel.type}`);
    }

    const sanitized: Relationship = {
        id: rel.id || '',
        from: rel.from || '',
        to: rel.to || '',
        type: Object.values(RelationshipType).includes(rel.type) ? rel.type : RelationshipType.RELATED_TO,
        meta: typeof rel.meta === 'object' && rel.meta !== null ? rel.meta : {},
        created_at: typeof rel.created_at === 'string' ? rel.created_at : new Date().toISOString()
    };

    return {
        valid: errors.length === 0,
        errors,
        sanitized
    };
};

/**
 * Validates an entire persisted state and returns sanitized data
 */
export const validatePersistedState = (state: any): {
    valid: boolean;
    errors: string[];
    sanitizedEntities: Entity[];
    sanitizedRelationships: Relationship[];
    droppedEntities: number;
    droppedRelationships: number;
} => {
    const errors: string[] = [];
    const sanitizedEntities: Entity[] = [];
    const sanitizedRelationships: Relationship[] = [];
    let droppedEntities = 0;
    let droppedRelationships = 0;

    // Validate entities
    const rawEntities = Array.isArray(state?.entities) ? state.entities : [];
    for (const entity of rawEntities) {
        const result = validateEntity(entity);
        if (result.sanitized && result.sanitized.id) {
            sanitizedEntities.push(result.sanitized);
            if (!result.valid) {
                console.warn('[Validation] Entity sanitized with warnings:', result.errors, entity);
            }
        } else {
            droppedEntities++;
            errors.push(`Dropped invalid entity: ${JSON.stringify(entity).slice(0, 100)}`);
        }
    }

    // Collect valid entity IDs for relationship validation
    const validEntityIds = new Set(sanitizedEntities.map(e => e.id));

    // Validate relationships
    const rawRelationships = Array.isArray(state?.relationships) ? state.relationships : [];
    for (const rel of rawRelationships) {
        const result = validateRelationship(rel);
        if (result.sanitized && result.sanitized.id) {
            // Also check that both endpoints exist
            if (validEntityIds.has(result.sanitized.from) && validEntityIds.has(result.sanitized.to)) {
                sanitizedRelationships.push(result.sanitized);
            } else {
                droppedRelationships++;
                // Silently drop orphaned relationships (common after entity deletion)
            }
        } else {
            droppedRelationships++;
            errors.push(`Dropped invalid relationship: ${JSON.stringify(rel).slice(0, 100)}`);
        }
    }

    const valid = droppedEntities === 0 && errors.length === 0;

    if (!valid) {
        console.warn('[Validation] State validation completed with issues:', {
            droppedEntities,
            droppedRelationships,
            errorCount: errors.length
        });
    }

    return {
        valid,
        errors,
        sanitizedEntities,
        sanitizedRelationships,
        droppedEntities,
        droppedRelationships
    };
};

// --- Operation Validation ---

const VALID_OPERATION_TYPES: ToonOperationType[] = [
    'create_entity',
    'update_entity',
    'delete_entity',
    'link_entities',
    'unlink_entities',
    'set_goal_progress',
    'log_activity',
    'schedule_event',
    'tag_update',
    'add_subtask',
    'toggle_subtask',
    'delete_subtask',
    'log_to_entity',
    'archive_entity',
    'log_food'
];

// Short operation type aliases
const SHORT_OP_TYPES = ['c', 'u', 'd', 'l', 's', 'f', 'log', 'arc'];

/**
 * Validates a single ToonOperation from AI
 */
export const validateOperation = (op: any): ValidationResult => {
    const errors: string[] = [];

    if (!op || typeof op !== 'object') {
        return { valid: false, errors: ['Operation must be an object'] };
    }

    // Check type
    const opType = op.type;
    if (!opType || typeof opType !== 'string') {
        return { valid: false, errors: ['Operation missing type'] };
    }

    const isValidType = VALID_OPERATION_TYPES.includes(opType as ToonOperationType) ||
        SHORT_OP_TYPES.includes(opType);
    if (!isValidType) {
        return { valid: false, errors: [`Invalid operation type: ${opType}`] };
    }

    // Check payload
    if (!op.payload || typeof op.payload !== 'object') {
        return { valid: false, errors: ['Operation missing payload object'] };
    }

    // Type-specific validation
    const payload = op.payload;

    switch (opType) {
        case 'create_entity':
        case 'c':
            if (!payload.title && !payload.t && !payload.name) {
                errors.push('create_entity requires a title');
            }
            break;

        case 'update_entity':
        case 'u':
            if (!payload.id && !payload.entity_id) {
                errors.push('update_entity requires an id');
            }
            break;

        case 'delete_entity':
        case 'd':
            if (!payload.id && !payload.entity_id) {
                errors.push('delete_entity requires an id');
            }
            break;

        case 'link_entities':
        case 'l':
            if (!payload.from && !payload.source && !payload.from_temp) {
                errors.push('link_entities requires a from/source');
            }
            if (!payload.to && !payload.target && !payload.to_temp) {
                errors.push('link_entities requires a to/target');
            }
            break;

        case 'add_subtask':
        case 's':
            if (!payload.entity_id && !payload.id) {
                errors.push('add_subtask requires an entity_id');
            }
            if (!payload.title && !payload.t && !payload.subtask?.title) {
                errors.push('add_subtask requires a subtask title');
            }
            break;

        case 'log_food':
        case 'f':
            if (!payload.food_name && !payload.title && !payload.t) {
                errors.push('log_food requires a food_name');
            }
            break;

        case 'log_to_entity':
        case 'log':
            if (!payload.entity_id && !payload.id && !payload.linked_entity_id) {
                errors.push('log_to_entity requires an entity_id');
            }
            break;
    }

    return {
        valid: errors.length === 0,
        errors,
        sanitized: op
    };
};

/**
 * Validates an array of operations and returns only valid ones
 */
export const validateOperations = (ops: any[]): {
    validOps: ToonOperation[];
    invalidOps: { op: any; errors: string[] }[];
} => {
    if (!Array.isArray(ops)) {
        return { validOps: [], invalidOps: [{ op: ops, errors: ['Operations must be an array'] }] };
    }

    const validOps: ToonOperation[] = [];
    const invalidOps: { op: any; errors: string[] }[] = [];

    for (const op of ops) {
        const result = validateOperation(op);
        if (result.valid) {
            validOps.push(op as ToonOperation);
        } else {
            invalidOps.push({ op, errors: result.errors });
            console.warn('[Validation] Invalid operation dropped:', result.errors, op);
        }
    }

    return { validOps, invalidOps };
};

/**
 * Sanitizes user input to prevent prompt injection
 */
export const sanitizeUserInput = (input: string): string => {
    if (typeof input !== 'string') return '';

    // Remove potential control characters
    let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Limit length to prevent token abuse
    const MAX_INPUT_LENGTH = 10000;
    if (sanitized.length > MAX_INPUT_LENGTH) {
        sanitized = sanitized.slice(0, MAX_INPUT_LENGTH);
    }

    return sanitized;
};

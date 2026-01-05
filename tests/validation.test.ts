import { describe, it, expect } from 'vitest';
import {
    validateEntity,
    validateRelationship,
    validatePersistedState,
    validateOperation,
    validateOperations,
    sanitizeUserInput,
} from '../utils/validation';
import { EntityKind, EntityStatus, RelationshipType } from '../types';

describe('validateEntity', () => {
    it('should validate a valid entity', () => {
        const validEntity = {
            id: 'test-id-123',
            kind: EntityKind.TASK,
            title: 'Test Task',
            description: 'A test task',
            status: EntityStatus.ACTIVE,
            priority: 2,
            start_time: null,
            end_time: null,
            deadline: null,
            duration_minutes: null,
            recurrence: null,
            metadata: {},
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            canonical_tags: [],
            parent_id: null,
        };

        const result = validateEntity(validEntity);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should reject entity with missing id', () => {
        const invalidEntity = {
            kind: EntityKind.TASK,
            title: 'Test Task',
        };

        const result = validateEntity(invalidEntity as any);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('id'))).toBe(true);
    });

    it('should reject entity with missing title', () => {
        const invalidEntity = {
            id: 'test-id',
            kind: EntityKind.TASK,
        };

        const result = validateEntity(invalidEntity as any);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('title'))).toBe(true);
    });

    it('should reject entity with invalid kind', () => {
        const invalidEntity = {
            id: 'test-id',
            kind: 'INVALID_KIND',
            title: 'Test Task',
        };

        const result = validateEntity(invalidEntity as any);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('kind'))).toBe(true);
    });

    it('should sanitize entity with defaults', () => {
        const partialEntity = {
            id: 'test-id',
            kind: EntityKind.TASK,
            title: 'Test Task',
        };

        const result = validateEntity(partialEntity as any);
        expect(result.sanitized).toBeDefined();
        expect(result.sanitized.status).toBe(EntityStatus.ACTIVE);
        expect(result.sanitized.priority).toBe(1);
        expect(result.sanitized.canonical_tags).toEqual([]);
    });
});

describe('validateRelationship', () => {
    it('should validate a valid relationship', () => {
        const validRelationship = {
            id: 'rel-123',
            from: 'entity-1',
            to: 'entity-2',
            type: RelationshipType.RELATED_TO,
        };

        const result = validateRelationship(validRelationship);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should reject relationship with missing from', () => {
        const invalidRelationship = {
            id: 'rel-123',
            to: 'entity-2',
            type: RelationshipType.RELATED_TO,
        };

        const result = validateRelationship(invalidRelationship as any);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('from'))).toBe(true);
    });

    it('should reject relationship with invalid type', () => {
        const invalidRelationship = {
            id: 'rel-123',
            from: 'entity-1',
            to: 'entity-2',
            type: 'INVALID_TYPE',
        };

        const result = validateRelationship(invalidRelationship as any);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('type'))).toBe(true);
    });
});

describe('validateOperation', () => {
    it('should validate a create_entity operation', () => {
        const op = {
            type: 'create_entity',
            payload: {
                title: 'New Task',
                kind: EntityKind.TASK,
            },
        };

        const result = validateOperation(op);
        expect(result.valid).toBe(true);
    });

    it('should validate a short-form operation type', () => {
        const op = {
            type: 'c',  // short for create_entity
            payload: {
                title: 'New Task',
            },
        };

        const result = validateOperation(op);
        expect(result.valid).toBe(true);
    });

    it('should reject create_entity without title', () => {
        const op = {
            type: 'create_entity',
            payload: {
                kind: EntityKind.TASK,
            },
        };

        const result = validateOperation(op);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('create_entity requires a title');
    });

    it('should reject update_entity without id', () => {
        const op = {
            type: 'update_entity',
            payload: {
                title: 'Updated Title',
            },
        };

        const result = validateOperation(op);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('update_entity requires an id');
    });

    it('should reject operation with invalid type', () => {
        const op = {
            type: 'invalid_operation',
            payload: {},
        };

        const result = validateOperation(op);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Invalid operation type'))).toBe(true);
    });

    it('should reject operation without payload', () => {
        const op = {
            type: 'create_entity',
        };

        const result = validateOperation(op as any);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Operation missing payload object');
    });
});

describe('validateOperations', () => {
    it('should filter out invalid operations', () => {
        const ops = [
            { type: 'create_entity', payload: { title: 'Valid Task' } },
            { type: 'create_entity', payload: {} }, // Invalid - no title
            { type: 'update_entity', payload: { id: 'task-1', title: 'Updated' } },
        ];

        const result = validateOperations(ops);
        expect(result.validOps).toHaveLength(2);
        expect(result.invalidOps).toHaveLength(1);
    });

    it('should return empty validOps for all invalid operations', () => {
        const ops = [
            { type: 'create_entity', payload: {} },
            { type: 'invalid', payload: {} },
        ];

        const result = validateOperations(ops);
        expect(result.validOps).toHaveLength(0);
        expect(result.invalidOps).toHaveLength(2);
    });
});

describe('validatePersistedState', () => {
    it('should handle valid state', () => {
        const state = {
            entities: [
                {
                    id: 'task-1',
                    kind: EntityKind.TASK,
                    title: 'Test Task',
                    status: EntityStatus.ACTIVE,
                    created_at: '2024-01-01T00:00:00Z',
                    updated_at: '2024-01-01T00:00:00Z',
                },
            ],
            relationships: [],
        };

        const result = validatePersistedState(state);
        expect(result.sanitizedEntities).toHaveLength(1);
        expect(result.droppedEntities).toBe(0);
    });

    it('should sanitize entities with invalid kind but keep them', () => {
        const state = {
            entities: [
                { id: 'task-1', kind: EntityKind.TASK, title: 'Valid Task' },
                { id: 'task-2', kind: 'INVALID_KIND', title: 'Invalid Kind' },
            ],
            relationships: [],
        };

        // Note: The validator sanitizes invalid kinds to NOTE, doesn't drop them
        const result = validatePersistedState(state);
        expect(result.sanitizedEntities).toHaveLength(2);
        expect(result.sanitizedEntities[1].kind).toBe(EntityKind.NOTE); // Sanitized to default
    });

    it('should handle null/undefined state', () => {
        const result = validatePersistedState(null);
        expect(result.sanitizedEntities).toEqual([]);
        expect(result.sanitizedRelationships).toEqual([]);
    });

    it('should drop relationships with missing endpoints', () => {
        const state = {
            entities: [
                { id: 'task-1', kind: EntityKind.TASK, title: 'Task 1' },
            ],
            relationships: [
                { id: 'rel-1', from: 'task-1', to: 'nonexistent', type: RelationshipType.RELATED_TO },
            ],
        };

        const result = validatePersistedState(state);
        expect(result.sanitizedRelationships).toHaveLength(0);
        expect(result.droppedRelationships).toBe(1);
    });
});

describe('sanitizeUserInput', () => {
    it('should truncate long strings', () => {
        const longString = 'A'.repeat(20000);
        const result = sanitizeUserInput(longString);
        expect(result.length).toBeLessThanOrEqual(10000);
    });

    it('should handle empty input', () => {
        expect(sanitizeUserInput('')).toBe('');
        expect(sanitizeUserInput(null as any)).toBe('');
        expect(sanitizeUserInput(undefined as any)).toBe('');
    });

    it('should remove control characters', () => {
        const result = sanitizeUserInput('Hello\x00World\x1F');
        expect(result).not.toContain('\x00');
        expect(result).not.toContain('\x1F');
        expect(result).toBe('HelloWorld');
    });
});

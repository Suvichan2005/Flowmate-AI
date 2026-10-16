/**
 * Flowmate Greenfield Domain Kernel — Schema Registry (Phase 0)
 * STRICT INVARIANT: ZERO `any`
 */

import { SchemaDefinition, AttributeDefinition } from './types';

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

export class SchemaRegistry {
  private schemas = new Map<string, SchemaDefinition>();

  register(schema: SchemaDefinition): void {
    const check = this.validateSchemaDefinition(schema);
    if (!check.valid) {
      throw new Error(`Invalid SchemaDefinition "${schema.id}": ${check.errors.join(', ')}`);
    }
    // Store deep clone to guarantee immutability
    this.schemas.set(schema.id, structuredClone(schema));
  }

  get(id: string): SchemaDefinition | undefined {
    const s = this.schemas.get(id);
    return s ? structuredClone(s) : undefined;
  }

  list(): SchemaDefinition[] {
    return Array.from(this.schemas.values()).map(s => structuredClone(s));
  }

  validateSchemaDefinition(schema: unknown): SchemaValidationResult {
    const errors: string[] = [];
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return { valid: false, errors: ['Schema must be a non-null object'] };
    }

    const s = schema as Record<string, unknown>;

    if (typeof s.id !== 'string' || !/^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(s.id)) {
      errors.push('Schema id must be in "namespace/name" format (lowercase alphanumeric, hyphens, underscores)');
    }
    if (typeof s.version !== 'number' || s.version < 1 || !Number.isInteger(s.version)) {
      errors.push('Schema version must be a positive integer >= 1');
    }
    if (typeof s.displayName !== 'string' || !s.displayName.trim()) {
      errors.push('Schema missing displayName');
    }
    if (typeof s.description !== 'string' || !s.description.trim()) {
      errors.push('Schema missing description');
    }
    if (!s.attributes || typeof s.attributes !== 'object' || Array.isArray(s.attributes)) {
      errors.push('Schema missing attributes dictionary');
      return { valid: false, errors };
    }

    const attrs = s.attributes as Record<string, unknown>;
    for (const [attrName, rawDef] of Object.entries(attrs)) {
      if (!rawDef || typeof rawDef !== 'object') {
        errors.push(`Attribute definition for "${attrName}" must be an object`);
        continue;
      }
      const def = rawDef as Partial<AttributeDefinition>;
      if (attrName !== def.name) {
        errors.push(`Attribute key "${attrName}" does not match definition name "${def.name}"`);
      }
      this.validateAttributeDefinition(def, errors);
    }

    return { valid: errors.length === 0, errors };
  }

  private validateAttributeDefinition(def: Partial<AttributeDefinition>, errors: string[]): void {
    const VALID_TYPES = new Set([
      'string',
      'number',
      'boolean',
      'datetime',
      'date',
      'duration_minutes',
      'enum',
      'entity_ref',
      'geopoint',
      'money',
      'quantity',
      'array',
      'object',
    ]);

    if (!def.name || typeof def.name !== 'string') {
      errors.push('Attribute definition missing name string');
    }
    if (!def.type || typeof def.type !== 'string' || !VALID_TYPES.has(def.type)) {
      errors.push(`Attribute "${def.name || 'unknown'}" has invalid type "${def.type}"`);
    }
    if (typeof def.label !== 'string' || !def.label.trim()) {
      errors.push(`Attribute "${def.name || 'unknown'}" missing label`);
    }
    if (typeof def.description !== 'string' || !def.description.trim()) {
      errors.push(`Attribute "${def.name || 'unknown'}" missing description`);
    }
    if (typeof def.required !== 'boolean') {
      errors.push(`Attribute "${def.name || 'unknown'}" required must be a boolean`);
    }

    if (def.type === 'enum') {
      if (!Array.isArray(def.enum_options) || def.enum_options.length === 0) {
        errors.push(`Enum attribute "${def.name}" must specify non-empty enum_options`);
      }
    }

    if (def.constraints?.pattern) {
      if (def.constraints.pattern.length > 100) {
        errors.push(`Pattern for "${def.name}" exceeds 100-character safety limit`);
      }
      try {
        new RegExp(def.constraints.pattern);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Pattern for "${def.name}" is invalid regex: ${msg}`);
      }
    }
  }
}

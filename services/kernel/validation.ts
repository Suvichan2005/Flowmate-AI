/**
 * Flowmate Greenfield Domain Kernel — Entity Validation Engine (Phase 0)
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - ZERO coercion
 * - ZERO prototype pollution
 * - Strict typed attribute validation
 * - Unknown attributes rejected
 */

import {
  Entity,
  SchemaDefinition,
  AttributeDefinition,
  AttributeValue,
  SourceType,
  TemporalValidity,
} from './types';

export interface EntityValidationResult {
  valid: boolean;
  errors: string[];
  sanitized?: Entity;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const VALID_SOURCES = new Set<SourceType>([
  'user',
  'agent',
  'external_integration',
  'device_sensor',
  'file_import',
]);

export function validateEntity(input: unknown, schema: SchemaDefinition): EntityValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['Entity must be a non-null object'] };
  }

  const raw = input as Record<string, unknown>;

  // 1. Recursive prototype pollution check
  if (detectPrototypePollution(raw)) {
    return { valid: false, errors: ['Entity contains forbidden prototype pollution keys: Prototype pollution attempt detected'] };
  }

  // 2. Identity validation
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    errors.push('Entity missing valid id (string)');
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    errors.push('Entity missing valid title (string)');
  }
  if (raw.schema_id !== schema.id) {
    errors.push(`Schema mismatch: entity has schema_id "${String(raw.schema_id)}", expected "${schema.id}"`);
  }

  // 3. Strict Provenance validation (ZERO COERCION: no Number(...) parsing)
  const rawProv = (raw.provenance || {}) as Record<string, unknown>;
  let confidence = 1.0;

  if (rawProv.confidence !== undefined) {
    if (typeof rawProv.confidence !== 'number' || isNaN(rawProv.confidence) || !isFinite(rawProv.confidence)) {
      errors.push('Provenance confidence must be a finite number');
    } else if (rawProv.confidence < 0 || rawProv.confidence > 1) {
      errors.push('Provenance confidence must be between 0.0 and 1.0');
    } else {
      confidence = rawProv.confidence;
    }
  }

  let sourceType: SourceType = 'user';
  if (rawProv.source_type !== undefined) {
    if (typeof rawProv.source_type === 'string' && VALID_SOURCES.has(rawProv.source_type as SourceType)) {
      sourceType = rawProv.source_type as SourceType;
    } else {
      errors.push(`Invalid provenance source_type: "${String(rawProv.source_type)}"`);
    }
  }

  const rawAttrs = (raw.attributes || {}) as Record<string, unknown>;
  const sanitizedAttrs: Record<string, AttributeValue> = {};

  // 4. Hardening: Unknown Attribute = Hard Validation Error
  for (const key of Object.keys(rawAttrs)) {
    if (!schema.attributes[key]) {
      errors.push(`Unknown attribute "${key}" is not declared in schema "${schema.id}"`);
    }
  }

  // 5. Validate declared attributes
  for (const [attrName, attrDef] of Object.entries(schema.attributes)) {
    const val = rawAttrs[attrName];

    if (val === undefined || val === null) {
      if (attrDef.required) {
        errors.push(`Missing required attribute: "${attrName}"`);
      }
      sanitizedAttrs[attrName] = (attrDef.default_value !== undefined
        ? structuredClone(attrDef.default_value)
        : null) as AttributeValue;
    } else {
      const typeError = validateTypedValue(val, attrDef);
      if (typeError) {
        errors.push(typeError);
      } else {
        sanitizedAttrs[attrName] = val as AttributeValue;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const now = new Date().toISOString();
  const rawLifecycle = (raw.lifecycle || {}) as Record<string, unknown>;

  const sanitized: Entity = {
    id: raw.id as string,
    schema_id: schema.id,
    version: typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version > 0
      ? raw.version
      : schema.version,
    title: (raw.title as string).trim(),
    attributes: sanitizedAttrs,
    lifecycle: {
      status: typeof rawLifecycle.status === 'string' ? rawLifecycle.status : 'active',
      created_at: typeof rawLifecycle.created_at === 'string' ? rawLifecycle.created_at : now,
      updated_at: now,
      deleted_at: typeof rawLifecycle.deleted_at === 'string' ? rawLifecycle.deleted_at : null,
    },
    provenance: {
      source_type: sourceType,
      source_id: typeof rawProv.source_id === 'string' ? rawProv.source_id : undefined,
      observed_at: typeof rawProv.observed_at === 'string' ? rawProv.observed_at : now,
      confidence,
      is_inferred: Boolean(rawProv.is_inferred),
      // Inferred proposals cannot self-authorize user_confirmed
      user_confirmed: rawProv.is_inferred ? false : Boolean(rawProv.user_confirmed),
    },
    validity: raw.validity ? sanitizeValidity(raw.validity) : undefined,
  };

  return { valid: true, errors: [], sanitized };
}

function sanitizeValidity(val: unknown): TemporalValidity | undefined {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return undefined;
  const v = val as Record<string, unknown>;
  return {
    valid_from: typeof v.valid_from === 'string' ? v.valid_from : undefined,
    valid_until: typeof v.valid_until === 'string' ? v.valid_until : undefined,
  };
}

function detectPrototypePollution(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;

  for (const forbidden of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, forbidden)) return true;
  }

  for (const key of Object.getOwnPropertyNames(obj)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === 'object' && val !== null) {
      if (detectPrototypePollution(val)) return true;
    }
  }
  return false;
}

function validateTypedValue(val: unknown, def: AttributeDefinition): string | null {
  switch (def.type) {
    case 'string':
      if (typeof val !== 'string') return `Attribute "${def.name}" must be a string`;
      if (def.constraints?.pattern && !new RegExp(def.constraints.pattern).test(val)) {
        return `Attribute "${def.name}" does not match required pattern ${def.constraints.pattern}`;
      }
      break;

    case 'number':
    case 'duration_minutes':
      if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
        return `Attribute "${def.name}" must be a finite number`;
      }
      if (def.type === 'duration_minutes' && val < 0) {
        return `Attribute "${def.name}" must be a non-negative duration`;
      }
      if (def.constraints?.min !== undefined && val < def.constraints.min) {
        return `Attribute "${def.name}" cannot be less than ${def.constraints.min}`;
      }
      if (def.constraints?.max !== undefined && val > def.constraints.max) {
        return `Attribute "${def.name}" cannot be greater than ${def.constraints.max}`;
      }
      break;

    case 'boolean':
      if (typeof val !== 'boolean') return `Attribute "${def.name}" must be a boolean`;
      break;

    case 'enum':
      if (typeof val !== 'string' || !def.enum_options?.includes(val)) {
        return `Attribute "${def.name}" must be one of: [${def.enum_options?.join(', ')}]`;
      }
      break;

    case 'datetime':
      // Strict ISO 8601 with timezone required
      if (
        typeof val !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(val) ||
        isNaN(Date.parse(val))
      ) {
        return `Attribute "${def.name}" must be a valid ISO 8601 datetime with explicit timezone`;
      }
      break;

    case 'date':
      if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        return `Attribute "${def.name}" must be a valid calendar date in YYYY-MM-DD format`;
      }
      const [y, m, d] = val.split('-').map(Number);
      const dateObj = new Date(Date.UTC(y, m - 1, d));
      if (
        dateObj.getUTCFullYear() !== y ||
        dateObj.getUTCMonth() + 1 !== m ||
        dateObj.getUTCDate() !== d
      ) {
        return `Attribute "${def.name}" contains an invalid calendar date (${val})`;
      }
      break;

    case 'entity_ref':
      if (!val || typeof val !== 'object' || Array.isArray(val)) {
        return `Attribute "${def.name}" must be an entity_ref object`;
      }
      const ref = val as Record<string, unknown>;
      if (!ref.entity_id || typeof ref.entity_id !== 'string') {
        return `Attribute "${def.name}" entity_ref missing valid entity_id`;
      }
      break;

    case 'geopoint':
      if (!val || typeof val !== 'object' || Array.isArray(val)) {
        return `Attribute "${def.name}" must be a GeoPoint object`;
      }
      const geo = val as Record<string, unknown>;
      if (typeof geo.lat !== 'number' || isNaN(geo.lat) || geo.lat < -90 || geo.lat > 90) {
        return `Attribute "${def.name}" GeoPoint latitude must be between -90 and 90`;
      }
      if (typeof geo.lng !== 'number' || isNaN(geo.lng) || geo.lng < -180 || geo.lng > 180) {
        return `Attribute "${def.name}" GeoPoint longitude must be between -180 and 180`;
      }
      break;

    case 'money':
      if (!val || typeof val !== 'object' || Array.isArray(val)) {
        return `Attribute "${def.name}" must be a Money object`;
      }
      const money = val as Record<string, unknown>;
      if (typeof money.amount !== 'number' || isNaN(money.amount) || !isFinite(money.amount)) {
        return `Attribute "${def.name}" Money amount must be a finite number`;
      }
      if (typeof money.currency !== 'string' || !/^[A-Z]{3}$/.test(money.currency)) {
        return `Attribute "${def.name}" Money currency must be a 3-letter uppercase ISO code`;
      }
      break;

    case 'quantity':
      if (!val || typeof val !== 'object' || Array.isArray(val)) {
        return `Attribute "${def.name}" must be a Quantity object`;
      }
      const qty = val as Record<string, unknown>;
      if (typeof qty.value !== 'number' || isNaN(qty.value) || !isFinite(qty.value)) {
        return `Attribute "${def.name}" Quantity value must be a finite number`;
      }
      if (typeof qty.unit !== 'string' || !qty.unit.trim()) {
        return `Attribute "${def.name}" Quantity missing unit string`;
      }
      break;

    case 'array':
      if (!Array.isArray(val)) return `Attribute "${def.name}" must be an array`;
      break;

    case 'object':
      if (!val || typeof val !== 'object' || Array.isArray(val)) {
        return `Attribute "${def.name}" must be a non-null object`;
      }
      break;
  }
  return null;
}

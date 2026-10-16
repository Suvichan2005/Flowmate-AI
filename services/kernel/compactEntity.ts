/**
 * Flowmate Greenfield Domain Kernel — Compact AI Serialization (Phase 0)
 * STRICT INVARIANT: ZERO `any`
 */

import { Entity, SchemaDefinition } from './types';

export interface CompactEntityResult {
  id: string;
  s: string;
  v: number;
  t: string;
  st: string;
  [key: string]: unknown;
}

export interface CompactSchemaDigest {
  id: string;
  version: number;
  capabilities: string[];
  attributes: Record<string, { type: string; required: boolean }>;
}

/**
 * Serializes an entity into a dense, deterministic context dictionary
 * for LLM token efficiency, omitting empty attributes and non-canonical fields.
 */
export function compactEntity(
  entity: Entity,
  schema: SchemaDefinition
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: entity.id,
    s: schema.id,
    v: entity.version,
    t: entity.title,
    st: entity.lifecycle.status,
  };

  // Deterministically sort attribute keys
  const definedAttrKeys = Object.keys(schema.attributes).sort();
  for (const key of definedAttrKeys) {
    if (Object.prototype.hasOwnProperty.call(entity.attributes, key)) {
      const val = entity.attributes[key];
      if (val !== null && val !== undefined && val !== '') {
        result[key] = val;
      }
    }
  }

  if (entity.validity?.valid_from) {
    result.vf = entity.validity.valid_from;
  }
  if (entity.validity?.valid_until) {
    result.vu = entity.validity.valid_until;
  }

  if (entity.provenance.is_inferred) {
    result.inf = true;
  }
  if (entity.provenance.confidence < 1.0) {
    result.conf = entity.provenance.confidence;
  }

  return result;
}

/**
 * Creates a compact schema digest suitable for feeding into an AI system prompt.
 */
export function compactSchemaDigest(schema: SchemaDefinition): CompactSchemaDigest {
  const attrEntries = Object.entries(schema.attributes).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const attributes: Record<string, { type: string; required: boolean }> = {};

  for (const [name, def] of attrEntries) {
    attributes[name] = {
      type: def.type,
      required: def.required,
    };
  }

  return {
    id: schema.id,
    version: schema.version,
    capabilities: [...schema.capabilities].sort(),
    attributes,
  };
}

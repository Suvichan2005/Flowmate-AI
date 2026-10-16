/**
 * Flowmate Greenfield Domain Kernel — Core Types (Phase 0)
 * STRICT INVARIANT: ZERO `any`
 */

export type SourceType =
  | 'user'
  | 'agent'
  | 'external_integration'
  | 'device_sensor'
  | 'file_import';

export interface Entity {
  id: string;
  schema_id: string;
  version: number; // Monotonically increasing revision: 1, 2, 3...
  title: string;
  attributes: Record<string, AttributeValue>;
  lifecycle: EntityLifecycle;
  provenance: Provenance;
  validity?: TemporalValidity;
}

export type KernelEntity = Entity;

export interface EntityLifecycle {
  status: string;
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
  deleted_at: string | null;
}

export interface Provenance {
  source_type: SourceType;
  source_id?: string;
  observed_at: string;
  confidence: number; // Strictly: 0 <= confidence <= 1, finite number
  is_inferred: boolean;
  user_confirmed: boolean;
}

export interface TemporalValidity {
  valid_from?: string; // Strict ISO 8601 with timezone
  valid_until?: string; // Strict ISO 8601 with timezone
}

// --- The Concrete Typed Value Model ---

export type AttributeType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'date'
  | 'duration_minutes'
  | 'enum'
  | 'entity_ref'
  | 'geopoint'
  | 'money'
  | 'quantity'
  | 'array'
  | 'object';

export type AttributeValue =
  | string
  | number
  | boolean
  | null
  | EntityReference
  | GeoPointValue
  | MoneyValue
  | QuantityValue
  | AttributeValue[]
  | { [key: string]: AttributeValue };

export interface EntityReference {
  entity_id: string;
  expected_schema_id?: string;
}

export interface GeoPointValue {
  lat: number;
  lng: number;
  address?: string;
  label?: string;
}

export interface MoneyValue {
  amount: number;
  currency: string; // ISO 4217, e.g. 'USD', 'INR'
}

export interface QuantityValue {
  value: number;
  unit: string;
}

// --- Schema Definition ---

export type PrivacyTier = 'public' | 'private' | 'sensitive' | 'device_local';

export interface SchemaDefinition {
  id: string; // Format: 'namespace/type', e.g. 'test/device_telemetry'
  version: number; // Monotonic integer >= 1
  displayName: string;
  description: string;
  scope: 'system' | 'user' | 'module';
  capabilities: string[]; // Extensible capability contract IDs
  attributes: Record<string, AttributeDefinition>;
  privacy_tier: PrivacyTier;
  created_at: string;
  updated_at: string;
}

export interface AttributeDefinition {
  name: string;
  type: AttributeType;
  label: string;
  description: string;
  required: boolean;
  default_value?: AttributeValue;
  enum_options?: string[];
  target_schema_id?: string;
  item_type?: AttributeType;
  object_attributes?: Record<string, AttributeDefinition>;
  constraints?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

// --- Canonical Relationship Definition ---

export type CanonicalRelationshipType =
  | 'FULFILLS'
  | 'PART_OF'
  | 'PRECEDES'
  | 'DEPENDS_ON'
  | 'SCHEDULED_FOR'
  | 'TAGGED_WITH'
  | 'ASSIGNED_TO'
  | 'RELATED_TO';

export const VALID_RELATIONSHIP_TYPES: readonly CanonicalRelationshipType[] = Object.freeze([
  'FULFILLS',
  'PART_OF',
  'PRECEDES',
  'DEPENDS_ON',
  'SCHEDULED_FOR',
  'TAGGED_WITH',
  'ASSIGNED_TO',
  'RELATED_TO',
]);

export interface Relationship {
  id: string;
  from: string;
  to: string;
  type: CanonicalRelationshipType | string;
  meta?: Record<string, unknown>;
  created_at: string;
}


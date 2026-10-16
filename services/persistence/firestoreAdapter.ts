/**
 * Flowmate Greenfield Domain Kernel — Firestore Persistence Adapter
 *
 * Implements PersistencePort for Cloud Firestore.
 *
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - User workspace isolation (/users/{userId}/...)
 * - Encodes schema ids to safe document identifiers
 * - Atomic writeBatch execution with transactional guarantee
 * - Deep immutability on reads
 */

import {
  Firestore,
  doc,
  collection,
  getDoc,
  getDocs,
  writeBatch,
  DocumentData,
} from 'firebase/firestore';
import {
  Entity,
  SchemaDefinition,
  EntityLifecycle,
  Provenance,
  SourceType,
  AttributeValue,
  AttributeDefinition,
} from '../kernel/types';
import {
  PersistencePort,
  PersistenceMutation,
  EntityQueryOptions,
  AuditLogEntry,
} from '../kernel/persistencePort';

export interface FirestoreAdapterOptions {
  db: Firestore | null;
  getUserId: () => string | null;
}

// Invertible schema ID encoding for Firestore document keys
export function encodeSchemaDocId(schemaId: string): string {
  return schemaId.replace(/\//g, '__');
}

export function decodeSchemaDocId(docId: string): string {
  return docId.replace(/__/g, '/');
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function sanitizeForFirestore(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(sanitizeForFirestore);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        out[k] = sanitizeForFirestore(v);
      }
    }
    return out;
  }
  return value;
}

function parseEntityDoc(id: string, data: DocumentData): Entity | null {
  if (!isRecord(data)) return null;

  const schemaId = typeof data.schema_id === 'string' ? data.schema_id : undefined;
  if (!schemaId) return null;

  const version = typeof data.version === 'number' ? data.version : 1;
  const title = typeof data.title === 'string' ? data.title : '';
  const attributes = isRecord(data.attributes)
    ? (data.attributes as Record<string, AttributeValue>)
    : {};

  const rawLifecycle = isRecord(data.lifecycle) ? data.lifecycle : {};
  const lifecycle: EntityLifecycle = {
    status: typeof rawLifecycle.status === 'string' ? rawLifecycle.status : 'active',
    created_at:
      typeof rawLifecycle.created_at === 'string'
        ? rawLifecycle.created_at
        : new Date().toISOString(),
    updated_at:
      typeof rawLifecycle.updated_at === 'string'
        ? rawLifecycle.updated_at
        : new Date().toISOString(),
    deleted_at:
      typeof rawLifecycle.deleted_at === 'string' ? rawLifecycle.deleted_at : null,
  };

  const rawProvenance = isRecord(data.provenance) ? data.provenance : {};
  const rawSourceType =
    typeof rawProvenance.source_type === 'string' ? rawProvenance.source_type : 'user';
  const validSourceTypes = new Set([
    'user',
    'agent',
    'external_integration',
    'device_sensor',
    'file_import',
  ]);
  const sourceType = validSourceTypes.has(rawSourceType)
    ? (rawSourceType as SourceType)
    : 'user';

  const confidence =
    typeof rawProvenance.confidence === 'number' && Number.isFinite(rawProvenance.confidence)
      ? Math.max(0, Math.min(1, rawProvenance.confidence))
      : 1.0;

  const provenance: Provenance = {
    source_type: sourceType,
    source_id:
      typeof rawProvenance.source_id === 'string' ? rawProvenance.source_id : undefined,
    observed_at:
      typeof rawProvenance.observed_at === 'string'
        ? rawProvenance.observed_at
        : new Date().toISOString(),
    confidence,
    is_inferred: Boolean(rawProvenance.is_inferred),
    user_confirmed: Boolean(rawProvenance.user_confirmed),
  };

  const entity: Entity = {
    id,
    schema_id: schemaId,
    version,
    title,
    attributes,
    lifecycle,
    provenance,
  };

  if (isRecord(data.validity)) {
    entity.validity = {
      valid_from:
        typeof data.validity.valid_from === 'string' ? data.validity.valid_from : undefined,
      valid_until:
        typeof data.validity.valid_until === 'string'
          ? data.validity.valid_until
          : undefined,
    };
  }

  return entity;
}

function parseSchemaDoc(docId: string, data: DocumentData): SchemaDefinition | null {
  if (!isRecord(data)) return null;
  const id = typeof data.id === 'string' ? data.id : decodeSchemaDocId(docId);
  const displayName = typeof data.displayName === 'string' ? data.displayName : '';
  if (!displayName) return null;

  const version = typeof data.version === 'number' ? data.version : 1;
  const description = typeof data.description === 'string' ? data.description : '';
  const scope =
    data.scope === 'system' || data.scope === 'user' || data.scope === 'module'
      ? data.scope
      : 'user';
  const capabilities = Array.isArray(data.capabilities)
    ? data.capabilities.filter((c): c is string => typeof c === 'string')
    : [];
  const attributes = isRecord(data.attributes)
    ? (data.attributes as Record<string, AttributeDefinition>)
    : {};
  const privacyTier =
    data.privacy_tier === 'public' ||
    data.privacy_tier === 'private' ||
    data.privacy_tier === 'sensitive' ||
    data.privacy_tier === 'device_local'
      ? data.privacy_tier
      : 'private';

  return {
    id,
    version,
    displayName,
    description,
    scope,
    capabilities,
    attributes,
    privacy_tier: privacyTier,
    created_at:
      typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    updated_at:
      typeof data.updated_at === 'string' ? data.updated_at : new Date().toISOString(),
  };
}

function parseAuditLogDoc(id: string, data: DocumentData): AuditLogEntry | null {
  if (!isRecord(data)) return null;
  return {
    id,
    timestamp:
      typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
    source: typeof data.source === 'string' ? data.source : 'unknown',
    intent: typeof data.intent === 'string' ? data.intent : '',
    mutation_count: typeof data.mutation_count === 'number' ? data.mutation_count : 0,
  };
}

export class FirestorePersistenceAdapter implements PersistencePort {
  private db: Firestore | null;
  private getUserId: () => string | null;

  constructor(options: FirestoreAdapterOptions) {
    this.db = options.db;
    this.getUserId = options.getUserId;
  }

  private ensureContext(): { db: Firestore; userId: string } {
    if (!this.db) {
      throw new Error('FirestorePersistenceAdapter: Firebase Firestore is not initialized.');
    }
    const userId = this.getUserId();
    if (!userId) {
      throw new Error('FirestorePersistenceAdapter: No authenticated user context available.');
    }
    return { db: this.db, userId };
  }

  async getEntity(id: string): Promise<Entity | null> {
    if (!this.db || !this.getUserId()) return null;
    const { db, userId } = this.ensureContext();
    const docRef = doc(db, 'users', userId, 'entities', id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    const parsed = parseEntityDoc(snap.id, snap.data());
    return parsed ? structuredClone(parsed) : null;
  }

  async queryEntities(queryOptions: EntityQueryOptions): Promise<Entity[]> {
    if (!this.db || !this.getUserId()) return [];
    const { db, userId } = this.ensureContext();
    const colRef = collection(db, 'users', userId, 'entities');
    const snap = await getDocs(colRef);
    const results: Entity[] = [];

    for (const d of snap.docs) {
      const parsed = parseEntityDoc(d.id, d.data());
      if (!parsed) continue;

      // Exclude soft-deleted
      if (parsed.lifecycle.deleted_at !== null) continue;

      // Filter by schema_id if requested
      if (queryOptions.schema_id && parsed.schema_id !== queryOptions.schema_id) {
        continue;
      }

      // Filter by lifecycle status if requested
      if (queryOptions.status && parsed.lifecycle.status !== queryOptions.status) {
        continue;
      }

      results.push(structuredClone(parsed));
    }

    return results;
  }

  async getSchema(id: string): Promise<SchemaDefinition | null> {
    if (!this.db || !this.getUserId()) return null;
    const { db, userId } = this.ensureContext();
    const docId = encodeSchemaDocId(id);
    const docRef = doc(db, 'users', userId, 'schemas', docId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    const parsed = parseSchemaDoc(snap.id, snap.data());
    return parsed ? structuredClone(parsed) : null;
  }

  async listSchemas(): Promise<SchemaDefinition[]> {
    if (!this.db || !this.getUserId()) return [];
    const { db, userId } = this.ensureContext();
    const colRef = collection(db, 'users', userId, 'schemas');
    const snap = await getDocs(colRef);
    const results: SchemaDefinition[] = [];

    for (const d of snap.docs) {
      const parsed = parseSchemaDoc(d.id, d.data());
      if (parsed) {
        results.push(structuredClone(parsed));
      }
    }

    return results;
  }

  async getAuditLogs(): Promise<AuditLogEntry[]> {
    if (!this.db || !this.getUserId()) return [];
    const { db, userId } = this.ensureContext();
    const colRef = collection(db, 'users', userId, 'audit_logs');
    const snap = await getDocs(colRef);
    const results: AuditLogEntry[] = [];

    for (const d of snap.docs) {
      const parsed = parseAuditLogDoc(d.id, d.data());
      if (parsed) {
        results.push(structuredClone(parsed));
      }
    }

    // Sort newest first
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return results;
  }

  async commitBatch(operations: PersistenceMutation[]): Promise<void> {
    if (operations.length === 0) return;
    const { db, userId } = this.ensureContext();
    const batch = writeBatch(db);

    for (const op of operations) {
      if (op.type === 'set_entity') {
        const docRef = doc(db, 'users', userId, 'entities', op.entity.id);
        const payload = sanitizeForFirestore({
          ...op.entity,
          schema_version: 5,
          // Legacy read mirrors for stale-client coexistence
          title: op.entity.title,
          status: op.entity.lifecycle.status,
          kind: op.entity.schema_id.replace(/^system\//, '').toUpperCase(),
        });
        batch.set(docRef, payload as DocumentData);
      } else if (op.type === 'soft_delete_entity') {
        const docRef = doc(db, 'users', userId, 'entities', op.id);
        const timestamp = new Date().toISOString();
        const payload = sanitizeForFirestore({
          'lifecycle.deleted_at': timestamp,
          'lifecycle.updated_at': timestamp,
        });
        batch.set(docRef, payload as DocumentData, { merge: true });
      } else if (op.type === 'set_schema') {
        const docId = encodeSchemaDocId(op.schema.id);
        const docRef = doc(db, 'users', userId, 'schemas', docId);
        const payload = sanitizeForFirestore(op.schema);
        batch.set(docRef, payload as DocumentData);
      } else if (op.type === 'append_audit_log') {
        const docRef = doc(db, 'users', userId, 'audit_logs', op.entry.id);
        const payload = sanitizeForFirestore(op.entry);
        batch.set(docRef, payload as DocumentData);
      }
    }

    await batch.commit();
  }
}

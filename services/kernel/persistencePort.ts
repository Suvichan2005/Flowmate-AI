/**
 * Flowmate Greenfield Domain Kernel — Persistence Port & In-Memory Adapter (Phase 0)
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - Deep snapshot isolation & transactional rollback
 * - Immutability on read (deep clones returned)
 * - Domain Kernel does NOT import Firebase
 */

import { Entity, SchemaDefinition, Relationship } from './types';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  source: string;
  intent: string;
  mutation_count: number;
}

export interface RelationshipQueryOptions {
  from?: string;
  to?: string;
  type?: string;
  entity_id?: string;
}

export type PersistenceMutation =
  | { type: 'set_entity'; entity: Entity }
  | { type: 'soft_delete_entity'; id: string }
  | { type: 'set_relationship'; relationship: Relationship }
  | { type: 'delete_relationship'; id: string }
  | { type: 'set_schema'; schema: SchemaDefinition }
  | { type: 'append_audit_log'; entry: AuditLogEntry };

export interface EntityQueryOptions {
  schema_id?: string;
  status?: string;
}

export interface PersistencePort {
  getEntity(id: string): Promise<Entity | null>;
  queryEntities(query: EntityQueryOptions): Promise<Entity[]>;
  getRelationship?(id: string): Promise<Relationship | null>;
  queryRelationships?(query: RelationshipQueryOptions): Promise<Relationship[]>;
  getSchema(id: string): Promise<SchemaDefinition | null>;
  listSchemas(): Promise<SchemaDefinition[]>;
  commitBatch(operations: PersistenceMutation[]): Promise<void>;
  getAuditLogs(): Promise<AuditLogEntry[]>;
}

export class InMemoryPersistenceAdapter implements PersistencePort {
  private entities = new Map<string, Entity>();
  private relationships = new Map<string, Relationship>();
  private schemas = new Map<string, SchemaDefinition>();
  private auditLogs: AuditLogEntry[] = [];

  /** Immutability invariant: Always return a deep clone */
  async getEntity(id: string): Promise<Entity | null> {
    const e = this.entities.get(id);
    return e ? structuredClone(e) : null;
  }

  /** Immutability invariant: Always return deep clones */
  async queryEntities(query: EntityQueryOptions): Promise<Entity[]> {
    return Array.from(this.entities.values())
      .filter(e => {
        if (e.lifecycle.deleted_at !== null) return false;
        if (query.schema_id && e.schema_id !== query.schema_id) return false;
        if (query.status && e.lifecycle.status !== query.status) return false;
        return true;
      })
      .map(e => structuredClone(e));
  }

  async getRelationship(id: string): Promise<Relationship | null> {
    const r = this.relationships.get(id);
    return r ? structuredClone(r) : null;
  }

  async queryRelationships(query: RelationshipQueryOptions = {}): Promise<Relationship[]> {
    return Array.from(this.relationships.values())
      .filter(r => {
        if (query.from && r.from !== query.from) return false;
        if (query.to && r.to !== query.to) return false;
        if (query.type && r.type !== query.type) return false;
        if (query.entity_id && r.from !== query.entity_id && r.to !== query.entity_id) return false;
        return true;
      })
      .map(r => structuredClone(r));
  }

  /** Synchronous helper for testing & fast referential checks */
  getEntitySync(id: string): Entity | null {
    const e = this.entities.get(id);
    return e ? structuredClone(e) : null;
  }

  /** Synchronous helper for testing */
  getRelationshipSync(id: string): Relationship | null {
    const r = this.relationships.get(id);
    return r ? structuredClone(r) : null;
  }

  /** Synchronous helper to prefill entities in memory */
  setEntitySync(entity: Entity): void {
    this.entities.set(entity.id, structuredClone(entity));
  }

  /** Synchronous helper to prefill relationships in memory */
  setRelationshipSync(relationship: Relationship): void {
    this.relationships.set(relationship.id, structuredClone(relationship));
  }

  async getSchema(id: string): Promise<SchemaDefinition | null> {
    const s = this.schemas.get(id);
    return s ? structuredClone(s) : null;
  }

  async listSchemas(): Promise<SchemaDefinition[]> {
    return Array.from(this.schemas.values()).map(s => structuredClone(s));
  }

  async getAuditLogs(): Promise<AuditLogEntry[]> {
    return structuredClone(this.auditLogs);
  }

  /**
   * Transactional Atomic Apply with Deep Snapshot Isolation:
   * 1. Deep-clones entire working state.
   * 2. Applies batch to working state.
   * 3. Discards working state on failure.
   * 4. Atomically replaces on success.
   */
  async commitBatch(operations: PersistenceMutation[]): Promise<void> {
    const workingEntities = structuredClone(this.entities);
    const workingSchemas = structuredClone(this.schemas);
    const workingLogs = structuredClone(this.auditLogs);
    const workingRelationships = structuredClone(this.relationships);

    for (const op of operations) {
      if (op.type === 'set_entity') {
        workingEntities.set(op.entity.id, structuredClone(op.entity));
      } else if (op.type === 'soft_delete_entity') {
        const e = workingEntities.get(op.id);
        if (!e) {
          throw new Error(`Cannot soft-delete non-existent entity: "${op.id}"`);
        }
        e.lifecycle.deleted_at = new Date().toISOString();
        workingEntities.set(op.id, e);
      } else if (op.type === 'set_relationship') {
        workingRelationships.set(op.relationship.id, structuredClone(op.relationship));
      } else if (op.type === 'delete_relationship') {
        workingRelationships.delete(op.id);
      } else if (op.type === 'set_schema') {
        workingSchemas.set(op.schema.id, structuredClone(op.schema));
      } else if (op.type === 'append_audit_log') {
        workingLogs.push(structuredClone(op.entry));
      }
    }

    // Atomic replacement
    this.entities = workingEntities;
    this.schemas = workingSchemas;
    this.auditLogs = workingLogs;
    this.relationships = workingRelationships;
  }
}

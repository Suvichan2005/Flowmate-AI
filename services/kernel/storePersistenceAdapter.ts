/**
 * Flowmate Greenfield Domain Kernel — Zustand Store Persistence Adapter
 *
 * Implements PersistencePort directly backed by the local application store.
 * Dispatches mutations directly to canonical kernelEntities and auditLogs.
 *
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - Pure TypeScript immutability
 * - Full transactional callback support
 */

import { Entity, SchemaDefinition, Relationship } from './types';
import {
  PersistencePort,
  PersistenceMutation,
  EntityQueryOptions,
  RelationshipQueryOptions,
  AuditLogEntry,
} from './persistencePort';

export interface StoreAccessor {
  getKernelEntities: () => Record<string, Entity>;
  getRelationships?: () => Relationship[];
  getSchemas: () => Record<string, SchemaDefinition>;
  getAuditLogs: () => AuditLogEntry[];
  applyBatch: (mutations: PersistenceMutation[]) => void;
}

export class StorePersistenceAdapter implements PersistencePort {
  constructor(private accessor: StoreAccessor) {}

  async getEntity(id: string): Promise<Entity | null> {
    const map = this.accessor.getKernelEntities();
    const entity = map[id];
    return entity ? structuredClone(entity) : null;
  }

  async queryEntities(query: EntityQueryOptions): Promise<Entity[]> {
    const map = this.accessor.getKernelEntities();
    return Object.values(map)
      .filter((e) => {
        if (e.lifecycle.deleted_at !== null) return false;
        if (query.schema_id && e.schema_id !== query.schema_id) return false;
        if (query.status && e.lifecycle.status !== query.status) return false;
        return true;
      })
      .map((e) => structuredClone(e));
  }

  async getRelationship(id: string): Promise<Relationship | null> {
    const list = this.accessor.getRelationships ? this.accessor.getRelationships() : [];
    const rel = list.find((r) => r.id === id);
    return rel ? structuredClone(rel) : null;
  }

  async queryRelationships(query: RelationshipQueryOptions = {}): Promise<Relationship[]> {
    const list = this.accessor.getRelationships ? this.accessor.getRelationships() : [];
    return list
      .filter((r) => {
        if (query.from && r.from !== query.from) return false;
        if (query.to && r.to !== query.to) return false;
        if (query.type && r.type !== query.type) return false;
        if (query.entity_id && r.from !== query.entity_id && r.to !== query.entity_id) return false;
        return true;
      })
      .map((r) => structuredClone(r));
  }

  async getSchema(id: string): Promise<SchemaDefinition | null> {
    const map = this.accessor.getSchemas();
    const schema = map[id];
    return schema ? structuredClone(schema) : null;
  }

  async listSchemas(): Promise<SchemaDefinition[]> {
    const map = this.accessor.getSchemas();
    return Object.values(map).map((s) => structuredClone(s));
  }

  async commitBatch(operations: PersistenceMutation[]): Promise<void> {
    this.accessor.applyBatch(operations);
  }

  async getAuditLogs(): Promise<AuditLogEntry[]> {
    return structuredClone(this.accessor.getAuditLogs());
  }
}

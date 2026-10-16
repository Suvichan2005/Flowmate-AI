/**
 * Flowmate Synchronization & Conflict Engine — Core Types (P1-09)
 *
 * Defines platform-agnostic contracts for monotonic revisions,
 * mutation idempotency, conflict detection, and pending mutation queueing.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { Entity as KernelEntity } from '../kernel/types';

export type ConflictType =
  | 'stale_mutation'
  | 'concurrent_edit'
  | 'tombstone_violation'
  | 'schema_mismatch';

export type ConflictResolutionOption =
  | 'keep_remote'
  | 'keep_local'
  | 'reapply_on_latest'
  | 'discard';

export interface ConflictDescriptor {
  readonly id: string;
  readonly entity_id: string;
  readonly conflict_type: ConflictType;
  readonly local_revision: number;
  readonly remote_revision: number;
  readonly conflicting_fields: string[];
  readonly message: string;
  readonly resolution_options: ConflictResolutionOption[];
  readonly detected_at: string; // ISO 8601 UTC
}

export interface SyncMutationRecord {
  readonly mutation_id: string;
  readonly entity_id: string;
  readonly base_revision: number;
  readonly target_revision: number;
  readonly op_type: 'upsert_entity' | 'soft_delete_entity' | 'restore_entity';
  readonly timestamp: string; // ISO 8601 UTC
  readonly client_id: string;
  readonly actor: 'user_ui' | 'ai_agent' | 'sync_remote' | 'system';
}

export type PendingMutationStatus =
  | 'pending'
  | 'in_flight'
  | 'committed'
  | 'rejected';

export interface PendingMutation {
  readonly mutation_id: string;
  readonly entity_id: string;
  readonly base_revision: number;
  readonly op_type: 'upsert_entity' | 'soft_delete_entity' | 'restore_entity';
  readonly entity: KernelEntity;
  readonly created_at: string;
  readonly status: PendingMutationStatus;
  readonly retry_count: number;
  readonly error?: string;
}

export interface ReconciliationResult {
  readonly resolvedEntity: KernelEntity;
  readonly action: 'accept_remote' | 'keep_local' | 'merged' | 'conflict_detected';
  readonly conflict?: ConflictDescriptor;
}

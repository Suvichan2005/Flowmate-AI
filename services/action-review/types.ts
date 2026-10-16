/**
 * Flowmate Action Review Continuity & Draft Persistence Types
 * STRICT INVARIANT: ZERO `any`
 */

import type { ToonOperation } from '../../types';
import type { Entity as KernelEntity } from '../kernel/types';

export type DraftSource = 'natural_intent' | 'voice_capture' | 'ai_agent' | 'manual_edit' | 'component_form';

export interface TargetEntitySnapshot {
  id: string;
  version: number;
  updatedAt: string;
  title: string;
  schemaId: string;
}

export interface ReviewDraft {
  id: string; // "draft_..."
  source: DraftSource;
  rawInput: string;
  createdAt: string; // ISO 8601 UTC
  ops: ToonOperation[];
  targetSnapshots: Record<string, TargetEntitySnapshot>;
  metadata?: {
    originalMessageId?: string;
    intentKind?: string;
    userNotes?: string;
    proposalId?: string;
  };
}

export type OperationValidationStatus =
  | 'valid'
  | 'conflict_modified'
  | 'stale_deleted'
  | 'id_collision';

export interface OperationValidationItem {
  opIndex: number;
  op: ToonOperation;
  status: OperationValidationStatus;
  targetId?: string;
  reason: string;
  snapshotVersion?: number;
  currentVersion?: number;
}

export interface DraftValidationResult {
  draftId: string;
  isValid: boolean;
  hasConflicts: boolean;
  revalidatedAt: string;
  items: OperationValidationItem[];
  validOpCount: number;
  conflictCount: number;
  summary: string;
}

export type KernelEntitiesMap = Record<string, KernelEntity>;

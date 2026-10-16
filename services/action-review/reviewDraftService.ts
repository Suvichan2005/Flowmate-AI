/**
 * Flowmate Action Review Draft Service
 *
 * Provides recoverable draft persistence for unconfirmed proposals across navigation/refresh,
 * coupled with mandatory Current-State Revalidation before any action can be re-proposed or confirmed.
 *
 * STRICT INVARIANTS:
 * - ZERO unconfirmed mutations to canonical kernel state.
 * - ZERO stale execution fingerprints (never re-executes against superseded or deleted entities).
 * - ZERO `any` type usage.
 */

import type { ToonOperation } from '../../types';
import type { Entity as KernelEntity } from '../kernel/types';
import type {
  ReviewDraft,
  DraftValidationResult,
  OperationValidationItem,
  TargetEntitySnapshot,
  KernelEntitiesMap,
  DraftSource
} from './types';

const STORAGE_KEY = 'flowmate_action_review_drafts';

// In-memory fallback for headless/Node test environments
let memoryStorage: Record<string, string> = {};

function getRawStorage(): Record<string, string> | Storage {
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  return memoryStorage;
}

function readDraftsMap(): Record<string, ReviewDraft> {
  try {
    let raw: string | null = null;
    if (typeof localStorage !== 'undefined') {
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch {
        raw = null;
      }
    }
    if (!raw && memoryStorage[STORAGE_KEY]) {
      raw = memoryStorage[STORAGE_KEY];
    }

    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ReviewDraft>;
  } catch {
    return {};
  }
}

function writeDraftsMap(map: Record<string, ReviewDraft>): void {
  try {
    const serialized = JSON.stringify(map);
    memoryStorage[STORAGE_KEY] = serialized;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, serialized);
      } catch {
        // Ignore quota/access errors
      }
    }
  } catch {
    // Graceful persistence degradation
  }
}

/**
 * Creates a unique draft ID with timestamp prefix
 */
export function generateDraftId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 9);
  return `draft_${ts}_${rand}`;
}

/**
 * Captures snapshot metadata of target entities affected by pending operations.
 * Used during revalidation to detect if entities were modified or deleted externally.
 */
export function captureEntitySnapshots(
  ops: ToonOperation[],
  kernelEntities: KernelEntitiesMap
): Record<string, TargetEntitySnapshot> {
  const snapshots: Record<string, TargetEntitySnapshot> = {};

  for (const op of ops) {
    const payload = op.payload;
    const targetId = typeof payload.id === 'string'
      ? payload.id
      : typeof payload.target_id === 'string'
      ? payload.target_id
      : typeof payload.entity_id === 'string'
      ? payload.entity_id
      : null;

    if (targetId && kernelEntities[targetId]) {
      const entity = kernelEntities[targetId];
      snapshots[targetId] = {
        id: entity.id,
        version: entity.version,
        updatedAt: entity.lifecycle.updated_at,
        title: entity.title,
        schemaId: entity.schema_id
      };
    }

    // Also check links for source and target entities
    const fromId = typeof payload.from_id === 'string' ? payload.from_id : null;
    const toId = typeof payload.to_id === 'string' ? payload.to_id : null;

    if (fromId && kernelEntities[fromId]) {
      const entity = kernelEntities[fromId];
      snapshots[fromId] = {
        id: entity.id,
        version: entity.version,
        updatedAt: entity.lifecycle.updated_at,
        title: entity.title,
        schemaId: entity.schema_id
      };
    }
    if (toId && kernelEntities[toId]) {
      const entity = kernelEntities[toId];
      snapshots[toId] = {
        id: entity.id,
        version: entity.version,
        updatedAt: entity.lifecycle.updated_at,
        title: entity.title,
        schemaId: entity.schema_id
      };
    }
  }

  return snapshots;
}

/**
 * Creates and persists an unconfirmed review draft.
 */
export async function saveReviewDraft(
  source: DraftSource,
  rawInput: string,
  ops: ToonOperation[],
  kernelEntities: KernelEntitiesMap,
  metadata?: ReviewDraft['metadata']
): Promise<ReviewDraft> {
  const draftId = generateDraftId();
  const targetSnapshots = captureEntitySnapshots(ops, kernelEntities);

  const draft: ReviewDraft = {
    id: draftId,
    source,
    rawInput,
    createdAt: new Date().toISOString(),
    ops,
    targetSnapshots,
    metadata
  };

  const map = readDraftsMap();
  map[draft.id] = draft;
  writeDraftsMap(map);

  return draft;
}

/**
 * Retrieves a specific review draft by ID.
 */
export async function getReviewDraft(id: string): Promise<ReviewDraft | null> {
  const map = readDraftsMap();
  return map[id] || null;
}

/**
 * Lists all pending review drafts ordered newest first.
 */
export async function listReviewDrafts(): Promise<ReviewDraft[]> {
  const map = readDraftsMap();
  return Object.values(map).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Gets the most recent unconfirmed review draft.
 */
export async function getLatestReviewDraft(): Promise<ReviewDraft | null> {
  const drafts = await listReviewDrafts();
  return drafts.length > 0 ? drafts[0] : null;
}

/**
 * Deletes a confirmed or cancelled review draft.
 */
export async function deleteReviewDraft(id: string): Promise<void> {
  const map = readDraftsMap();
  if (map[id]) {
    delete map[id];
    writeDraftsMap(map);
  }
}

/**
 * Clears all stored drafts.
 */
export async function clearAllReviewDrafts(): Promise<void> {
  memoryStorage = {};
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

/**
 * CURRENT-STATE REVALIDATION GATE
 *
 * Evaluates an unconfirmed draft against the live kernelEntities map.
 * Detects:
 * 1. ID Collisions for creation operations
 * 2. External mutations on existing entities (version or timestamp mismatch)
 * 3. Supervening deletions (entity removed or tombstoned by peer tab)
 * 4. Broken link endpoints
 */
export function revalidateReviewDraft(
  draft: ReviewDraft,
  currentKernelEntities: KernelEntitiesMap
): DraftValidationResult {
  const items: OperationValidationItem[] = [];
  let conflictCount = 0;
  let validOpCount = 0;

  draft.ops.forEach((op, index) => {
    const type: string = op.type;
    const payload = op.payload;
    const targetId = typeof payload.id === 'string'
      ? payload.id
      : typeof payload.target_id === 'string'
      ? payload.target_id
      : typeof payload.entity_id === 'string'
      ? payload.entity_id
      : undefined;

    // 1. Entity Creation Operations
    if (type === 'create_entity' || type === 'c') {
      if (targetId && currentKernelEntities[targetId]) {
        conflictCount++;
        items.push({
          opIndex: index,
          op,
          status: 'id_collision',
          targetId,
          reason: `Entity ID '${targetId}' already exists in current store.`
        });
      } else {
        validOpCount++;
        items.push({
          opIndex: index,
          op,
          status: 'valid',
          targetId,
          reason: 'Ready to create entity in current store.'
        });
      }
      return;
    }

    // 2. Entity Modification / Subtask / Log Operations
    if (
      type === 'update_entity' || type === 'u' ||
      type === 'add_subtask' || type === 's' ||
      type === 'log_to_entity' || type === 'log' ||
      type === 'log_food' || type === 'f'
    ) {
      if (!targetId || !currentKernelEntities[targetId]) {
        conflictCount++;
        items.push({
          opIndex: index,
          op,
          status: 'stale_deleted',
          targetId,
          reason: `Target entity '${targetId || 'unknown'}' was deleted or does not exist.`
        });
        return;
      }

      const current = currentKernelEntities[targetId];
      if (current.lifecycle?.deleted_at) {
        conflictCount++;
        items.push({
          opIndex: index,
          op,
          status: 'stale_deleted',
          targetId,
          reason: `Target entity '${targetId}' was archived/deleted at ${current.lifecycle.deleted_at}.`
        });
        return;
      }

      const snapshot = draft.targetSnapshots[targetId];
      if (snapshot) {
        const versionChanged = current.version !== snapshot.version;
        const timeChanged = current.lifecycle.updated_at !== snapshot.updatedAt;

        if (versionChanged || timeChanged) {
          conflictCount++;
          items.push({
            opIndex: index,
            op,
            status: 'conflict_modified',
            targetId,
            snapshotVersion: snapshot.version,
            currentVersion: current.version,
            reason: `Target entity '${targetId}' was modified externally (draft v${snapshot.version} vs current v${current.version}).`
          });
          return;
        }
      }

      validOpCount++;
      items.push({
        opIndex: index,
        op,
        status: 'valid',
        targetId,
        reason: `Target entity '${targetId}' verified against current store.`
      });
      return;
    }

    // 3. Deletion / Archival Operations
    if (type === 'delete_entity' || type === 'd' || type === 'archive_entity' || type === 'arc') {
      if (!targetId || !currentKernelEntities[targetId] || currentKernelEntities[targetId].lifecycle?.deleted_at) {
        conflictCount++;
        items.push({
          opIndex: index,
          op,
          status: 'stale_deleted',
          targetId,
          reason: `Entity '${targetId || 'unknown'}' is already deleted or not found.`
        });
        return;
      }

      validOpCount++;
      items.push({
        opIndex: index,
        op,
        status: 'valid',
        targetId,
        reason: `Target entity '${targetId}' exists and is ready for deletion/archival.`
      });
      return;
    }

    // 4. Link Operations
    if (type === 'link_entities' || type === 'l') {
      const fromId = typeof payload.from_id === 'string' ? payload.from_id : undefined;
      const toId = typeof payload.to_id === 'string' ? payload.to_id : undefined;

      const fromExists = fromId && currentKernelEntities[fromId] && !currentKernelEntities[fromId].lifecycle?.deleted_at;
      const toExists = toId && currentKernelEntities[toId] && !currentKernelEntities[toId].lifecycle?.deleted_at;

      if (!fromExists || !toExists) {
        conflictCount++;
        items.push({
          opIndex: index,
          op,
          status: 'stale_deleted',
          reason: `Link participants missing: from (${fromId || 'missing'}), to (${toId || 'missing'}).`
        });
        return;
      }

      validOpCount++;
      items.push({
        opIndex: index,
        op,
        status: 'valid',
        reason: 'Both relationship participants verified in current store.'
      });
      return;
    }

    // Default: Other operations
    validOpCount++;
    items.push({
      opIndex: index,
      op,
      status: 'valid',
      reason: 'Operation validated.'
    });
  });

  const hasConflicts = conflictCount > 0;
  const isValid = !hasConflicts && items.length > 0;

  const summary = hasConflicts
    ? `Revalidation failed: ${conflictCount} conflict(s) detected across ${draft.ops.length} operation(s).`
    : `Revalidation passed: All ${draft.ops.length} operation(s) verified against current kernel state.`;

  return {
    draftId: draft.id,
    isValid,
    hasConflicts,
    revalidatedAt: new Date().toISOString(),
    items,
    validOpCount,
    conflictCount,
    summary
  };
}

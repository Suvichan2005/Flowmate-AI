/**
 * Flowmate Synchronization & Conflict Engine — Entity Reconciler (P1-09)
 *
 * Deterministic, platform-independent reconciliation of local and remote
 * entity state transitions.
 *
 * Enforces:
 * 1. Monotonic revision checking.
 * 2. Tombstone supremacy: Deletions cannot be overwritten by stale edits.
 * 3. Non-overlapping field merge where safe.
 * 4. Structured conflict generation for overlapping edits.
 *
 * STRICT INVARIANT: ZERO `any`
 */

import { Entity as KernelEntity, AttributeValue } from '../kernel/types';
import {
  ReconciliationResult,
  ConflictDescriptor,
  PendingMutation,
} from './types';
import { PendingMutationQueue } from './pendingQueue';
import { upgradeLegacyEntityToKernel } from '../persistence/legacyMigration';

function isRecord(val: unknown): val is Record<string, AttributeValue> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function parseTimestampMs(ts: unknown): number {
  if (typeof ts === 'string' && ts.trim() !== '') {
    const ms = new Date(ts).getTime();
    if (!isNaN(ms)) return ms;
  }
  if (typeof ts === 'number' && !isNaN(ts)) {
    return ts;
  }
  return 0;
}

export function canonicalJson(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map(v => (v === undefined ? 'null' : canonicalJson(v))).join(',') + ']';
  }
  const rec = val as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  const pairs: string[] = [];
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && typeof v !== 'function' && typeof v !== 'symbol') {
      pairs.push(JSON.stringify(k) + ':' + canonicalJson(v));
    }
  }
  return '{' + pairs.join(',') + '}';
}

/** Preserve the current reference when a remote snapshot is materially equal. */
export function retainCanonicalReference<T>(current: T, candidate: T): T {
  return canonicalJson(current) === canonicalJson(candidate) ? current : candidate;
}

function areAttributeValuesEqual(a: AttributeValue | undefined, b: AttributeValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object' || typeof b === 'object') {
    return canonicalJson(a) === canonicalJson(b);
  }
  return false;
}

function isExplicitRestore(
  entity: KernelEntity,
  deletedAt: string | null | undefined,
  pendingMutation?: PendingMutation
): boolean {
  // Fail-closed invariant: raw unauthenticated JSON flags (restored: true, restored_at)
  // or unsigned pending operations cannot revive a tombstone without authenticated authorization.
  return false;
}

/**
 * Reconciles a local and remote KernelEntity deterministically.
 */
export function reconcileEntity(
  local: KernelEntity | null,
  remote: KernelEntity,
  pendingMutation?: PendingMutation,
  now = new Date().toISOString()
): ReconciliationResult {
  // 1. Initial adoption when local does not exist
  if (!local) {
    return {
      resolvedEntity: remote,
      action: 'accept_remote',
    };
  }

  const isRemoteDeleted = remote.lifecycle.deleted_at !== null || remote.lifecycle.status === 'deleted';
  const isLocalDeleted = local.lifecycle.deleted_at !== null || local.lifecycle.status === 'deleted';


  // 2. Tombstone Supremacy: Remote is deleted
  if (isRemoteDeleted) {
    // If local was already deleted, preserve monotonic versioning
    if (isLocalDeleted) {
      if (remote.version > local.version) {
        return {
          resolvedEntity: remote,
          action: 'accept_remote',
        };
      }
      if (local.version > remote.version) {
        return {
          resolvedEntity: local,
          action: 'keep_local',
        };
      }

      // Equal revisions for both-deleted tombstones:
      // Compare updated_at epoch ms, then canonicalJson tie-breaker
      const localUpdated = parseTimestampMs(local.lifecycle.updated_at || local.lifecycle.deleted_at);
      const remoteUpdated = parseTimestampMs(remote.lifecycle.updated_at || remote.lifecycle.deleted_at);

      if (remoteUpdated > localUpdated) {
        return {
          resolvedEntity: remote,
          action: 'accept_remote',
        };
      }

      if (localUpdated > remoteUpdated) {
        return {
          resolvedEntity: local,
          action: 'keep_local',
        };
      }

      const jsonLocal = canonicalJson(local);
      const jsonRemote = canonicalJson(remote);
      if (jsonRemote > jsonLocal) {
        return {
          resolvedEntity: remote,
          action: 'accept_remote',
        };
      }

      return {
        resolvedEntity: local,
        action: 'keep_local',
      };
    }

    // Check if local has an explicit authenticated restoration
    const localHasExplicitRestore = isExplicitRestore(local, remote.lifecycle.deleted_at, pendingMutation);
    if (localHasExplicitRestore) {
      return {
        resolvedEntity: local,
        action: 'keep_local',
      };
    }

    // If local has an uncommitted pending edit whose base revision is <= remote revision
    if (pendingMutation && pendingMutation.base_revision <= remote.version) {
      const winnerVersion = Math.max(local.version, remote.version);
      const resolvedEntity: KernelEntity = winnerVersion > remote.version
        ? { ...remote, version: winnerVersion }
        : remote;

      const conflict: ConflictDescriptor = {
        id: `conflict_${remote.id}_${Date.now()}`,
        entity_id: remote.id,
        conflict_type: 'tombstone_violation',
        local_revision: local.version,
        remote_revision: remote.version,
        conflicting_fields: ['lifecycle.status', 'lifecycle.deleted_at'],
        message: `Entity "${local.title}" was deleted remotely. Stale local edit rejected.`,
        resolution_options: ['keep_remote', 'reapply_on_latest', 'discard'],
        detected_at: now,
      };

      return {
        resolvedEntity, // Deletion wins with monotonic version!
        action: 'conflict_detected',
        conflict,
      };
    }

    // Unsynchronized or stale local edit vs remote deletion: remote deletion wins!
    // Monotonically advance version if local had progressed past remote revision to preserve convergence
    const winnerVersion = local.version > remote.version
      ? local.version + 1
      : remote.version;
    const resolvedEntity: KernelEntity = winnerVersion !== remote.version
      ? { ...remote, version: winnerVersion }
      : remote;

    return {
      resolvedEntity,
      action: 'accept_remote',
    };
  }

  // 3. Tombstone Supremacy: Local is deleted
  if (isLocalDeleted && !isRemoteDeleted) {
    // Check if remote has an explicit authenticated restoration
    const remoteHasExplicitRestore = isExplicitRestore(remote, local.lifecycle.deleted_at);

    if (remoteHasExplicitRestore) {
      // Remote restoration occurred explicitly
      return {
        resolvedEntity: remote,
        action: 'accept_remote',
      };
    }

    // Remote edit is NOT an explicit restoration (e.g. stale or unsynchronized live edit from peer)
    // Local deletion WINS! Monotonically advance version if remote had higher revision to guarantee convergence
    const winnerVersion = remote.version > local.version
      ? remote.version + 1
      : local.version;
    const resolvedEntity: KernelEntity = winnerVersion !== local.version
      ? { ...local, version: winnerVersion }
      : local;

    return {
      resolvedEntity,
      action: 'keep_local',
    };
  }



  // 4. No pending local mutation
  if (!pendingMutation) {
    if (remote.version > local.version) {
      return {
        resolvedEntity: remote,
        action: 'accept_remote',
      };
    }

    if (local.version > remote.version) {
      return {
        resolvedEntity: local,
        action: 'keep_local',
      };
    }

    // Equal revisions: compare updated_at
    const localUpdated = parseTimestampMs(local.lifecycle.updated_at);
    const remoteUpdated = parseTimestampMs(remote.lifecycle.updated_at);

    if (remoteUpdated > localUpdated) {
      return {
        resolvedEntity: remote,
        action: 'accept_remote',
      };
    }

    if (localUpdated > remoteUpdated) {
      return {
        resolvedEntity: local,
        action: 'keep_local',
      };
    }

    // Strictly equal revisions and updated_at: deterministic commutative tie-breaker
    const jsonLocal = canonicalJson(local);
    const jsonRemote = canonicalJson(remote);
    if (jsonRemote > jsonLocal) {
      return {
        resolvedEntity: remote,
        action: 'accept_remote',
      };
    }

    return {
      resolvedEntity: local,
      action: 'keep_local',
    };
  }

  // 5. Concurrent edit detection with pending local mutation
  const baseRevision = pendingMutation.base_revision;
  const baseline = pendingMutation.base_entity;

  // Revisions alone are not a sufficient base check: two devices can both
  // create revision N+1 from revision N. Compare the actual captured base.
  // Older queue records lack that snapshot, so use their enqueue timestamp as
  // a conservative compatibility check and surface a conflict if cloud data
  // is newer than the queued edit.
  const sameContent = (a: KernelEntity, b: KernelEntity): boolean =>
    a.id === b.id && a.schema_id === b.schema_id && a.version === b.version &&
    a.title === b.title && canonicalJson(a.attributes || {}) === canonicalJson(b.attributes || {}) &&
    a.lifecycle.status === b.lifecycle.status && a.lifecycle.deleted_at === b.lifecycle.deleted_at;

  const remoteMatchesBase = baseline
    ? sameContent(remote, baseline)
    : remote.version === baseRevision &&
      parseTimestampMs(remote.lifecycle.updated_at) <= parseTimestampMs(pendingMutation.created_at);

  if (remoteMatchesBase) {
    return {
      resolvedEntity: local,
      action: 'keep_local',
    };
  }

  // Three-way comparison: determine what each side changed since the captured
  // base, instead of treating every local/remote difference as a conflict.
  const conflictingFields: string[] = [];
  const baseTitle = baseline?.title;
  const baseAttrs = baseline?.attributes || {};
  const localAttrs = local.attributes || {};
  const remoteAttrs = remote.attributes || {};
  const localTitleChanged = baseline ? local.title !== baseTitle : local.title !== remote.title;
  const remoteTitleChanged = baseline ? remote.title !== baseTitle : remote.title !== local.title;
  if (localTitleChanged && remoteTitleChanged && local.title !== remote.title) conflictingFields.push('title');

  const allAttrKeys = new Set([...Object.keys(localAttrs), ...Object.keys(remoteAttrs)]);
  const localChangedKeys = new Set<string>();

  for (const key of allAttrKeys) {
    const localVal = localAttrs[key];
    const remoteVal = remoteAttrs[key];
    const baseVal = baseAttrs[key];
    const localChanged = baseline ? !areAttributeValuesEqual(localVal, baseVal) : !areAttributeValuesEqual(localVal, remoteVal);
    const remoteChanged = baseline ? !areAttributeValuesEqual(remoteVal, baseVal) : !areAttributeValuesEqual(remoteVal, localVal);
    if (localChanged) localChangedKeys.add(key);
    if (localChanged && remoteChanged && !areAttributeValuesEqual(localVal, remoteVal)) {
      conflictingFields.push(`attributes.${key}`);
    }
  }

  if (conflictingFields.length === 0) {
    const localTitleWins = localTitleChanged && (!remoteTitleChanged || local.title === remote.title);
    const localTitleNeedsApply = localTitleWins && local.title !== remote.title;
    const mergedAttributes: Record<string, AttributeValue> = { ...remoteAttrs };
    for (const key of localChangedKeys) {
      const localValue = localAttrs[key];
      if (localValue === undefined) delete mergedAttributes[key];
      else mergedAttributes[key] = localValue;
    }
    const hasLocalChangesToApply = localTitleNeedsApply || [...localChangedKeys].some(key => !areAttributeValuesEqual(localAttrs[key], remoteAttrs[key]));
    if (!hasLocalChangesToApply) {
      return { resolvedEntity: remote, action: 'accept_remote' };
    }

    const mergedEntity: KernelEntity = {
      ...remote,
      version: Math.max(local.version, remote.version) + 1,
      title: localTitleWins ? local.title : remote.title,
      attributes: mergedAttributes,
      lifecycle: {
        ...remote.lifecycle,
        updated_at: now,
      },
      provenance: {
        ...local.provenance,
        observed_at: now,
      },
    };

    return {
      resolvedEntity: mergedEntity,
      action: 'merged',
    };
  }

  // Overlapping field conflict detected!
  const conflict: ConflictDescriptor = {
    id: `conflict_${remote.id}_${Date.now()}`,
    entity_id: remote.id,
    conflict_type: 'concurrent_edit',
    local_revision: local.version,
    remote_revision: remote.version,
    conflicting_fields: conflictingFields,
    message: `Concurrent edits detected on entity "${remote.title}".`,
    resolution_options: ['keep_remote', 'keep_local', 'reapply_on_latest'],
    detected_at: now,
  };

  return {
    resolvedEntity: remote, // Remote serves as safe canonical baseline until resolved
    action: 'conflict_detected',
    conflict,
  };
}

/**
 * Reconciles an entire collection of remote entity documents against local canonical kernel entities.
 */
export function reconcileEntityCollection(
  localEntities: Record<string, KernelEntity>,
  remoteEntities: readonly unknown[],
  pendingQueue?: PendingMutationQueue,
  now = new Date().toISOString(),
  protectedEntityIds: ReadonlySet<string> = new Set()
): {
  nextKernelEntities: Record<string, KernelEntity>;
  conflicts: ConflictDescriptor[];
} {
  const nextKernelEntities: Record<string, KernelEntity> = { ...localEntities };
  const conflicts: ConflictDescriptor[] = [];

  for (const rawRemote of remoteEntities) {
    if (!rawRemote || typeof rawRemote !== 'object') continue;

    let remoteKernel: KernelEntity;
    const isAlreadyKernel =
      'schema_id' in rawRemote &&
      typeof (rawRemote as Record<string, unknown>).schema_id === 'string' &&
      'version' in rawRemote &&
      typeof (rawRemote as Record<string, unknown>).version === 'number' &&
      'attributes' in rawRemote &&
      typeof (rawRemote as Record<string, unknown>).attributes === 'object' &&
      (rawRemote as Record<string, unknown>).attributes !== null;

    if (isAlreadyKernel) {
      remoteKernel = rawRemote as unknown as KernelEntity;
    } else {
      remoteKernel = upgradeLegacyEntityToKernel(rawRemote as unknown as Record<string, unknown>);
    }

    const local = localEntities[remoteKernel.id] || null;
    const pendingMutation = pendingQueue ? pendingQueue.getByEntityId(remoteKernel.id) : undefined;

    const result = reconcileEntity(local, remoteKernel, pendingMutation, now);
    nextKernelEntities[remoteKernel.id] = result.resolvedEntity;

    const remoteAcknowledgesMutation = !!pendingMutation &&
      remoteKernel.version >= pendingMutation.entity.version &&
      remoteKernel.id === pendingMutation.entity.id &&
      remoteKernel.schema_id === pendingMutation.entity.schema_id &&
      remoteKernel.title === pendingMutation.entity.title &&
      canonicalJson(remoteKernel.attributes || {}) === canonicalJson(pendingMutation.entity.attributes || {}) &&
      remoteKernel.lifecycle.status === pendingMutation.entity.lifecycle.status &&
      remoteKernel.lifecycle.deleted_at === pendingMutation.entity.lifecycle.deleted_at;

    if (pendingQueue && pendingMutation && !protectedEntityIds.has(remoteKernel.id) && !result.conflict &&
        result.action === 'accept_remote' && remoteAcknowledgesMutation) {
      pendingQueue.markCommitted(pendingMutation.mutation_id);
    }

    if (result.conflict) {
      conflicts.push(result.conflict);
    }
  }

  return { nextKernelEntities, conflicts };
}

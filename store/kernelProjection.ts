/**
 * Flowmate Greenfield Domain Kernel — Kernel to Legacy Projection Engine
 *
 * Implements the read-only compatibility projection from canonical Kernel Entity
 * representation to legacy Entity shapes required by unmigrated UI views.
 *
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - Deeply frozen output (Object.freeze) to enforce read-only invariant at runtime
 * - Lossless provenance preservation in metadata._provenance
 * - Pure functions with zero side effects
 */

import { Entity as KernelEntity, AttributeValue } from '../services/kernel';
import {
  Entity as LegacyEntity,
  EntityKind,
  EntityStatus,
  RecurrenceType,
  Subtask,
  SchedulingCertainty,
} from '../types';

function mapSchemaIdToLegacyKind(schemaId: string, attributes: Record<string, unknown>): EntityKind {
  if (typeof attributes.kind === 'string' && Object.values(EntityKind).includes(attributes.kind as EntityKind)) {
    return attributes.kind as EntityKind;
  }

  if (schemaId === 'system/goal') return EntityKind.GOAL;
  if (schemaId === 'system/habit') return EntityKind.HABIT;
  if (schemaId === 'system/event') return EntityKind.EVENT;
  if (schemaId === 'system/note') return EntityKind.NOTE;
  if (schemaId === 'system/person') return EntityKind.PERSON;

  if (schemaId === 'system/meal_log' || schemaId === 'system/attendance_record') {
    return EntityKind.ACTIVITY;
  }

  // Under system/task, inspect attributes to preserve legacy sub-kinds if present
  if (schemaId === 'system/task') {
    if (attributes.is_goal === true || typeof attributes.target_count === 'number') {
      return EntityKind.GOAL;
    }
    if (attributes.cadence_rrule || attributes.streak_current !== undefined) {
      return EntityKind.HABIT;
    }
    if (Array.isArray(attributes.subtasks) && attributes.subtasks.length > 2) {
      return EntityKind.PROJECT;
    }
    return EntityKind.TASK;
  }

  return EntityKind.TASK;
}

function normalizeToLegacyStatus(status?: string): EntityStatus {
  if (!status) return EntityStatus.ACTIVE;
  const s = status.toUpperCase();
  switch (s) {
    case 'ACTIVE':
      return EntityStatus.ACTIVE;
    case 'IN_PROGRESS':
      return EntityStatus.IN_PROGRESS;
    case 'COMPLETED':
    case 'DONE':
      return EntityStatus.COMPLETED;
    case 'CANCELED':
    case 'CANCELLED':
      return EntityStatus.CANCELED;
    case 'ARCHIVED':
      return EntityStatus.ARCHIVED;
    case 'PENDING':
    default:
      return EntityStatus.PENDING;
  }
}

/**
 * Projects a single canonical KernelEntity into a frozen read-only LegacyEntity.
 */
export function projectKernelToLegacyEntity(
  kernel: KernelEntity
): Readonly<LegacyEntity> {
  const attrs = kernel.attributes || (kernel as unknown as { data?: Record<string, unknown> }).data || {};
  const kind = mapSchemaIdToLegacyKind(kernel.schema_id, attrs);
  const status = normalizeToLegacyStatus(kernel.lifecycle?.status || (kernel as unknown as { status?: string }).status);

  const priority = typeof attrs.priority === 'number' ? attrs.priority : 3;
  const deadline = typeof attrs.deadline === 'string' ? attrs.deadline : null;
  const startTime =
    typeof attrs.start_time === 'string'
      ? attrs.start_time
      : (kernel.validity?.valid_from || null);
  const endTime =
    typeof attrs.end_time === 'string'
      ? attrs.end_time
      : (kernel.validity?.valid_until || null);
  const duration = typeof attrs.duration_minutes === 'number' ? attrs.duration_minutes : null;
  const recurrence: RecurrenceType =
    typeof attrs.cadence_rrule === 'string'
      ? (attrs.cadence_rrule as RecurrenceType)
      : null;

  const description =
    typeof attrs.notes === 'string'
      ? attrs.notes
      : (typeof attrs.content === 'string' ? attrs.content : null);

  const canonicalTags: string[] = Array.isArray(attrs.tags)
    ? attrs.tags.filter((t): t is string => typeof t === 'string')
    : [];

  const parentId = typeof attrs.parent_id === 'string' ? attrs.parent_id : null;

  const isDeleted = kernel.lifecycle.status === 'deleted' || kernel.lifecycle.deleted_at !== null;
  // Build metadata preserving all attributes + lossless provenance
  const metadata: Record<string, unknown> = {
    ...attrs,
    _schema_id: kernel.schema_id,
    _version: kernel.version,
    _provenance: kernel.provenance,
    archived: kernel.lifecycle.status === 'archived',
    deleted: isDeleted,
  };

  if (kernel.lifecycle.deleted_at) {
    metadata.deleted_at = kernel.lifecycle.deleted_at;
  }

  const projectedSubtasks: Subtask[] | undefined = Array.isArray(attrs.subtasks)
    ? (attrs.subtasks as unknown as Subtask[])
    : undefined;

  if (projectedSubtasks) {
    metadata.subtasks = projectedSubtasks;
  }

  const rawCert = typeof attrs.scheduling_certainty === 'string'
    ? attrs.scheduling_certainty
    : (attrs.metadata && typeof (attrs.metadata as Record<string, unknown>).scheduling_certainty === 'string'
      ? (attrs.metadata as Record<string, unknown>).scheduling_certainty
      : undefined);

  const schedulingCertainty = (rawCert === 'confirmed' || rawCert === 'tentative' || rawCert === 'cancelled' || rawCert === 'unknown')
    ? (rawCert as SchedulingCertainty)
    : undefined;

  if (schedulingCertainty) {
    metadata.scheduling_certainty = schedulingCertainty;
  }

  const legacy: LegacyEntity = {
    id: kernel.id,
    kind,
    title: kernel.title,
    description,
    status,
    priority,
    start_time: startTime,
    end_time: endTime,
    deadline,
    duration_minutes: duration,
    recurrence,
    subtasks: projectedSubtasks,
    scheduling_certainty: schedulingCertainty,
    metadata,
    created_at: kernel.lifecycle.created_at,
    updated_at: kernel.lifecycle.updated_at,
    canonical_tags: canonicalTags,
    parent_id: parentId,
  };

  return Object.freeze(legacy);
}

/**
 * Projects a canonical KernelEntity record dictionary into a frozen array of LegacyEntities.
 * Preserves soft-deleted tombstones (metadata.deleted = true) for sync and offline tombstone tracking.
 */
export function projectKernelEntitiesToLegacy(
  kernelEntities: Record<string, KernelEntity>
): LegacyEntity[] {
  const legacyList = Object.values(kernelEntities)
    .map(projectKernelToLegacyEntity);

  return Object.freeze(legacyList) as unknown as LegacyEntity[];
}

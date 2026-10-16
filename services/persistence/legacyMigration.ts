/**
 * Flowmate Greenfield Domain Kernel — Explicit Legacy Migration Engine
 *
 * Transforms legacy Firestore shapes into validated Kernel Entities.
 *
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - No silent auto-migration in persistence adapters: this engine is called explicitly.
 * - Non-destructive: corrupt or unrecognized records are quarantined into `system/unstructured_item`, never dropped.
 * - Lossless: legacy metadata and tags are preserved in typed `attributes`.
 */

import {
  Entity,
  EntityLifecycle,
  Provenance,
  AttributeValue,
} from '../kernel/types';

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Checks if a Firestore document is in the legacy format (lacks schema_version >= 5 or schema_id).
 */
export function isLegacyEntityDocument(doc: Record<string, unknown>): boolean {
  const version = typeof doc.schema_version === 'number' ? doc.schema_version : 0;
  return version < 5 || typeof doc.schema_id !== 'string';
}

/**
 * Maps legacy EntityKind to canonical baseline schema id.
 */
export function mapLegacyKindToSchemaId(kind: unknown): string {
  if (typeof kind !== 'string') return 'system/unstructured_item';

  switch (kind.toUpperCase()) {
    case 'GOAL':
      return 'system/goal';

    case 'HABIT':
    case 'MINI_STREAK':
      return 'system/habit';

    case 'TASK':
    case 'PROJECT':
    case 'ACTIVITY':
    case 'PROMISE':
    case 'OPPORTUNITY':
      return 'system/task';

    case 'EVENT':
      return 'system/event';

    case 'NOTE':
    case 'TAG':
    case 'CONTEXT':
      return 'system/note';

    case 'PERSON':
      return 'system/person';

    case 'MEMORY':
    case 'MEMORY_ITEM':
      return 'system/memory_item';

    case 'SITUATIONAL':
    case 'SITUATIONAL_STATE':
      return 'system/situational_state';

    default:
      return 'system/unstructured_item';
  }
}

/**
 * Normalizes legacy entity status to a lowercase lifecycle status string.
 */
function normalizeStatus(status: unknown): string {
  if (typeof status !== 'string') return 'active';
  const s = status.toLowerCase();
  if (s === 'in_progress' || s === 'completed' || s === 'archived' || s === 'canceled' || s === 'pending') {
    return s;
  }
  return 'active';
}

/**
 * Converts a legacy Entity document into a validated Kernel Entity.
 */
export function upgradeLegacyEntityToKernel(doc: Record<string, unknown>): Entity {
  const now = new Date().toISOString();
  const id = typeof doc.id === 'string' && doc.id.trim() ? doc.id : `legacy_${Date.now()}`;
  const title = typeof doc.title === 'string' ? doc.title : 'Untitled Item';
  const schemaId = (typeof doc.schema_id === 'string' && doc.schema_id.trim())
    ? doc.schema_id.trim()
    : mapLegacyKindToSchemaId(doc.kind);

  // If the record is missing vital fields or schema is unstructured, quarantine
  if (schemaId === 'system/unstructured_item') {
    return quarantineCorruptDocument(doc, `Unrecognized legacy kind: "${String(doc.kind)}"`);
  }

  const attributes: Record<string, AttributeValue> = {};

  // Copy explicit attributes if document is already schema-aware
  if (isRecord(doc.attributes)) {
    for (const [key, val] of Object.entries(doc.attributes)) {
      if (val !== undefined && val !== null) {
        attributes[key] = val as AttributeValue;
      }
    }
  }

  // Map primitive attributes
  if (typeof doc.kind === 'string') attributes.kind = doc.kind;
  if (typeof doc.parent_id === 'string') attributes.parent_id = doc.parent_id;
  if (typeof doc.priority === 'number') attributes.priority = doc.priority;
  if (typeof doc.deadline === 'string') attributes.deadline = doc.deadline;
  if (typeof doc.start_time === 'string') attributes.start_time = doc.start_time;
  if (typeof doc.end_time === 'string') attributes.end_time = doc.end_time;
  if (typeof doc.duration_minutes === 'number') attributes.duration_minutes = doc.duration_minutes;
  if (typeof doc.recurrence === 'string') attributes.cadence_rrule = doc.recurrence;
  if (typeof doc.description === 'string' && doc.description) attributes.notes = doc.description;
  if (typeof doc.content === 'string') attributes.content = doc.content;
  if (typeof doc.category === 'string') attributes.category = doc.category;
  if (typeof doc.privacy_tier === 'string') attributes.privacy_tier = doc.privacy_tier;
  if (typeof doc.topic === 'string') attributes.topic = doc.topic;
  if (typeof doc.details === 'string') attributes.details = doc.details;
  if (typeof doc.valid_from === 'string') attributes.valid_from = doc.valid_from;
  if (typeof doc.valid_until === 'string') attributes.valid_until = doc.valid_until;
  if (typeof doc.scheduling_certainty === 'string') {
    attributes.scheduling_certainty = doc.scheduling_certainty;
  } else if (isRecord(doc.metadata) && typeof doc.metadata.scheduling_certainty === 'string') {
    attributes.scheduling_certainty = doc.metadata.scheduling_certainty;
  }

  // Map tags
  if (Array.isArray(doc.canonical_tags)) {
    attributes.tags = doc.canonical_tags.filter((t): t is string => typeof t === 'string');
  } else if (Array.isArray(doc.tags)) {
    attributes.tags = doc.tags.filter((t): t is string => typeof t === 'string');
  }

  // Map productivity if present directly on doc
  if (typeof doc.productivity === 'string') {
    attributes.productivity = doc.productivity.toUpperCase();
  }

  // Map subtasks (from top-level doc.subtasks or doc.metadata.subtasks)
  const rawSubtasks = Array.isArray(doc.subtasks)
    ? doc.subtasks
    : (isRecord(doc.metadata) && Array.isArray(doc.metadata.subtasks) ? doc.metadata.subtasks : null);

  if (rawSubtasks) {
    const parsedSubtasks: Record<string, AttributeValue>[] = [];
    for (const item of rawSubtasks) {
      if (isRecord(item)) {
        parsedSubtasks.push({
          id: typeof item.id === 'string' && item.id.trim() ? item.id : `st_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          title: typeof item.title === 'string' ? item.title : '',
          completed: Boolean(item.completed),
        });
      }
    }
    attributes.subtasks = parsedSubtasks;
  }

  // Flatten and normalize metadata (excluding lifecycle, subtasks, and provenance envelope fields)
  if (isRecord(doc.metadata)) {
    for (const [key, val] of Object.entries(doc.metadata)) {
      if (
        key === '_provenance' ||
        key === '_schema_id' ||
        key === '_version' ||
        key === 'is_inferred' ||
        key === 'confidence' ||
        key === 'source_type' ||
        key === 'user_confirmed' ||
        key === 'deleted' ||
        key === 'deleted_at' ||
        key === 'archived' ||
        key === 'subtasks' ||
        key === '_legacy' ||
        key === 'source_insight_id' ||
        key === 'roi_score' ||
        key === 'derived_from' ||
        key === 'generated_at'
      ) {
        continue;
      }
      if (val !== undefined && val !== null) {
        if (
          typeof val === 'string' ||
          typeof val === 'number' ||
          typeof val === 'boolean' ||
          Array.isArray(val) ||
          isRecord(val)
        ) {
          attributes[key] = val as AttributeValue;
        }
      }
    }
  }

  // Handle specific schemas
  if (schemaId === 'system/event') {
    // Events require start_time and end_time
    if (!attributes.start_time) attributes.start_time = now;
    if (!attributes.end_time) {
      if (typeof attributes.duration_minutes === 'number' && attributes.duration_minutes > 0) {
        const startMs = new Date(attributes.start_time as string).getTime();
        if (!isNaN(startMs)) {
          const startTimeStr = attributes.start_time as string;
          const offsetMatch = startTimeStr.match(/([+-]\d{2}:\d{2})$/);
          const offset = offsetMatch ? offsetMatch[1] : (startTimeStr.endsWith('Z') ? 'Z' : '+05:30');
          if (offset === 'Z') {
            attributes.end_time = new Date(startMs + attributes.duration_minutes * 60000).toISOString();
          } else {
            const match = offset.match(/([+-])(\d{2}):(\d{2})/);
            const sign = match && match[1] === '+' ? 1 : -1;
            const hours = match ? parseInt(match[2], 10) : 5;
            const mins = match ? parseInt(match[3], 10) : 30;
            const totalOffsetMs = sign * (hours * 60 + mins) * 60000;
            const targetMs = startMs + attributes.duration_minutes * 60000;
            const localDate = new Date(targetMs + totalOffsetMs);
            const y = localDate.getUTCFullYear();
            const mo = String(localDate.getUTCMonth() + 1).padStart(2, '0');
            const d = String(localDate.getUTCDate()).padStart(2, '0');
            const hh = String(localDate.getUTCHours()).padStart(2, '0');
            const mm = String(localDate.getUTCMinutes()).padStart(2, '0');
            const ss = String(localDate.getUTCSeconds()).padStart(2, '0');
            attributes.end_time = `${y}-${mo}-${d}T${hh}:${mm}:${ss}${offset}`;
          }
        } else {
          attributes.end_time = attributes.start_time;
        }
      } else {
        attributes.end_time = attributes.start_time;
      }
    }
    if (attributes.location) {
      if (
        isRecord(attributes.location) &&
        typeof (attributes.location as Record<string, unknown>).lat === 'number' &&
        typeof (attributes.location as Record<string, unknown>).lng === 'number'
      ) {
        // Keep valid geopoint
      } else {
        if (typeof attributes.location === 'string') {
          const locStr = (attributes.location as string).trim();
          if (locStr) {
            attributes.notes = attributes.notes ? `${attributes.notes} (Location: ${locStr})` : `Location: ${locStr}`;
          }
        }
        delete attributes.location;
      }
    }
  }

  if (schemaId === 'system/note') {
    attributes.content = typeof doc.description === 'string'
      ? doc.description
      : (typeof attributes.content === 'string' ? attributes.content : title);
  }

  if (schemaId === 'system/person') {
    if (!attributes.category) {
      attributes.category = 'peer';
    }
  }

  const createdAt = typeof doc.created_at === 'string' ? doc.created_at : now;
  const updatedAt = typeof doc.updated_at === 'string' ? doc.updated_at : now;
  const deletedAt = typeof doc.deleted_at === 'string' ? doc.deleted_at : null;

  const lifecycle: EntityLifecycle = {
    status: normalizeStatus(doc.status),
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: deletedAt,
  };

  let provenance: Provenance = {
    source_type: 'user',
    observed_at: createdAt,
    confidence: 1.0,
    is_inferred: false,
    user_confirmed: true,
  };

  const rawProv = (isRecord(doc.provenance) ? doc.provenance : undefined)
    || (isRecord(doc.metadata) && isRecord(doc.metadata._provenance) ? doc.metadata._provenance : undefined)
    || (isRecord(doc.metadata) && (doc.metadata.is_inferred !== undefined || doc.metadata.confidence !== undefined) ? doc.metadata : undefined);

  if (rawProv) {
    const rawSourceType = typeof rawProv.source_type === 'string' ? rawProv.source_type : 'user';
    const sourceType = (rawSourceType === 'agent' || rawSourceType === 'ai_agent')
      ? 'agent'
      : (rawSourceType === 'external_integration' || rawSourceType === 'device_sensor' || rawSourceType === 'file_import')
        ? rawSourceType
        : 'user';

    const confidence = typeof rawProv.confidence === 'number' && Number.isFinite(rawProv.confidence)
      ? Math.max(0, Math.min(1, rawProv.confidence))
      : 1.0;
    const observedAt = typeof rawProv.observed_at === 'string' ? rawProv.observed_at : createdAt;
    const isInferred = Boolean(rawProv.is_inferred);
    const userConfirmed = typeof rawProv.user_confirmed === 'boolean' ? rawProv.user_confirmed : !isInferred;
    const sourceId = typeof rawProv.source_id === 'string' ? rawProv.source_id : undefined;

    provenance = {
      source_type: sourceType,
      observed_at: observedAt,
      confidence,
      is_inferred: isInferred,
      user_confirmed: userConfirmed,
      source_id: sourceId,
    };
  }

  const entity: Entity = {
    id,
    schema_id: schemaId,
    version: 1,
    title,
    attributes,
    lifecycle,
    provenance,
  };

  if (attributes.start_time || attributes.end_time) {
    entity.validity = {
      valid_from: typeof attributes.start_time === 'string' ? attributes.start_time : undefined,
      valid_until: typeof attributes.end_time === 'string' ? attributes.end_time : undefined,
    };
  }

  return entity;
}

/**
 * Converts a legacy FoodLogEntry into a system/meal_log Kernel Entity.
 */
export function upgradeLegacyMealLogToKernel(entry: Record<string, unknown>): Entity {
  const now = new Date().toISOString();
  const id = typeof entry.id === 'string' ? entry.id : `meal_${Date.now()}`;
  const title = typeof entry.food_name === 'string' ? entry.food_name : 'Meal';
  const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : now;

  const attributes: Record<string, AttributeValue> = {};
  if (typeof entry.meal_type === 'string') attributes.meal_type = entry.meal_type;
  if (typeof entry.calories === 'number') attributes.calories = entry.calories;
  if (typeof entry.protein_g === 'number') attributes.protein_g = entry.protein_g;
  if (typeof entry.carbs_g === 'number') attributes.carbs_g = entry.carbs_g;
  if (typeof entry.fat_g === 'number') attributes.fat_g = entry.fat_g;
  if (typeof entry.cost === 'number') {
    attributes.cost = { amount: entry.cost, currency: 'INR' };
  }
  if (typeof entry.source === 'string') attributes.source = entry.source;
  if (typeof entry.vendor === 'string') attributes.vendor = entry.vendor;
  if (typeof entry.rating === 'number') attributes.rating = entry.rating;

  return {
    id,
    schema_id: 'system/meal_log',
    version: 1,
    title,
    attributes,
    lifecycle: {
      status: 'active',
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    },
    provenance: {
      source_type: 'user',
      observed_at: timestamp,
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
  };
}

/**
 * Converts a legacy AttendanceLog into a system/attendance_record Kernel Entity.
 */
export function upgradeLegacyAttendanceLogToKernel(
  log: Record<string, unknown>,
  subjectNamesById?: Record<string, string>
): Entity {
  const now = new Date().toISOString();
  const id = typeof log.id === 'string' ? log.id : `att_${Date.now()}`;
  const subjectId = typeof log.subject_id === 'string' ? log.subject_id : 'unknown';
  const subjectName = subjectNamesById?.[subjectId] || subjectId;
  const date = typeof log.date === 'string' ? log.date : now.substring(0, 10);
  const status = typeof log.status === 'string' ? log.status : 'present';

  return {
    id,
    schema_id: 'system/attendance_record',
    version: 1,
    title: `${subjectName} (${date})`,
    attributes: {
      subject_id: subjectId,
      subject_name: subjectName,
      date,
      status,
    },
    lifecycle: {
      status: 'active',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    provenance: {
      source_type: 'user',
      observed_at: now,
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
  };
}

/**
 * Safely wraps malformed, unrecognized, or corrupted records in system/unstructured_item.
 */
export function quarantineCorruptDocument(rawDoc: Record<string, unknown>, reason: string): Entity {
  const now = new Date().toISOString();
  const id = typeof rawDoc.id === 'string' ? rawDoc.id : `corrupt_${Date.now()}`;

  return {
    id,
    schema_id: 'system/unstructured_item',
    version: 1,
    title: `Quarantined Document (${id})`,
    attributes: {
      raw_payload: rawDoc as unknown as Record<string, AttributeValue>,
      quarantine_reason: reason,
    },
    lifecycle: {
      status: 'quarantined',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    provenance: {
      source_type: 'user',
      observed_at: now,
      confidence: 0.5,
      is_inferred: true,
      user_confirmed: false,
    },
  };
}

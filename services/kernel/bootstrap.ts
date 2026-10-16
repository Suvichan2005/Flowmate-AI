/**
 * Flowmate Greenfield Domain Kernel — Bootstrap Engine
 *
 * Registers baseline system schemas and capabilities into registries.
 *
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - Pure domain kernel (NO Firebase or UI imports)
 * - Extensible: Baseline schemas are bootstrap seeds, NOT a hardcoded ontology enum
 */

import { SchemaDefinition } from './types';
import { SchemaRegistry } from './schemaRegistry';
import {
  CapabilityRegistry,
  CapabilityDefinition,
  LOCATIONAL_CAPABILITY,
  METRIC_CAPABILITY,
} from './capabilityRegistry';
import { RecurrenceRule, parseRecurrenceRule } from './recurrence';
import {
  CommitmentTarget,
  EvidenceItem,
  parseCommitmentTarget,
  parseEvidenceItems,
} from './commitment';
import { ReminderPolicy, parseReminderPolicy } from './reminders';

// ============================================================================
// 1. BASELINE SYSTEM SCHEMAS
// ============================================================================

export const SYSTEM_TASK_SCHEMA: SchemaDefinition = {
  id: 'system/task',
  version: 1,
  displayName: 'Task',
  description: 'An actionable item with priority, status, and optional deadline',
  scope: 'system',
  capabilities: ['schedulable', 'trackable_progress', 'evaluable_state', 'recurrent', 'commitment', 'evidence', 'notifiable'],
  attributes: {
    priority: {
      name: 'priority',
      type: 'number',
      label: 'Priority',
      description: 'Numerical priority (1 = highest, 5 = lowest)',
      required: false,
      default_value: 3,
      constraints: { min: 1, max: 5 },
    },
    deadline: {
      name: 'deadline',
      type: 'datetime',
      label: 'Deadline',
      description: 'ISO 8601 deadline timestamp',
      required: false,
    },
    duration_minutes: {
      name: 'duration_minutes',
      type: 'duration_minutes',
      label: 'Estimated Duration',
      description: 'Estimated effort in minutes',
      required: false,
      constraints: { min: 0 },
    },
    subtasks: {
      name: 'subtasks',
      type: 'array',
      label: 'Subtasks',
      description: 'List of checklist subtask items',
      required: false,
      item_type: 'object',
    },
    tags: {
      name: 'tags',
      type: 'array',
      label: 'Tags',
      description: 'Descriptive classification tags',
      required: false,
      item_type: 'string',
    },
    notes: {
      name: 'notes',
      type: 'string',
      label: 'Notes',
      description: 'Additional task notes or context',
      required: false,
    },
    parent_id: {
      name: 'parent_id',
      type: 'string',
      label: 'Parent Entity ID',
      description: 'Hierarchy reference to parent goal or project',
      required: false,
    },
    kind: {
      name: 'kind',
      type: 'string',
      label: 'Legacy Kind',
      description: 'Compatibility marker for legacy entity kind',
      required: false,
    },
    recurrence: {
      name: 'recurrence',
      type: 'object',
      label: 'Recurrence Rule',
      description: 'Cadence and recurrence rule configuration',
      required: false,
    },
    commitment: {
      name: 'commitment',
      type: 'object',
      label: 'Commitment Definition',
      description: 'Periodic target and cadence specification',
      required: false,
    },
    evidence: {
      name: 'evidence',
      type: 'array',
      label: 'Evidence Collection',
      description: 'Timestamped evidence items with provenance',
      required: false,
      item_type: 'object',
    },
    reminder_policy: {
      name: 'reminder_policy',
      type: 'object',
      label: 'Reminder Policy',
      description: 'Notification trigger and timing configuration',
      required: false,
    },
    productivity: {
      name: 'productivity',
      type: 'enum',
      label: 'Productivity Classification',
      description: 'Productivity categorization of this task',
      required: false,
      enum_options: ['PRODUCTIVE', 'NEUTRAL', 'UNPRODUCTIVE', 'SLEEP'],
    },
    color_hex: {
      name: 'color_hex',
      type: 'string',
      label: 'Color Code',
      description: 'Hex color representation',
      required: false,
    },
    cadence_rrule: {
      name: 'cadence_rrule',
      type: 'string',
      label: 'Cadence / Recurrence Rule',
      description: 'RFC 5545 recurrence rule or cadence specification',
      required: false,
    },
    scheduling_certainty: {
      name: 'scheduling_certainty',
      type: 'enum',
      label: 'Scheduling Certainty',
      description: 'Authoritative scheduling confirmation status (confirmed, tentative, cancelled, unknown)',
      required: false,
      enum_options: ['confirmed', 'tentative', 'cancelled', 'unknown'],
      default_value: 'unknown',
    },
  },
  privacy_tier: 'private',
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
};

export const SYSTEM_EVENT_SCHEMA: SchemaDefinition = {
  id: 'system/event',
  version: 1,
  displayName: 'Calendar Event',
  description: 'A time-bounded event or appointment',
  scope: 'system',
  capabilities: ['schedulable', 'locational'],
  attributes: {
    start_time: {
      name: 'start_time',
      type: 'datetime',
      label: 'Start Time',
      description: 'ISO 8601 start time',
      required: true,
    },
    end_time: {
      name: 'end_time',
      type: 'datetime',
      label: 'End Time',
      description: 'ISO 8601 end time',
      required: true,
    },
    all_day: {
      name: 'all_day',
      type: 'boolean',
      label: 'All Day',
      description: 'Whether the event spans the entire day',
      required: false,
      default_value: false,
    },
    location: {
      name: 'location',
      type: 'geopoint',
      label: 'Location',
      description: 'Geographic coordinates and venue address',
      required: false,
    },
    meeting_link: {
      name: 'meeting_link',
      type: 'string',
      label: 'Meeting Link',
      description: 'Virtual meeting URL (e.g. Google Meet, Zoom)',
      required: false,
    },
    tags: {
      name: 'tags',
      type: 'array',
      label: 'Tags',
      description: 'Event categorization tags',
      required: false,
      item_type: 'string',
    },
    duration_minutes: {
      name: 'duration_minutes',
      type: 'duration_minutes',
      label: 'Duration Minutes',
      description: 'Duration of the event in minutes',
      required: false,
      constraints: { min: 0 },
    },
    notes: {
      name: 'notes',
      type: 'string',
      label: 'Notes',
      description: 'Additional event notes or details',
      required: false,
    },
    priority: {
      name: 'priority',
      type: 'number',
      label: 'Priority',
      description: 'Event priority',
      required: false,
      default_value: 3,
      constraints: { min: 1, max: 5 },
    },
    productivity: {
      name: 'productivity',
      type: 'enum',
      label: 'Productivity Classification',
      description: 'Productive hours tracking category',
      required: false,
      enum_options: ['PRODUCTIVE', 'NEUTRAL', 'UNPRODUCTIVE', 'SLEEP'],
    },
    recurrence: {
      name: 'recurrence',
      type: 'object',
      label: 'Recurrence Rule',
      description: 'Cadence and recurrence rule configuration',
      required: false,
    },
    cadence_rrule: {
      name: 'cadence_rrule',
      type: 'string',
      label: 'Cadence RRULE',
      description: 'RRULE string for recurring events',
      required: false,
    },
    color_hex: {
      name: 'color_hex',
      type: 'string',
      label: 'Color Hex',
      description: 'Custom UI color indicator',
      required: false,
    },
    parent_id: {
      name: 'parent_id',
      type: 'string',
      label: 'Parent Entity ID',
      description: 'Hierarchy reference to parent entity',
      required: false,
    },
    kind: {
      name: 'kind',
      type: 'string',
      label: 'Legacy Kind',
      description: 'Compatibility marker for legacy entity kind',
      required: false,
    },
    scheduling_certainty: {
      name: 'scheduling_certainty',
      type: 'enum',
      label: 'Scheduling Certainty',
      description: 'Authoritative scheduling confirmation status (confirmed, tentative, cancelled, unknown)',
      required: false,
      enum_options: ['confirmed', 'tentative', 'cancelled', 'unknown'],
      default_value: 'unknown',
    },
  },
  privacy_tier: 'private',
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
};

export const SYSTEM_NOTE_SCHEMA: SchemaDefinition = {
  id: 'system/note',
  version: 1,
  displayName: 'Note',
  description: 'Knowledge base note or reference entry',
  scope: 'system',
  capabilities: [],
  attributes: {
    content: {
      name: 'content',
      type: 'string',
      label: 'Content',
      description: 'Body of the note',
      required: false,
    },
    notes: {
      name: 'notes',
      type: 'string',
      label: 'Notes',
      description: 'Content or notes of the entry',
      required: false,
    },
    description: {
      name: 'description',
      type: 'string',
      label: 'Description',
      description: 'Summary or description of the note or context',
      required: false,
    },
    format: {
      name: 'format',
      type: 'enum',
      label: 'Format',
      description: 'Text encoding format',
      required: false,
      enum_options: ['markdown', 'plain'],
      default_value: 'markdown',
    },
    tags: {
      name: 'tags',
      type: 'array',
      label: 'Tags',
      description: 'Categorization tags',
      required: false,
      item_type: 'string',
    },
    parent_id: {
      name: 'parent_id',
      type: 'string',
      label: 'Parent Entity ID',
      description: 'Hierarchy reference to parent entity',
      required: false,
    },
    kind: {
      name: 'kind',
      type: 'string',
      label: 'Legacy Kind',
      description: 'Compatibility marker for legacy entity kind',
      required: false,
    },
    productivity: {
      name: 'productivity',
      type: 'enum',
      label: 'Productivity Classification',
      description: 'Productivity categorization of this entry',
      required: false,
      enum_options: ['PRODUCTIVE', 'NEUTRAL', 'UNPRODUCTIVE', 'SLEEP'],
    },
    color_hex: {
      name: 'color_hex',
      type: 'string',
      label: 'Color Code',
      description: 'Hex color representation',
      required: false,
    },
  },
  privacy_tier: 'private',
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
};

export const SYSTEM_PERSON_SCHEMA: SchemaDefinition = {
  id: 'system/person',
  version: 1,
  displayName: 'Person',
  description: 'Contact, mentor, peer, or colleague in Relationship Radar',
  scope: 'system',
  capabilities: [],
  attributes: {
    category: {
      name: 'category',
      type: 'enum',
      label: 'Category',
      description: 'Relationship category',
      required: true,
      enum_options: ['mentor', 'peer', 'professional', 'family', 'friend'],
    },
    organization: {
      name: 'organization',
      type: 'string',
      label: 'Organization',
      description: 'Company, university, or affiliation',
      required: false,
    },
    email: {
      name: 'email',
      type: 'string',
      label: 'Email',
      description: 'Contact email address',
      required: false,
    },
    phone: {
      name: 'phone',
      type: 'string',
      label: 'Phone',
      description: 'Contact phone number',
      required: false,
    },
    interaction_count: {
      name: 'interaction_count',
      type: 'number',
      label: 'Interaction Count',
      description: 'Cumulative number of recorded interactions',
      required: false,
      default_value: 0,
      constraints: { min: 0 },
    },
    last_interaction: {
      name: 'last_interaction',
      type: 'datetime',
      label: 'Last Interaction',
      description: 'ISO 8601 timestamp of last interaction',
      required: false,
    },
    parent_id: {
      name: 'parent_id',
      type: 'string',
      label: 'Parent Entity ID',
      description: 'Hierarchy reference to parent entity',
      required: false,
    },
    kind: {
      name: 'kind',
      type: 'string',
      label: 'Legacy Kind',
      description: 'Compatibility marker for legacy entity kind',
      required: false,
    },
  },
  privacy_tier: 'private',
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
};

export const SYSTEM_MEAL_LOG_SCHEMA: SchemaDefinition = {
  id: 'system/meal_log',
  version: 1,
  displayName: 'Meal Log',
  description: 'Nutritional and dining log entry (migrated from food silo)',
  scope: 'system',
  capabilities: [],
  attributes: {
    meal_type: {
      name: 'meal_type',
      type: 'enum',
      label: 'Meal Type',
      description: 'Time or type of meal',
      required: false,
      enum_options: ['breakfast', 'lunch', 'dinner', 'snack'],
    },
    calories: {
      name: 'calories',
      type: 'number',
      label: 'Calories',
      description: 'Energy in kilocalories',
      required: false,
      constraints: { min: 0 },
    },
    protein_g: {
      name: 'protein_g',
      type: 'number',
      label: 'Protein (g)',
      description: 'Protein content in grams',
      required: false,
      constraints: { min: 0 },
    },
    carbs_g: {
      name: 'carbs_g',
      type: 'number',
      label: 'Carbohydrates (g)',
      description: 'Carbohydrate content in grams',
      required: false,
      constraints: { min: 0 },
    },
    fat_g: {
      name: 'fat_g',
      type: 'number',
      label: 'Fat (g)',
      description: 'Fat content in grams',
      required: false,
      constraints: { min: 0 },
    },
    cost: {
      name: 'cost',
      type: 'money',
      label: 'Cost',
      description: 'Cost of the meal with currency',
      required: false,
    },
    source: {
      name: 'source',
      type: 'enum',
      label: 'Food Source',
      description: 'Origin of meal',
      required: false,
      enum_options: ['mess', 'ordered', 'homemade', 'outside'],
    },
    vendor: {
      name: 'vendor',
      type: 'string',
      label: 'Vendor',
      description: 'Restaurant, mess name, or food outlet',
      required: false,
    },
    rating: {
      name: 'rating',
      type: 'number',
      label: 'Rating',
      description: 'Rating from 1 to 5 stars',
      required: false,
      constraints: { min: 1, max: 5 },
    },
  },
  privacy_tier: 'private',
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
};

export const SYSTEM_ATTENDANCE_RECORD_SCHEMA: SchemaDefinition = {
  id: 'system/attendance_record',
  version: 1,
  displayName: 'Attendance Record',
  description: 'Academic class attendance record (migrated from attendance silo)',
  scope: 'system',
  capabilities: [],
  attributes: {
    subject_id: {
      name: 'subject_id',
      type: 'string',
      label: 'Subject ID',
      description: 'Identifier of academic subject or course',
      required: true,
    },
    subject_name: {
      name: 'subject_name',
      type: 'string',
      label: 'Subject Name',
      description: 'Name of academic subject or course',
      required: true,
    },
    date: {
      name: 'date',
      type: 'date',
      label: 'Date',
      description: 'Date of the class session (YYYY-MM-DD)',
      required: true,
    },
    status: {
      name: 'status',
      type: 'enum',
      label: 'Status',
      description: 'Attendance mark for the session',
      required: true,
      enum_options: ['present', 'absent', 'cancelled'],
    },
  },
  privacy_tier: 'private',
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
};

export const SYSTEM_UNSTRUCTURED_ITEM_SCHEMA: SchemaDefinition = {
  id: 'system/unstructured_item',
  version: 1,
  displayName: 'Unstructured / Quarantined Item',
  description: 'Resilient fallback container for corrupt, unrecognized, or raw legacy records',
  scope: 'system',
  capabilities: [],
  attributes: {
    raw_payload: {
      name: 'raw_payload',
      type: 'object',
      label: 'Raw Payload',
      description: 'Preserved unaltered source data',
      required: true,
    },
    quarantine_reason: {
      name: 'quarantine_reason',
      type: 'string',
      label: 'Quarantine Reason',
      description: 'Explanation for fallback quarantine classification',
      required: false,
    },
  },
  privacy_tier: 'private',
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
};

export const SYSTEM_GOAL_SCHEMA: SchemaDefinition = {
  id: 'system/goal',
  version: 1,
  displayName: 'Goal',
  description: 'A measurable objective or target with progress tracking',
  scope: 'system',
  capabilities: ['trackable_progress', 'schedulable', 'evaluable_state', 'recurrent', 'commitment', 'evidence', 'notifiable'],
  attributes: {
    priority: {
      name: 'priority',
      type: 'number',
      label: 'Priority',
      description: 'Numerical priority (1 = highest, 5 = lowest)',
      required: false,
      default_value: 3,
      constraints: { min: 1, max: 5 },
    },
    deadline: {
      name: 'deadline',
      type: 'datetime',
      label: 'Deadline',
      description: 'ISO 8601 deadline timestamp',
      required: false,
    },
    target_count: {
      name: 'target_count',
      type: 'number',
      label: 'Target Value',
      description: 'Target value for goal completion (e.g. 100)',
      required: false,
      default_value: 100,
    },
    current_count: {
      name: 'current_count',
      type: 'number',
      label: 'Current Progress Value',
      description: 'Current progress value achieved',
      required: false,
      default_value: 0,
    },
    progress: {
      name: 'progress',
      type: 'number',
      label: 'Progress Percentage',
      description: 'Completion percentage from 0 to 100',
      required: false,
      default_value: 0,
      constraints: { min: 0, max: 100 },
    },
    unit: {
      name: 'unit',
      type: 'string',
      label: 'Unit of Measure',
      description: 'Progress unit (e.g. %, hours, chapters)',
      required: false,
    },
    subtasks: {
      name: 'subtasks',
      type: 'array',
      label: 'Subtasks',
      description: 'List of checklist subtask milestones',
      required: false,
      item_type: 'object',
    },
    tags: {
      name: 'tags',
      type: 'array',
      label: 'Tags',
      description: 'Classification tags',
      required: false,
      item_type: 'string',
    },
    notes: {
      name: 'notes',
      type: 'string',
      label: 'Notes',
      description: 'Context notes and strategy',
      required: false,
    },
    parent_id: {
      name: 'parent_id',
      type: 'string',
      label: 'Parent Entity ID',
      description: 'Hierarchy reference to parent goal or vision',
      required: false,
    },
    kind: {
      name: 'kind',
      type: 'string',
      label: 'Legacy Kind',
      description: 'Compatibility marker for legacy entity kind',
      required: false,
      default_value: 'GOAL',
    },
    recurrence: {
      name: 'recurrence',
      type: 'object',
      label: 'Recurrence Rule',
      description: 'Cadence and recurrence rule configuration',
      required: false,
    },
    commitment: {
      name: 'commitment',
      type: 'object',
      label: 'Commitment Definition',
      description: 'Periodic target and cadence specification',
      required: false,
    },
    evidence: {
      name: 'evidence',
      type: 'array',
      label: 'Evidence Collection',
      description: 'Timestamped evidence items with provenance',
      required: false,
      item_type: 'object',
    },
    reminder_policy: {
      name: 'reminder_policy',
      type: 'object',
      label: 'Reminder Policy',
      description: 'Notification trigger and timing configuration',
      required: false,
    },
    productivity: {
      name: 'productivity',
      type: 'enum',
      label: 'Productivity Classification',
      description: 'Productivity categorization of this goal',
      required: false,
      enum_options: ['PRODUCTIVE', 'NEUTRAL', 'UNPRODUCTIVE', 'SLEEP'],
    },
    color_hex: {
      name: 'color_hex',
      type: 'string',
      label: 'Color Code',
      description: 'Hex color representation',
      required: false,
    },
  },
  privacy_tier: 'private',
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
};

export const SYSTEM_HABIT_SCHEMA: SchemaDefinition = {
  id: 'system/habit',
  version: 1,
  displayName: 'Habit',
  description: 'A recurring habit with cadence and streak tracking',
  scope: 'system',
  capabilities: ['recurrent', 'evaluable_state', 'trackable_progress', 'commitment', 'evidence', 'notifiable'],
  attributes: {
    habit_type: {
      name: 'habit_type',
      type: 'enum',
      label: 'Habit Type',
      description: 'Classification whether habit is positive or negative',
      required: false,
      default_value: 'GOOD',
      enum_options: ['GOOD', 'BAD'],
    },
    cadence_rrule: {
      name: 'cadence_rrule',
      type: 'string',
      label: 'Cadence / Recurrence Rule',
      description: 'RFC 5545 recurrence rule or frequency description',
      required: false,
    },
    streak_current: {
      name: 'streak_current',
      type: 'number',
      label: 'Current Streak',
      description: 'Consecutive days or periods active',
      required: false,
      default_value: 0,
      constraints: { min: 0 },
    },
    streak_best: {
      name: 'streak_best',
      type: 'number',
      label: 'Best Streak',
      description: 'Longest consecutive streak recorded',
      required: false,
      default_value: 0,
      constraints: { min: 0 },
    },
    frequency_goal: {
      name: 'frequency_goal',
      type: 'number',
      label: 'Frequency Goal',
      description: 'Target times per period',
      required: false,
      default_value: 1,
    },
    frequency_period: {
      name: 'frequency_period',
      type: 'enum',
      label: 'Frequency Period',
      description: 'Cadence period',
      required: false,
      default_value: 'DAY',
      enum_options: ['DAY', 'WEEK', 'MONTH'],
    },
    target_count: {
      name: 'target_count',
      type: 'number',
      label: 'Target Value',
      description: 'Daily target count or duration limit',
      required: false,
    },
    current_count: {
      name: 'current_count',
      type: 'number',
      label: 'Current Value',
      description: 'Current count completed today',
      required: false,
      default_value: 0,
    },
    time_spent_minutes: {
      name: 'time_spent_minutes',
      type: 'number',
      label: 'Time Spent (Minutes)',
      description: 'Minutes spent on bad or tracked habit',
      required: false,
      default_value: 0,
    },
    limit_minutes: {
      name: 'limit_minutes',
      type: 'number',
      label: 'Limit (Minutes)',
      description: 'Maximum threshold for bad habit',
      required: false,
    },
    tags: {
      name: 'tags',
      type: 'array',
      label: 'Tags',
      description: 'Classification tags',
      required: false,
      item_type: 'string',
    },
    notes: {
      name: 'notes',
      type: 'string',
      label: 'Notes',
      description: 'Context notes',
      required: false,
    },
    kind: {
      name: 'kind',
      type: 'string',
      label: 'Legacy Kind',
      description: 'Compatibility marker for legacy entity kind',
      required: false,
      default_value: 'HABIT',
    },
    recurrence: {
      name: 'recurrence',
      type: 'object',
      label: 'Recurrence Rule',
      description: 'Cadence and recurrence rule configuration',
      required: false,
    },
    commitment: {
      name: 'commitment',
      type: 'object',
      label: 'Commitment Definition',
      description: 'Periodic target and cadence specification',
      required: false,
    },
    evidence: {
      name: 'evidence',
      type: 'array',
      label: 'Evidence Collection',
      description: 'Timestamped evidence items with provenance',
      required: false,
      item_type: 'object',
    },
    reminder_policy: {
      name: 'reminder_policy',
      type: 'object',
      label: 'Reminder Policy',
      description: 'Notification trigger and timing configuration',
      required: false,
    },
    productivity: {
      name: 'productivity',
      type: 'enum',
      label: 'Productivity Classification',
      description: 'Productivity categorization of this habit',
      required: false,
      enum_options: ['PRODUCTIVE', 'NEUTRAL', 'UNPRODUCTIVE', 'SLEEP'],
    },
    color_hex: {
      name: 'color_hex',
      type: 'string',
      label: 'Color Code',
      description: 'Hex color representation',
      required: false,
    },
  },
  privacy_tier: 'private',
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
};

export const SYSTEM_MEMORY_ITEM_SCHEMA: SchemaDefinition = {
  id: 'system/memory_item',
  version: 1,
  displayName: 'Memory Item',
  description: 'Durable personal memory, preference, or fact with provenance and confidence',
  scope: 'system',
  capabilities: ['contextual'],
  attributes: {
    content: {
      name: 'content',
      type: 'string',
      label: 'Memory Content',
      description: 'The learned fact, preference, or durable context',
      required: true,
    },
    category: {
      name: 'category',
      type: 'enum',
      label: 'Category',
      description: 'Classification of the memory',
      required: true,
      enum_options: ['preference', 'fact', 'project_context', 'relationship', 'goal_aspiration', 'routine', 'wellness'],
      default_value: 'fact',
    },
    confidence: {
      name: 'confidence',
      type: 'number',
      label: 'Confidence Score',
      description: 'Confidence rating from 0.0 to 1.0',
      required: false,
      default_value: 1.0,
      constraints: { min: 0, max: 1 },
    },
    source_type: {
      name: 'source_type',
      type: 'string',
      label: 'Source Provenance',
      description: 'Origin category of this memory',
      required: false,
      default_value: 'user_explicit',
    },
    status: {
      name: 'status',
      type: 'enum',
      label: 'Lifecycle Status',
      description: 'Memory status',
      required: false,
      enum_options: ['active', 'superseded', 'expired', 'conflicted', 'deleted'],
      default_value: 'active',
    },
    privacy_tier: {
      name: 'privacy_tier',
      type: 'string',
      label: 'Privacy Tier',
      description: 'Sensitivity classification',
      required: false,
      default_value: 'personal',
    },
    last_relevant_at: {
      name: 'last_relevant_at',
      type: 'datetime',
      label: 'Last Relevant Timestamp',
      description: 'Timestamp when this memory was last retrieved/used',
      required: false,
    },
    valid_from: {
      name: 'valid_from',
      type: 'datetime',
      label: 'Valid From',
      description: 'Effective start date of this memory',
      required: false,
    },
    valid_until: {
      name: 'valid_until',
      type: 'datetime',
      label: 'Valid Until',
      description: 'Optional expiration timestamp',
      required: false,
    },
    superseded_by: {
      name: 'superseded_by',
      type: 'string',
      label: 'Superseded By',
      description: 'ID of the newer memory that replaces this one',
      required: false,
    },
    supersedes: {
      name: 'supersedes',
      type: 'string',
      label: 'Supersedes',
      description: 'ID of the older memory that this one replaces',
      required: false,
    },
    reversal_reason: {
      name: 'reversal_reason',
      type: 'string',
      label: 'Reversal Reason',
      description: 'Context or rationale for superseding the previous belief',
      required: false,
    },
    source_turn: {
      name: 'source_turn',
      type: 'number',
      label: 'Source Turn',
      description: 'Conversation turn number where this memory was observed',
      required: false,
    },
    source_excerpt: {
      name: 'source_excerpt',
      type: 'string',
      label: 'Source Excerpt',
      description: 'Exact verbatim excerpt from conversation grounding this belief',
      required: false,
    },
    speaker: {
      name: 'speaker',
      type: 'string',
      label: 'Speaker',
      description: 'Who stated or inferred this belief: user or assistant',
      required: false,
    },
    epistemic_status: {
      name: 'epistemic_status',
      type: 'string',
      label: 'Epistemic Status',
      description: 'user_decision, assistant_proposal, or shared_fact',
      required: false,
    },
    user_confirmed: {
      name: 'user_confirmed',
      type: 'boolean',
      label: 'User Confirmed',
      description: 'Whether explicitly ratified by user',
      required: false,
    },
    conflict_with: {
      name: 'conflict_with',
      type: 'array',
      label: 'Conflicting Memories',
      description: 'IDs of contradictory memories',
      required: false,
      item_type: 'string',
    },
    associated_entity_ids: {
      name: 'associated_entity_ids',
      type: 'array',
      label: 'Associated Entity IDs',
      description: 'Entity IDs linked to this memory',
      required: false,
      item_type: 'string',
    },
    tags: {
      name: 'tags',
      type: 'array',
      label: 'Tags',
      description: 'Semantic tags for indexing and retrieval',
      required: false,
      item_type: 'string',
    },
    kind: {
      name: 'kind',
      type: 'string',
      label: 'Legacy Kind',
      description: 'Compatibility marker for legacy entity kind',
      required: false,
    },
  },
  privacy_tier: 'private',
  created_at: '2026-10-08T00:00:00.000Z',
  updated_at: '2026-10-08T00:00:00.000Z',
};

export const SYSTEM_SITUATIONAL_STATE_SCHEMA: SchemaDefinition = {
  id: 'system/situational_state',
  version: 1,
  displayName: 'Situational State',
  description: 'Temporary meaningful state with strict temporal validity',
  scope: 'system',
  capabilities: ['contextual'],
  attributes: {
    topic: {
      name: 'topic',
      type: 'string',
      label: 'Topic',
      description: 'Brief topic of the situational state',
      required: true,
    },
    details: {
      name: 'details',
      type: 'string',
      label: 'Details',
      description: 'Contextual details and expectations',
      required: true,
    },
    valid_from: {
      name: 'valid_from',
      type: 'datetime',
      label: 'Valid From',
      description: 'Temporal start timestamp (ISO 8601)',
      required: true,
    },
    valid_until: {
      name: 'valid_until',
      type: 'datetime',
      label: 'Valid Until',
      description: 'Temporal expiration timestamp (ISO 8601)',
      required: true,
    },
    confidence: {
      name: 'confidence',
      type: 'number',
      label: 'Confidence',
      description: 'Confidence score (0.0 to 1.0)',
      required: false,
      default_value: 1.0,
      constraints: { min: 0, max: 1 },
    },
    source_type: {
      name: 'source_type',
      type: 'string',
      label: 'Source',
      description: 'Provenance source type',
      required: false,
      default_value: 'user_explicit',
    },
    privacy_tier: {
      name: 'privacy_tier',
      type: 'string',
      label: 'Privacy Tier',
      description: 'Sensitivity classification',
      required: false,
      default_value: 'personal',
    },
    associated_entity_ids: {
      name: 'associated_entity_ids',
      type: 'array',
      label: 'Associated Entities',
      description: 'Related entity IDs',
      required: false,
      item_type: 'string',
    },
    tags: {
      name: 'tags',
      type: 'array',
      label: 'Tags',
      description: 'Semantic tags',
      required: false,
      item_type: 'string',
    },
    kind: {
      name: 'kind',
      type: 'string',
      label: 'Legacy Kind',
      description: 'Compatibility marker for legacy entity kind',
      required: false,
    },
  },
  privacy_tier: 'private',
  created_at: '2026-10-08T00:00:00.000Z',
  updated_at: '2026-10-08T00:00:00.000Z',
};

export const SYSTEM_INFRASTRUCTURE_SCHEMAS: ReadonlyArray<SchemaDefinition> = [
  SYSTEM_MEMORY_ITEM_SCHEMA,
  SYSTEM_SITUATIONAL_STATE_SCHEMA,
];

export const BASELINE_SYSTEM_SCHEMAS: ReadonlyArray<SchemaDefinition> = [
  SYSTEM_TASK_SCHEMA,
  SYSTEM_EVENT_SCHEMA,
  SYSTEM_NOTE_SCHEMA,
  SYSTEM_PERSON_SCHEMA,
  SYSTEM_GOAL_SCHEMA,
  SYSTEM_HABIT_SCHEMA,
  SYSTEM_MEAL_LOG_SCHEMA,
  SYSTEM_ATTENDANCE_RECORD_SCHEMA,
  SYSTEM_UNSTRUCTURED_ITEM_SCHEMA,
];

// ============================================================================
// 2. BASELINE CAPABILITY CONTRACTS & DEFINITIONS
// ============================================================================

export interface SchedulableContract {
  start_time?: string;
  end_time?: string;
  deadline?: string;
  all_day?: boolean;
}

export const SCHEDULABLE_CAPABILITY: CapabilityDefinition<SchedulableContract> = {
  id: 'schedulable',
  name: 'Schedulable Temporal Item',
  description: 'Exposes timeline boundaries, calendar slots, or deadlines',
  category: 'semantic',
  required_attributes: [],
  is_satisfied_by: (e) => {
    const a = e.attributes;
    return (
      typeof a.deadline === 'string' ||
      typeof a.start_time === 'string' ||
      typeof a.end_time === 'string' ||
      typeof a.date === 'string' ||
      (e.validity !== undefined &&
        (typeof e.validity.valid_from === 'string' ||
          typeof e.validity.valid_until === 'string'))
    );
  },
  extract_contract: (e) => {
    const a = e.attributes;
    const startTime = typeof a.start_time === 'string'
      ? a.start_time
      : (typeof a.date === 'string' ? a.date : e.validity?.valid_from);
    const endTime = typeof a.end_time === 'string' ? a.end_time : e.validity?.valid_until;
    const deadline = typeof a.deadline === 'string' ? a.deadline : undefined;
    const allDay = typeof a.all_day === 'boolean' ? a.all_day : false;

    return {
      start_time: startTime,
      end_time: endTime,
      deadline,
      all_day: allDay,
    };
  },
  supported_projections: ['calendar', 'timeline', 'agenda', 'daily_briefing'],
};

export interface TrackableProgressContract {
  current: number;
  target: number;
  unit?: string;
  percentage: number;
}

export const TRACKABLE_PROGRESS_CAPABILITY: CapabilityDefinition<TrackableProgressContract> = {
  id: 'trackable_progress',
  name: 'Trackable Progress',
  description: 'Exposes quantitative milestone or completion progress',
  category: 'semantic',
  required_attributes: [],
  is_satisfied_by: (e) => {
    const a = e.attributes;
    return (
      typeof a.current_progress === 'number' ||
      typeof a.completion_percentage === 'number' ||
      typeof a.progress === 'number' ||
      typeof a.current_count === 'number' ||
      Array.isArray(a.subtasks)
    );
  },
  extract_contract: (e) => {
    const a = e.attributes;
    if (typeof a.completion_percentage === 'number') {
      const pct = Math.max(0, Math.min(100, a.completion_percentage));
      return { current: pct, target: 100, unit: '%', percentage: pct };
    }
    if (typeof a.progress === 'number') {
      const pct = Math.max(0, Math.min(100, a.progress));
      return { current: pct, target: 100, unit: '%', percentage: pct };
    }
    if (typeof a.current_progress === 'number' || typeof a.current_count === 'number') {
      const current = typeof a.current_progress === 'number' ? a.current_progress : (a.current_count as number);
      const target = typeof a.target_count === 'number' ? a.target_count : 100;
      const unit = typeof a.target_unit === 'string' ? a.target_unit : (typeof a.unit === 'string' ? a.unit : undefined);
      const percentage = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
      return { current, target, unit, percentage };
    }
    if (Array.isArray(a.subtasks)) {
      const total = a.subtasks.length;
      if (total === 0) return { current: 0, target: 0, unit: 'subtasks', percentage: 100 };
      const completed = a.subtasks.filter(
        (st) =>
          typeof st === 'object' &&
          st !== null &&
          (st as Record<string, unknown>).completed === true
      ).length;
      return {
        current: completed,
        target: total,
        unit: 'subtasks',
        percentage: Math.round((completed / total) * 100),
      };
    }
    return { current: 0, target: 1, percentage: 0 };
  },
  supported_projections: ['progress_bar', 'dashboard_card', 'briefing_metric'],
};

export interface EvaluableStateContract {
  is_completed: boolean;
  status: string;
}

export const EVALUABLE_STATE_CAPABILITY: CapabilityDefinition<EvaluableStateContract> = {
  id: 'evaluable_state',
  name: 'Evaluable State',
  description: 'Evaluates lifecycle completion status',
  category: 'semantic',
  required_attributes: [],
  is_satisfied_by: (e) => Boolean(e.lifecycle && typeof e.lifecycle.status === 'string'),
  extract_contract: (e) => {
    const status = e.lifecycle.status.toLowerCase();
    const isCompleted = status === 'completed' || status === 'done' || status === 'archived';
    return { is_completed: isCompleted, status: e.lifecycle.status };
  },
  supported_projections: ['status_pill', 'badge', 'kanban_column'],
};

export interface RecurrentContract {
  rule: RecurrenceRule | null;
  rrule: string;
}

export const RECURRENT_CAPABILITY: CapabilityDefinition<RecurrentContract> = {
  id: 'recurrent',
  name: 'Recurrence Rule Contract',
  description: 'Declares an RFC 5545 or structured cadence recurrence specification',
  category: 'semantic',
  required_attributes: [],
  is_satisfied_by: (e) => {
    const a = e.attributes;
    return Boolean(
      typeof a.cadence_rrule === 'string' ||
        typeof a.recurrence === 'string' ||
        (typeof a.recurrence === 'object' && a.recurrence !== null)
    );
  },
  extract_contract: (e) => {
    const a = e.attributes;
    const rule = parseRecurrenceRule(a.recurrence || a.cadence_rrule);
    const rrule = typeof a.cadence_rrule === 'string'
      ? a.cadence_rrule
      : (typeof a.recurrence === 'string' ? a.recurrence : (rule ? rule.cadence : ''));
    return { rule, rrule };
  },
  supported_projections: ['recurrence_badge', 'calendar_series'],
};

export interface CommitmentContract {
  target: CommitmentTarget;
}

export const COMMITMENT_CAPABILITY: CapabilityDefinition<CommitmentContract> = {
  id: 'commitment',
  name: 'Commitment Contract',
  description: 'Exposes periodic target, evaluation window, and completion status',
  category: 'semantic',
  required_attributes: [],
  is_satisfied_by: (e) => {
    const a = e.attributes;
    return Boolean(
      (typeof a.commitment === 'object' && a.commitment !== null) ||
        (typeof a.frequency_goal === 'number' && typeof a.frequency_period === 'string')
    );
  },
  extract_contract: (e) => {
    const a = e.attributes;
    const target = parseCommitmentTarget(a.commitment || a) || {
      min_count: 1,
      period: 'week',
      target_unit: 'times',
    };
    return { target };
  },
  supported_projections: ['commitment_card', 'progress_bar', 'streak_badge', 'dashboard_card'],
};

export interface EvidenceContract {
  items: EvidenceItem[];
}

export const EVIDENCE_CAPABILITY: CapabilityDefinition<EvidenceContract> = {
  id: 'evidence',
  name: 'Evidence Collection',
  description: 'Exposes timestamped evidence items with provenance',
  category: 'semantic',
  required_attributes: [],
  is_satisfied_by: (e) => Array.isArray(e.attributes.evidence),
  extract_contract: (e) => ({
    items: parseEvidenceItems(e.attributes.evidence),
  }),
  supported_projections: ['evidence_history', 'completion_log'],
};

export interface NotifiableContract {
  policy: ReminderPolicy | null;
}

export const NOTIFIABLE_CAPABILITY: CapabilityDefinition<NotifiableContract> = {
  id: 'notifiable',
  name: 'Notification & Reminder Policy',
  description: 'Exposes reminder schedule and alert triggers',
  category: 'semantic',
  required_attributes: [],
  is_satisfied_by: (e) => {
    const a = e.attributes;
    return Boolean(
      (typeof a.reminder_policy === 'object' && a.reminder_policy !== null) ||
        (typeof a.reminder === 'object' && a.reminder !== null)
    );
  },
  extract_contract: (e) => ({
    policy: parseReminderPolicy(e.attributes.reminder_policy || e.attributes.reminder),
  }),
  supported_projections: ['reminder_banner', 'alert_schedule'],
};

export interface ContextualContract {
  category?: string;
  relevance_score?: number;
  temporal_validity?: {
    valid_from?: string;
    valid_until?: string;
  };
}

export const CONTEXTUAL_CAPABILITY: CapabilityDefinition<ContextualContract> = {
  id: 'contextual',
  name: 'Contextual Knowledge Item',
  description: 'Participates in intelligent context resolution and memory retrieval',
  category: 'semantic',
  required_attributes: [],
  is_satisfied_by: (e) => {
    return Boolean(
      e.attributes.content ||
        e.attributes.topic ||
        e.attributes.details ||
        e.attributes.notes
    );
  },
  extract_contract: (e) => ({
    category: typeof e.attributes.category === 'string' ? e.attributes.category : undefined,
    temporal_validity:
      typeof e.attributes.valid_from === 'string' || typeof e.attributes.valid_until === 'string'
        ? {
            valid_from: typeof e.attributes.valid_from === 'string' ? e.attributes.valid_from : undefined,
            valid_until: typeof e.attributes.valid_until === 'string' ? e.attributes.valid_until : undefined,
          }
        : undefined,
  }),
  supported_projections: ['memory_card', 'context_badge'],
};

export const BASELINE_CAPABILITIES: ReadonlyArray<CapabilityDefinition<unknown>> = [
  LOCATIONAL_CAPABILITY as CapabilityDefinition<unknown>,
  METRIC_CAPABILITY as CapabilityDefinition<unknown>,
  SCHEDULABLE_CAPABILITY as CapabilityDefinition<unknown>,
  TRACKABLE_PROGRESS_CAPABILITY as CapabilityDefinition<unknown>,
  EVALUABLE_STATE_CAPABILITY as CapabilityDefinition<unknown>,
  RECURRENT_CAPABILITY as CapabilityDefinition<unknown>,
  COMMITMENT_CAPABILITY as CapabilityDefinition<unknown>,
  EVIDENCE_CAPABILITY as CapabilityDefinition<unknown>,
  NOTIFIABLE_CAPABILITY as CapabilityDefinition<unknown>,
  CONTEXTUAL_CAPABILITY as CapabilityDefinition<unknown>,
];

// ============================================================================
// 3. REGISTRY BOOTSTRAP ENGINE
// ============================================================================

export function registerSystemSchemas(registry: SchemaRegistry): void {
  for (const schema of BASELINE_SYSTEM_SCHEMAS) {
    if (!registry.get(schema.id)) {
      registry.register(schema);
    }
  }
}

export function registerInfrastructureSchemas(registry: SchemaRegistry): void {
  for (const schema of SYSTEM_INFRASTRUCTURE_SCHEMAS) {
    if (!registry.get(schema.id)) {
      registry.register(schema);
    }
  }
}

export function registerSystemCapabilities(registry: CapabilityRegistry): void {
  for (const cap of BASELINE_CAPABILITIES) {
    if (!registry.get(cap.id)) {
      registry.register(cap);
    }
  }
}

export function bootstrapKernel(registries?: {
  schemas?: SchemaRegistry;
  capabilities?: CapabilityRegistry;
}): {
  schemas: Record<string, SchemaDefinition>;
  capabilities: ReadonlyArray<CapabilityDefinition<unknown>>;
} {
  const schemaMap: Record<string, SchemaDefinition> = {};
  for (const s of [...BASELINE_SYSTEM_SCHEMAS, ...SYSTEM_INFRASTRUCTURE_SCHEMAS]) {
    schemaMap[s.id] = s;
  }

  if (registries?.capabilities) {
    registerSystemCapabilities(registries.capabilities);
  }
  if (registries?.schemas) {
    registerSystemSchemas(registries.schemas);
    registerInfrastructureSchemas(registries.schemas);
  }

  return {
    schemas: schemaMap,
    capabilities: BASELINE_CAPABILITIES,
  };
}

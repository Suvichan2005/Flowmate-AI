// Domain Types based on Master Document Section 5

export enum EntityKind {
  GOAL = 'GOAL',
  PROJECT = 'PROJECT',
  TASK = 'TASK',
  EVENT = 'EVENT',
  ACTIVITY = 'ACTIVITY',
  HABIT = 'HABIT',
  TAG = 'TAG',
  NOTE = 'NOTE',
  CONTEXT = 'CONTEXT',
  // Flowmate 2.5 — Brain Entities
  PERSON = 'PERSON',
  PROMISE = 'PROMISE',
  OPPORTUNITY = 'OPPORTUNITY',
  MINI_STREAK = 'MINI_STREAK', // Quick one-tap streaks (Duolingo, Snapchat, etc.)
}

// Flowmate 3.2: Productive Hours Tracking
export type ProductivityType = 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE' | 'SLEEP';
export const ProductivityValue: Record<ProductivityType, number> = {
  PRODUCTIVE: 1,
  NEUTRAL: 0,
  UNPRODUCTIVE: -1,
  SLEEP: 0
};

// Flowmate 3.2: Calendar View Mode
export type CalendarViewMode = 'month' | 'week' | 'day' | 'agenda' | 'history';

export type HabitType = 'GOOD' | 'BAD';
export type HabitFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

// Specific Metadata for Habits
export interface HabitMetadata {
  streak_current: number;
  streak_best: number;
  total_completions: number;
  habit_type: HabitType;
  frequency_goal: number;
  frequency_period: HabitFrequency;
  last_completed_at?: string;
  time_spent_minutes?: number;
  limit_minutes?: number;
}

// Flowmate 2.5 — Person Metadata (Relationship Radar)
export interface PersonMetadata {
  category: 'mentor' | 'peer' | 'professional' | 'family' | 'friend';
  organization?: string;
  last_interaction?: string;
  interaction_count: number;
  notes?: string[];
  email?: string;
  phone?: string;
}

// Flowmate 2.5 — Promise Metadata (Promise Tracker)
export interface PromiseMetadata {
  original_statement: string;
  to_person_id?: string;
  to_person_name?: string;
  detected_at: string;
  due_date?: string;
  fulfilled_at?: string;
  broken_reason?: string;
}

// Flowmate 3.0 — Nested Subtask (NOT a graph entity, stored in metadata)
export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  created_at: string;
  completed_at?: string;
  estimated_minutes?: number;
  order?: number; // For drag-drop reordering
}

// Flowmate 3.0 — Embedded Activity Log Entry (NOT a graph entity, stored in metadata)
export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  title: string;
  duration_minutes: number;
  notes?: string;
  productivity?: ProductivityType;
  color_hex?: string;
}



// --- Type-Safe Entity Metadata ---

// Common metadata fields present on all entity kinds
export interface CommonMetadata {
  archived?: boolean;
  deleted?: boolean;
  hidden?: boolean;
  activity_log?: ActivityLogEntry[];
  _legacy?: Record<string, any>; // Migration bucket for unrecognized fields
}

// Per-kind metadata (extends CommonMetadata at the type level)
export interface TaskMetadata extends CommonMetadata {
  subtasks?: Subtask[];
  productivity?: ProductivityType;
}

export interface EventMetadata extends CommonMetadata {
  rrule?: string;
  location?: string;
  gcal_id?: string;
  gcal_link?: string;
}

export interface GoalMetadata extends CommonMetadata {
  progress?: number;      // 0-100
  subtasks?: Subtask[];
  milestones?: string[];
}

export interface ProjectMetadata extends CommonMetadata {
  subtasks?: Subtask[];
  completion_percentage?: number;
}

export interface NoteMetadata extends CommonMetadata {
  content_format?: 'markdown' | 'plain';
}

export interface MiniStreakMetadata extends CommonMetadata {
  streak_current: number;
  streak_best: number;
  last_completed_at?: string;
  app_name?: string;
}

// Type guards for narrowing Entity metadata by kind
export function isHabitEntity(e: Entity): e is Entity & { metadata: HabitMetadata & CommonMetadata } {
  return e.kind === EntityKind.HABIT;
}
export function isTaskEntity(e: Entity): e is Entity & { metadata: TaskMetadata } {
  return e.kind === EntityKind.TASK;
}
export function isEventEntity(e: Entity): e is Entity & { metadata: EventMetadata } {
  return e.kind === EntityKind.EVENT;
}
export function isGoalEntity(e: Entity): e is Entity & { metadata: GoalMetadata } {
  return e.kind === EntityKind.GOAL;
}
export function isProjectEntity(e: Entity): e is Entity & { metadata: ProjectMetadata } {
  return e.kind === EntityKind.PROJECT;
}
export function isPersonEntity(e: Entity): e is Entity & { metadata: PersonMetadata & CommonMetadata } {
  return e.kind === EntityKind.PERSON;
}
export function isPromiseEntity(e: Entity): e is Entity & { metadata: PromiseMetadata & CommonMetadata } {
  return e.kind === EntityKind.PROMISE;
}
export function isNoteEntity(e: Entity): e is Entity & { metadata: NoteMetadata } {
  return e.kind === EntityKind.NOTE;
}
export function isMiniStreakEntity(e: Entity): e is Entity & { metadata: MiniStreakMetadata } {
  return e.kind === EntityKind.MINI_STREAK;
}

export enum EntityStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
  ARCHIVED = 'ARCHIVED',
}

export type RecurrenceType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | null;

export interface Entity {
  id: string;
  kind: EntityKind;
  title: string;
  description: string | null;
  status: EntityStatus;
  priority: number;
  start_time: string | null; // ISO8601
  end_time: string | null; // ISO8601
  deadline: string | null; // ISO8601
  duration_minutes: number | null;
  recurrence: RecurrenceType;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  canonical_tags: string[];
  // Flowmate 3.1: Direct parent reference (replaces PART_OF relationship)
  parent_id?: string | null;
}

export interface TagDefinition {
  id: string;
  title: string;
  kind: EntityKind; // TAG or CONTEXT
  color?: string;
  usage_count: number;
}

export enum RelationshipType {
  FULFILLS = 'FULFILLS',
  PART_OF = 'PART_OF',
  PRECEDES = 'PRECEDES',
  DEPENDS_ON = 'DEPENDS_ON',
  SCHEDULED_FOR = 'SCHEDULED_FOR',
  TAGGED_WITH = 'TAGGED_WITH',
  ASSIGNED_TO = 'ASSIGNED_TO',
  RELATED_TO = 'RELATED_TO',
}

export interface Relationship {
  id: string;
  from: string;
  to: string;
  type: RelationshipType;
  meta: Record<string, any>;
  created_at: string;
}

export interface Message {
  id: string;
  created_at: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  channelId?: string; // 'general', 'food', 'finance', 'schedules'
  attachment?: string | null; // Base64 encoded image string
  ops_preview?: ToonOperation[];
  structured?: any;
}

// TOON (Token-Oriented Object Notation) Types
export type ToonOperationType =
  | 'create_entity'
  | 'update_entity'
  | 'delete_entity'
  | 'link_entities'
  | 'unlink_entities'
  | 'set_goal_progress'
  | 'log_activity'
  | 'schedule_event'
  | 'tag_update'
  // Flowmate 3.0 — Nested Entity Operations
  | 'add_subtask'
  | 'toggle_subtask'
  | 'delete_subtask'
  | 'log_to_entity'
  | 'archive_entity'
  // Flowmate 3.0 — Food Tracking
  | 'log_food';

export interface ToonOperation {
  type: ToonOperationType;
  payload: Record<string, any>;
}

export interface ToonAssistant {
  message: string;
  tone: string;
  follow_up: string[];
}

export interface ToonResponse {
  ops: ToonOperation[];
  assistant: ToonAssistant;
}

export interface SyncQueueItem {
  id: string;
  op: ToonOperation;
  status: 'pending' | 'in_progress' | 'failed' | 'done';
  attempts: number;
  created_at: string;
}

// Flowmate 3.1: Feature Toggles (expanded)
export interface FeatureToggles {
  food_tracking: boolean;       // Mess menu display
  attendance_tracking: boolean; // Class attendance (disabled by default)
  people_tracking: boolean;
  gamification: boolean;        // XP/Levels (disabled by default)
  quick_streaks: boolean;       // Mini streaks widget
}

export interface UserSettings {
  // User Profile
  username?: string;       // Display name for AI interactions
  fullname?: string;       // Full legal name
  nickname?: string;       // Preferred casual name (AI will use this)

  // App Settings
  timezone: string;
  preferred_model: string;
  sync_enabled: boolean;
  debug_mode: boolean;
  custom_instructions?: string;
  // Flowmate 3.1: Feature Toggles
  feature_toggles: FeatureToggles;
  productivity_calc_method?: 'LOGGED_TIME' | 'AWAKE_TIME'; // Flowmate 3.2
}



export interface DebugLogEntry {
  id: string;
  timestamp: string;
  type: 'orchestrator' | 'sync' | 'system' | 'error' | 'warning';
  summary: string;
  details: any;
}

export interface FocusSession {
  entityId: string;
  startTime: string; // ISO8601
  durationMinutes: number;
  status: 'active' | 'paused' | 'completed';
}

export interface DailyBriefing {
  content: string; // Markdown supported
  timestamp: string;
  generated_for_date: string;
}

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

// Flowmate 3.0: Food Tracking
export type DietaryType = 'veg' | 'non-veg' | 'vegan' | 'eggetarian';

export interface FoodPreferences {
  dietary_type: DietaryType;
  allergies?: string[];
  favorite_foods?: string[];
  disliked_foods?: string[];
}

export type FoodSource = 'mess' | 'ordered' | 'homemade' | 'outside';

export interface FoodLogEntry {
  id: string;
  timestamp: string;
  food_name: string;
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  cost?: number;
  notes?: string;
  is_favorite?: boolean;
  source?: FoodSource;
  vendor?: string;
  rating?: number;
  skipped?: boolean;
  health_tags?: string[];
  quality_notes?: string;
  meal_id?: string;
  quantity?: number;
  serving_unit?: string;
}



// Flowmate 3.1: Attendance Tracking
export interface Subject {
  id: string;
  name: string;
  code?: string;
  teacher_name?: string;
  min_attendance: number;
  color?: string;
}

export interface ClassSchedule {
  id: string;
  subject_id: string;
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start_time: string;
  end_time: string;
  room?: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

export interface AttendanceLog {
  id: string;
  subject_id: string;
  date: string;
  status: 'present' | 'absent' | 'cancelled';
}

// Full ViewType (all views, controlled by feature toggles)
export type ViewType = 'dashboard' | 'chat' | 'chat_graph' | 'goals' | 'projects' | 'knowledge' | 'calendar' | 'analytics' | 'timeline' | 'settings' | 'schedules' | 'food' | 'attendance';
// Domain Types based on Master Document Section 5

export enum EntityKind {
  GOAL = 'GOAL',
  PROJECT = 'PROJECT',
  COURSE = 'COURSE',
  TOPIC = 'TOPIC',
  TASK = 'TASK',
  EVENT = 'EVENT',
  ACTIVITY = 'ACTIVITY',
  HABIT = 'HABIT',
  ROLE = 'ROLE',
  TAG = 'TAG',
  NOTE = 'NOTE',
  CONTEXT = 'CONTEXT',
  // Flowmate 2.5 — Brain Entities
  PERSON = 'PERSON',
  PROMISE = 'PROMISE',
  OPPORTUNITY = 'OPPORTUNITY',
  MINI_STREAK = 'MINI_STREAK', // Quick one-tap streaks (Duolingo, Snapchat, etc.)
}

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

// Flowmate 2.5 — Opportunity Metadata (Opportunity Engine)
export interface OpportunityMetadata {
  type: 'lead' | 'competition' | 'connection' | 'internship' | 'collaboration';
  source_person_id?: string;
  source_person_name?: string;
  potential_value?: string;
  next_action?: string;
  expires_at?: string;
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
  | 'tag_update';

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

export interface UserSettings {
  timezone: string;
  preferred_model: string;
  sync_enabled: boolean;
  debug_mode: boolean;
  custom_instructions?: string;
}

export interface DebugLogEntry {
  id: string;
  timestamp: string;
  type: 'orchestrator' | 'sync' | 'system';
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
  type: 'success' | 'error' | 'info';
}

export type ViewType = 'dashboard' | 'chat_graph' | 'goals' | 'projects' | 'knowledge' | 'calendar' | 'analytics' | 'settings' | 'schedules';
// Domain Types based on Master Document Section 5

export enum EntityKind {
  GOAL = 'GOAL',
  PROJECT = 'PROJECT',
  COURSE = 'COURSE',
  TOPIC = 'TOPIC',
  TASK = 'TASK',
  EVENT = 'EVENT',
  ACTIVITY = 'ACTIVITY',
  ROLE = 'ROLE',
  TAG = 'TAG',
  NOTE = 'NOTE',
  CONTEXT = 'CONTEXT',
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

export type ViewType = 'dashboard' | 'chat_graph' | 'goals' | 'projects' | 'knowledge' | 'calendar' | 'settings';
# Semantic Analysis

This document outlines the Domain Model and Type System used in Flowmate.

## Core Domain Entities

The system is built around the `Entity` interface. Every item in the user's life is an Entity.

### Entity Kinds (`EntityKind`)

| Kind | Description | Example |
|------|-------------|---------|
| `GOAL` | High-level objective | "Learn Spanish" |
| `PROJECT` | Concrete scope of work | "Complete Duolingo Unit 1" |
| `TASK` | Actionable unit | "Practice for 15 mins" |
| `EVENT` | Time-bound occurrence | "Spanish Class @ 5PM" |
| `ACTIVITY` | Backward-looking log | "Studied Spanish (30m)" |
| `NOTE` | Static information | "Vocabulary List" |
| `TAG` | Categorization marker | "#language" |
| `CONTEXT` | Environmental context | "@mobile" |
| `HABIT` | Recurring behavior | "Morning Reading" |
| `COURSE` | Academic course | "CS101" |
| `TOPIC` | Subject matter | "Algorithms" |
| `ROLE` | User identity role | "Student" |
| `PERSON` | Human contact | "Professor X" |
| `PROMISE` | Commitment to someone | "Submit assignment by Friday" |
| `MINI_STREAK` | Lightweight tracker | "Daily Pushups" |
| `OPPORTUNITY` | Potential value | "Internship application" |

### Entity Properties

Every Entity has:
- `id` (UUID)
- `title`
- `description` (Markdown)
- `status` (PENDING, ACTIVE, IN_PROGRESS, COMPLETED, CANCELED, ARCHIVED)
- `priority` (1-5)
- `canonical_tags` (Array of tag strings)
- `start_time` / `end_time` (ISO8601 timestamps)
- `deadline` (ISO8601 timestamp)
- `recurrence` (DAILY, WEEKLY, MONTHLY, YEARLY, or null)
- `parent_id` (Direct parent reference for hierarchy)
- `metadata` (Flexible JSON for specific needs)

### Specialized Metadata Types

```typescript
// Habit tracking
interface HabitMetadata {
  streak_current: number;
  streak_best: number;
  total_completions: number;
  habit_type: 'GOOD' | 'BAD';
  frequency_goal: number;
  frequency_period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
}

// Relationship tracking
interface PersonMetadata {
  category: 'mentor' | 'peer' | 'professional' | 'family' | 'friend';
  last_interaction?: string;
  interaction_count: number;
}

// Commitment tracking
interface PromiseMetadata {
  original_statement: string;
  to_person_id?: string;
  due_date?: string;
  fulfilled_at?: string;
}

// Nested subtasks (NOT graph entities)
interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  estimated_minutes?: number;
}

// Embedded activity logs
interface ActivityLogEntry {
  id: string;
  timestamp: string;
  title: string;
  duration_minutes: number;
}
```

## Relationships

The graph is formed by `Relationship` edges connecting Entities.

| Relationship Type | Meaning |
|-------------------|---------|
| `PART_OF` | Parent/Child hierarchy (e.g., Task -> Project) |
| `FULFILLS` | Generic support (e.g., Project -> Goal) |
| `DEPENDS_ON` | Blocker dependency (e.g., Task B needs Task A) |
| `SCHEDULED_FOR` | Linking an item to a Calendar Event |
| `TAGGED_WITH` | Linking to a CONTEXT or TAG entity |
| `PRECEDES` | Sequencing |
| `RELATED_TO` | Soft link |
| `ASSIGNED_TO` | Assignment to a person or role |

## Chat Architecture

The chat is the command line for the brain.

### Channels
Messages are segregated by `channelId` to keep contexts clean:
1.  **General**: Main productivity orchestration
2.  **Schedules**: Managing recurring timetables (Mess/Class)
3.  **Food**: Logging nutritional intake
4.  **Finance**: Tracking spending

### Message Structure
```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  channelId?: string;       // Context separation
  attachment?: string;      // Base64 image
  ops_preview?: ToonOperation[]; // Pending operations
  structured?: any;         // Structured data from AI
}
```

## TOON Protocol (Token-Oriented Object Notation)

This is the JSON schema the AI uses to perform actions.

### Operations

| Operation | Description |
|-----------|-------------|
| `create_entity` | Create a new entity node |
| `update_entity` | Modify entity fields |
| `delete_entity` | Remove an entity |
| `link_entities` | Create a relationship edge |
| `unlink_entities` | Remove a relationship |
| `log_activity` | Record a completed activity |
| `schedule_event` | Create a calendar event |
| `set_goal_progress` | Update goal completion % |
| `tag_update` | Modify tags on an entity |
| `add_subtask` | Add nested subtask to entity |
| `toggle_subtask` | Toggle subtask completion |
| `delete_subtask` | Remove a subtask |
| `log_to_entity` | Add activity log to entity |
| `archive_entity` | Mark entity as archived |
| `log_food` | Log a food entry |

## Productivity Tracking

```typescript
// Productivity classification
type ProductivityType = 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE' | 'SLEEP';

// Food tracking
interface FoodLogEntry {
  id: string;
  timestamp: string;
  food_name: string;
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  cost?: number;
  source?: 'mess' | 'ordered' | 'homemade' | 'outside';
  vendor?: string;
  rating?: number;
}

// Attendance tracking
interface Subject {
  id: string;
  name: string;
  code?: string;
  teacher_name?: string;
  min_attendance: number;
}

interface AttendanceLog {
  id: string;
  subject_id: string;
  date: string;
  status: 'present' | 'absent' | 'cancelled';
}
```

## Feature Toggles

Users can enable/disable major features:

```typescript
interface FeatureToggles {
  food_tracking: boolean;
  attendance_tracking: boolean;
  people_tracking: boolean;
}
```

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
| `PERSON` | (Planned) Human contact | "Professor X" |
| `PROMISE` | (Planned) Commitment | "Submit assignment by Friday" |
| `MINI_STREAK` | Lightweight tracker | "Daily Pushups" |
| `OPPORTUNITY` | Potential value | "Internship application" |

### Entity Properties

Every Entity has:
- `id` (UUID)
- `title`
- `description` (Markdown)
- `status` (ACTIVE, COMPLETED, etc.)
- `priority` (1-5)
- `canonical_tags` (Array of tag strings)
- `metadata` (Flexible JSON for specific needs, e.g., `gcal_id`, `macros`, `spend_amount`)

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

## Chat Architecture

The chat is the command line for the brain.

### Channels
Messages are now segregated by `channelId` to keep contexts clean:
1.  **General**: Main productivity orchestration.
2.  **Schedules**: Managing recurring timetables (Mess/Class).
3.  **Food**: Logging nutritional intake.
4.  **Finance**: Tracking spending.

### Message Structure
```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  channelId?: string;       // Context separation
  attachment?: string;      // Base64 image
  ops_preview?: ToonOperation[]; // Pending operations
}
```

## TOON Protocol (Token-Oriented Object Notation)

This is the JSON schema the AI uses to perform actions.

**Operations:**
*   `create_entity`
*   `update_entity`
*   `link_entities`
*   `log_activity`
*   `schedule_event`
*   `set_goal_progress`

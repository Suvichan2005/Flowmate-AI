# Flowmate V4 — Production Architecture & Execution Plan

> Comprehensive architectural specification for transforming Flowmate from MVP to production-grade agentic Life OS.
> Documents current structural weaknesses and provides concrete redesigns for scalability, real-time sync, agentic AI, and production hardening.

**Status:** Architectural specification + implementation plan  
**Date:** February 2026  
**Scope:** Production hardening + agentic transformation  
**Codebase baseline:** 27,548 LOC across 103 files. React 19 + Zustand 5 + Firebase 12 + Gemini 2.5 Flash. 48 components, 60 tests, PWA target.

---

## Table of Contents

1. [Executive Architecture Overview](#1-executive-architecture-overview)
2. [Firebase & Realtime Architecture](#2-firebase--realtime-architecture)
3. [Agentic AI System](#3-agentic-ai-system)
4. [Entity System Normalization](#4-entity-system-normalization)
5. [Graph Engine Scalability](#5-graph-engine-scalability)
6. [UI/UX System Specification](#6-uiux-system-specification)
7. [Cost Control & Observability](#7-cost-control--observability)
8. [Production Readiness Assessment](#8-production-readiness-assessment)
9. [Execution Roadmap (10-Week Phased)](#9-execution-roadmap-10-week-phased)

---

## 1. Executive Architecture Overview

### 1.1 Current State Assessment

Flowmate is a functional single-user productivity OS with a working entity graph, AI-powered chat orchestration, and Firebase sync. It is **not production-grade**. The gap between "works in development" and "ships to 10,000 users" is structural, not cosmetic.

**What works:**
- Entity CRUD via AI function calling (7 tools, 16 operation types)
- Graph visualization (D3 force-directed, 806 LOC)
- Real-time Firestore sync (subcollection-based, entities + relationships)
- Code-split bundle (414KB entry, lazy-loaded chunks)
- Google OAuth + Email auth
- Rolling conversation context (12-message window + summary)
- 60 automated tests (validation, graph perf, API retry)

**What is structurally broken:**

| System | File(s) | Status | Severity |
|--------|---------|--------|----------|
| Store | `store.ts` (1350 LOC) | Monolithic. ~~Duplicate `delete_entity`~~. ~~`log_food` race condition~~. ~~`syncQueue` unbounded~~. | ~~Critical~~ **Fixed** |
| Sync | `firestoreSync.ts` | ~~`syncOperation()` full re-write~~. `beforeunload` async issue. | ~~Critical~~ **Fixed** |
| AI Executors | `services/ai/executors.ts` | ~~Field mismatches: `is_done`→`completed`, `streak`→`streak_current`~~. | ~~Critical~~ **Fixed** |
| AI Client | `services/ai/client.ts` | ~~`process.env.API_KEY` — wrong for Vite~~. `getAiClient()` creates new instance per call. | ~~Critical~~ **Fixed** |
| Entity model | `types.ts` | `metadata: Record<string, any>` — zero type safety. ~~Dead EntityKinds (COURSE, TOPIC, ROLE)~~. ~~Dead types~~. | **High** |
| Agent scaffold | `services/agent/` | ~~10 empty files (0 bytes each)~~. | ~~High~~ **Deleted** |
| Auth | `services/firebase.ts` | ~~`auth` typed as `any`~~. ~~Token no expiry tracking~~. | ~~High~~ **Fixed** |
| Toast type | `types.ts` | ~~Missing `'warning'` variant~~. | ~~Medium~~ **Fixed** |
| DebugLog type | `types.ts` | ~~Missing `'error'` and `'warning'` variants~~. | ~~Medium~~ **Fixed** |
| UI patterns | Components | No design token system. EntityDetailPanel at 1110 LOC. 48 flat components. | **Medium** |

### 1.2 Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **Normalized data structures** over flat arrays | O(1) entity access at 1000+ node scale vs O(n) array scans |
| **Subcollection Firestore schema** over single document | Avoids 1MB doc limits, enables granular sync + real-time listeners per collection |
| **Stratified memory** over unbounded history | Caps token usage at 7K regardless of conversation length |
| **Last-write-wins with version numbers** over CRDTs | Single-user multi-device — no concurrent editing. LWW with `serverTimestamp()` + monotonic `syncVersion` is sufficient |
| **Progressive graph rendering** over full simulation | Maintains interactivity past 1000 nodes via viewport culling + LOD + Web Worker |
| **Client-side agent** over server-side | No backend infrastructure. Agent runs in-browser with bounded LLM calls per trigger |

### 1.3 Target Architecture

```
┌──────────────────────────────────────────────────────┐
│                    React UI Layer                     │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │Dashboard │ │GraphView │ │ Calendar │ │ Mobile  │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬────┘ │
│       └────────────┬────────────┘             │      │
├────────────────────┼──────────────────────────┼──────┤
│                    │    Zustand Store          │      │
│  ┌─────────────────┴──────────────────────────┘      │
│  │  entities (Map) │ relationships │ messages         │
│  │  settings       │ ui state      │ sync state       │
│  │  derived indexes: byKind, byStatus, byTag          │
│  └────┬───────┬────┴────┬──────────┘                 │
│       │       │         │                             │
├───────┼───────┼─────────┼─────────────────────────────┤
│  Agent│  Sync │    AI   │                             │
│  Core │  Eng. │  Orch.  │   Service Layer             │
│  ┌────┴──┐ ┌──┴───┐ ┌──┴──────┐ ┌──────────────┐    │
│  │Planner│ │Sync  │ │Orchestr.│ │ Tool Registry│    │
│  │Trigger│ │Manag.│ │Context  │ │ Executors    │    │
│  │Memory │ │Queue │ │Prompts  │ │ Dispatch     │    │
│  │Reflect│ │Delta │ │Summary  │ │              │    │
│  └───────┘ └──────┘ └─────────┘ └──────────────┘    │
│                                                       │
├───────────────────────────────────────────────────────┤
│                  Firebase Layer                        │
│  ┌────────┐ ┌───────────────────┐ ┌────────────────┐ │
│  │  Auth  │ │    Firestore      │ │  Cloud Funcs   │ │
│  │ Google │ │ users/{uid}/...   │ │  (future)      │ │
│  └────────┘ └───────────────────┘ └────────────────┘ │
└───────────────────────────────────────────────────────┘
```

---

## 2. Firebase & Realtime Architecture

### 2.1 Final Firestore Schema

```
users/{uid}
  ├── profile          (doc)    → displayName, email, photoURL, createdAt, lastActiveAt
  ├── settings         (doc)    → timezone, preferred_model, feature_toggles, custom_instructions
  ├── entities/{eid}   (docs)   → Entity object (1 doc per entity)
  ├── relationships/{rid} (docs) → Relationship object (1 doc per relationship)
  ├── messages/{mid}   (docs)   → Message objects (chat history, paginated)
  └── meta/
        ├── tags       (doc)    → universalTags[], schemaVersion
        ├── sync       (doc)    → lastSyncedAt, deviceId, syncVersion (monotonic counter)
        └── food       (doc)    → foodLogs[] (single doc — read as batch for analytics)
```

**Design decisions:**
- **Entities and relationships as subcollection docs** — already implemented, correct. Enables granular real-time listeners and avoids 1MB single-doc limit.
- **Messages as subcollection** — currently persisted only in Zustand/localStorage. Messages are append-heavy and grow unboundedly. Subcollection with descending timestamp enables pagination.
- **Settings split from profile.** Settings change frequently (sync-heavy). Profile changes rarely.
- **Food logs in a single meta doc** (not a subcollection). Always read as a batch for analytics. ~200 bytes per entry × 5000 entries = ~1MB, within Firestore doc limit.
- **Sync metadata doc** enables cross-device conflict detection via monotonic `syncVersion`.

### 2.2 Real-Time Subscription Strategy

| Collection | Subscription | Granularity | Justification |
|------------|-------------|-------------|---------------|
| `entities/{eid}` | `onSnapshot` on collection | Full collection | Core data. Must be real-time for cross-device. Uses `docChanges()` delta processing. |
| `relationships/{rid}` | `onSnapshot` on collection | Full collection | Coupled to entities. Same listener pattern. |
| `messages/{mid}` | `onSnapshot` with `limit(50)` + `orderBy('created_at', 'desc')` | Paginated | Latest 50 in real-time. Older via `startAfter()` cursor on scroll. |
| `settings` | `onSnapshot` on single doc | Document | Infrequent changes. |
| `meta/tags` | `onSnapshot` on single doc | Document | Tag definitions shared across devices. |
| `meta/food` | **No real-time listener** | On-demand | Read for analytics on FoodTracker mount. |
| `profile` | **No real-time listener** | Auth-triggered | Loaded once on auth state change. |

**Subscription lifecycle:**
```
Auth state change (signed in)
  → initializeSync(userId, statusCallback, remoteDataCallback)
  → loadInitialData() [one-time fetch]
  → Merge with local state
  → startRealtimeSync() [entity/relationship/config listeners]
  → Store unsubscribe functions

Auth state change (signed out)
  → cleanupSync() [calls all unsubscribes]
  → Clear local Zustand state
```

### 2.3 Conflict Resolution Model

**Strategy: Last-Write-Wins with Monotonic Sync Version**

```
On local mutation:
  1. Apply optimistically to Zustand store (instant UI update)
  2. Increment local syncVersion
  3. Write to Firestore with { ...data, updated_at: serverTimestamp(), syncVersion }
  4. scheduleSync() → 2-second debounce → performSync()
  5. If write fails (offline): Firestore SDK caches locally, retries on reconnect

On remote snapshot (via onSnapshot):
  1. For each docChange:
     - 'added': Insert into store if not present
     - 'modified': Compare remote.updated_at vs local.updated_at
       - Remote newer: apply remote to store
       - Local newer: local wins (already written/queued)
     - 'removed': Remove from store
  2. Guard: skip updates when isSyncing === true (prevent echo)

Version increment validation (Firestore Security Rules):
  allow write: if request.resource.data.syncVersion == resource.data.syncVersion + 1
    || !exists(resource);  // Allow first write

Cross-device consistency:
  - serverTimestamp() canonical ordering (not client clocks)
  - syncVersion monotonic integer for total ordering on timestamp collision
  - No multi-user — single-user, multi-device. No CRDT/OT needed.
```

**Optimistic UI with queue-based offline operations:**
```typescript
offlineQueue: Array<{
  id: string;
  operation: 'set' | 'update' | 'delete';
  collection: 'entities' | 'relationships' | 'messages' | 'meta';
  docId: string;
  data: any;
  timestamp: number;
  retryCount: number;
}>

On reconnection:
  1. Drain queue FIFO
  2. Exponential backoff on retry (1s → 2s → 4s)
  3. After 3 failures: move to dead-letter, surface toast
  4. Queue persisted in Zustand partialize
```

### 2.4 Firestore Indexing Requirements

```
# Required composite indexes

# Entities by kind + updated_at (filtered views, recent per kind)
Collection: users/{uid}/entities
  Fields: kind ASC, updated_at DESC

# Entities by kind + status (filtered lists)
Collection: users/{uid}/entities
  Fields: kind ASC, status ASC, updated_at DESC

# Messages by time (chat pagination)
Collection: users/{uid}/messages
  Fields: created_at DESC

# Relationships by from + type (graph traversal)
Collection: users/{uid}/relationships
  Fields: from ASC, type ASC
```

### 2.5 Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      match /{subcollection}/{docId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // Deny all access to any other path
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 2.6 Auth — Google OAuth Only

**Decision: Remove email/password auth for production.** Email auth adds password reset, email verification, and account linking complexity with no benefit for a personal productivity app.

Remove: `signInWithEmail()`, `signUpWithEmail()`, email form in `AuthModal.tsx`.
Keep: `signInWithGoogle()` with Calendar scopes, `onAuthChange()` listener.

**Token refresh (implemented):**
- On sign-in: store `{ accessToken, expiresAt: Date.now() + 3600 * 1000 }`
- Before Calendar API call: check `Date.now() > expiresAt - 5min` → call `refreshGoogleCalendarToken()`
- Token persisted in localStorage with expiry key

---

## 3. Agentic AI System

### 3.0 Philosophy

Flowmate's AI is currently a **request-response command parser**. The user types "create a task", the model outputs function calls, the store applies them. There is no proactive behavior, no autonomous monitoring, no reflection.

The agentic layer adds **structured autonomy**: the system observes the user's graph, detects patterns, and surfaces bounded suggestions without being asked.

**Safety boundary:** The agent NEVER creates, deletes, or modifies entities autonomously. It can only:
1. Generate suggestions (surfaced as cards/toasts, not applied)
2. Trigger notifications
3. Prepare briefings
4. Flag anomalies
5. Queue proposed operations for user approval via `pendingOrchestration`

### 3.1 Layered Architecture

```
┌─────────────────────────────────────────────┐
│                 TRIGGER SYSTEM               │
│  app_open │ midnight │ streak_risk │ idle    │
│  missed_deadline │ weekly_review │ manual    │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│                  PLANNER                     │
│  Receives: trigger event + context snapshot  │
│  Decides: which tools to invoke, what to     │
│  analyze, what to surface                    │
│  Outputs: execution plan (tool calls)        │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│                 EXECUTOR                     │
│  Runs tool calls from planner               │
│  Tools: same registry as chat AI            │
│  Rate-limited: max 3 LLM calls per trigger  │
│  Results: structured findings               │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│              TOOL REGISTRY                   │
│  Shared with chat AI (7 existing tools)      │
│  + read_calendar, search_entities            │
│  + lookup_goals, lookup_habits               │
│  + get_productivity_stats                    │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│                 MEMORY                       │
│  Working → Contextual → Episodic → Prefs    │
│  (see 3.2 for stratification details)        │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│               REFLECTION                     │
│  Evaluates: were findings useful?            │
│  Updates: user preference memory             │
│  Decides: suppress or surface                │
│  Feedback loop: dismissed = downrank         │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│              GOAL MONITOR                    │
│  Tracks: active goals progress               │
│  Detects: stalled goals (no updates 7+ days) │
│  Flags: conflicting deadlines, overcommit    │
│  Output: priority suggestions                │
└─────────────────────────────────────────────┘
```

### 3.2 Memory Stratification

```
┌──────────────────────────────────────────┐
│          WORKING MEMORY                   │
│  Current turn's context window            │
│  Last 10 messages (sliding window)        │
│  Active tool call results                 │
│  ─────────────────────────────────────    │
│  Lifetime: single orchestrateMessage()    │
│  Token cost: ~2000-4000 per turn          │
│  Storage: function-scoped variables       │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│        CONTEXTUAL MEMORY                  │
│  20 most relevant entities (via scoring)  │
│  calculateRelevance() scores each entity  │
│  by keyword overlap + recency + kind      │
│  Rolling conversation summary             │
│  (summarizeOlderMessages output)          │
│  ─────────────────────────────────────    │
│  Lifetime: session (cleared on app close) │
│  Token cost: ~2500-3500                   │
│  Storage: in-memory (Zustand transient)   │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│        EPISODIC SUMMARIES                 │
│  Daily briefing text (markdown)           │
│  Weekly insight text                      │
│  Key decisions log ("user prefers X")     │
│  ─────────────────────────────────────    │
│  Lifetime: persisted (Firestore meta/ai)  │
│  Token cost: ~200 (included on briefing)  │
│  Storage: Firestore meta/ai doc           │
│  Rotation: daily→weekly→monthly summary   │
│  Buffer: 30 daily, 12 weekly              │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│     PREFERENCE MEMORY                     │
│  Extracted user patterns                  │
│  Timezone, dietary preferences            │
│  Custom instructions (free text)          │
│  Dismissed suggestion types + counts      │
│  Preferred entity kinds (from frequency)  │
│  ─────────────────────────────────────    │
│  Lifetime: permanent (settings doc)       │
│  Token cost: ~100 (always in system inst) │
│  Storage: Firestore settings doc          │
└──────────────────────────────────────────┘
```

**Token cap enforcement:**
- Working memory: capped at HISTORY_WINDOW (currently 12 → reduce to 10)
- Context entities: capped at 20 most relevant (scored by `calculateRelevance()`)
- Auto-summarization trigger: when `messages.length > 10`, `summarizeOlderMessages()` runs (no LLM, local extraction)
- If context exceeds 7K tokens: drop lowest-relevance entities until under budget
- **Total per turn: ≤7000 tokens input + model response ≈ 8000-10000 tokens**

### 3.3 Trigger System

| Trigger | When | What Runs | Token Budget | LLM Calls |
|---------|------|-----------|-------------|-----------|
| `app_open` | First open of the day (debounced, 1x per 6hr) | Daily briefing + streak check + deadline scan | 2000 | 1 |
| `midnight` | 00:00 local (via `setTimeout`) | Day summary, streak rollover, missed deadline flagging | 1500 | 1 |
| `streak_risk` | Habit streak will break if not logged by EOD | Push notification (no LLM call) | 0 | 0 |
| `missed_deadline` | Entity with `deadline < now` AND `status != COMPLETED` | Surface warning card on dashboard | 0 | 0 |
| `idle_gap` | No interaction 3+ hours during waking hours | **No action.** Do not interrupt. | 0 | 0 |
| `weekly_review` | Sunday 8PM local (configurable) | Weekly insights generation | 3000 | 1 |
| `manual` | User clicks "Analyze" or asks for review | Full graph analysis | Unbounded | N |

**Critical: `idle_gap` does NOT trigger an LLM call.** Proactive interruption during idle time is hostile UX.

### 3.4 Agent Event Loop

```
on trigger(event):
  1. Check rate limit (max 10 agent runs per hour)
  2. Check token budget for trigger type
  3. Build minimal context:
     - Active entities with deadlines in next 48h
     - Habits with streak info
     - Today's completed items
     - Last daily summary (if exists)
  4. Run planner:
     - Single LLM call with structured output
     - System: "You are Flowmate's background agent. Analyze and return findings."
     - Output schema: { findings: [{ type, severity, entity_id?, message, suggested_ops? }] }
  5. Filter findings:
     - Drop if type was dismissed 3+ times (preference memory)
     - Drop if severity < threshold for time of day
  6. Surface findings:
     - CRITICAL (missed deadline, streak break): toast notification
     - INFORMATIONAL (weekly insight, suggestion): dashboard card
     - PROPOSED_OPS (entity changes): queue in pendingOrchestration → user approval
  7. Reflection:
     - If user dismisses: increment dismiss count for finding type
     - If user acts on it: increment engagement count
     - Adjust future thresholds
```

### 3.5 Safety Boundaries

| Rule | Enforcement |
|------|-------------|
| Agent never mutates entities directly | All suggested ops go through `pendingOrchestration` → user approval → `applyOperations()` |
| Max 3 notifications per day (excluding user-initiated) | Counter in preference memory, checked before surfacing |
| Agent never reads entities with `metadata.private: true` | Filter applied in context building |
| Agent calls wrapped in circuit breaker | Same `withRetry` + circuit breaker as chat |
| Circuit breaker open → agent silently skips | No fallback, no error toast |
| Read-only autonomous operations | Autonomous triggers can only READ entities and SURFACE findings, never WRITE |
| High-risk actions require confirmation | Any `delete_entity`, `archive_entity`, or bulk operations → confirmation dialog |

---

## 4. Entity System Normalization

### 4.1 Current Problems

1. **Flat array storage:** `entities: Entity[]` requires O(n) lookup. Every `findEntityByTitle`, `resolveEntityId`, and relationship resolution iterates the full array.
2. **Untyped metadata:** `metadata: Record<string, any>` — habit streaks, subtasks, activity logs, food data all in one untyped bag.
3. **Dead kinds:** `COURSE`, `TOPIC`, `ROLE` exist in enum but are never handled in store, executors, or UI.
4. **Field name confusion:** `streak` vs `streak_current`, `is_done` vs `completed`, `last_interaction` vs `last_completed_at` — mismatches between types.ts definitions and AI executors. **(Now fixed in executors.ts)**

### 4.2 Data Structure: `Entity[]` → `Map<id, Entity>`

```typescript
// In Zustand store — replaces entities: Entity[]
entities: Map<string, Entity>
```

**Performance comparison:**

| Operation | `Entity[]` (Current) | `Map<string, Entity>` (Target) |
|-----------|---------------------|-------------------------------|
| Find by ID | O(n) — `.find(e => e.id === id)` | O(1) — `.get(id)` |
| Check existence | O(n) — `.find()` | O(1) — `.has(id)` |
| Get count | O(1) — `.length` | O(1) — `.size` |
| Iterate all | O(n) — `for...of` | O(n) — `.values()` |
| Add entity | O(1) — `.push()` | O(1) — `.set(id, entity)` |
| Delete entity | O(n) — `.filter()` | O(1) — `.delete(id)` |
| Update entity | O(n) — `.map()` | O(1) — `.set(id, updated)` |
| Get children | O(n) — filter all | O(k) — `relationshipIndex.byFrom.get(id)` |

### 4.3 Derived Indexes

Computed on hydration and after any entity/relationship mutation. **Not persisted.**

```typescript
interface DerivedIndexes {
  byKind: Map<EntityKind, Set<string>>;           // kind → entity IDs
  byStatus: Map<EntityStatus, Set<string>>;       // status → entity IDs
  byTag: Map<string, Set<string>>;                // tag title → entity IDs
  byParent: Map<string, Set<string>>;             // parent ID → child entity IDs
  relationshipsFrom: Map<string, Relationship[]>; // entity ID → outgoing rels
  relationshipsTo: Map<string, Relationship[]>;   // entity ID → incoming rels
}

// Rebuild function (called after any mutation)
function rebuildIndexes(
  entities: Map<string, Entity>,
  relationships: Relationship[]
): DerivedIndexes { ... }
```

**Query efficiency with indexes:**

| Query | Without Indexes | With Indexes |
|-------|----------------|-------------|
| All tasks | O(n) filter | O(1) lookup `byKind.get(TASK)` |
| Active goals | O(n) filter × 2 | O(1) intersect `byKind.get(GOAL)` ∩ `byStatus.get(ACTIVE)` |
| Entity children | O(n) filter rels + O(n) lookup entities | O(k) `byParent.get(parentId)` |
| Graph neighbors | O(n²) scan all rels then all entities | O(k) `relationshipsFrom.get(id)` where k = neighbor count |
| Tagged entities | O(n) filter → check canonical_tags | O(1) `byTag.get(tagTitle)` |

### 4.4 Type-Safe Metadata: `EntityMetadata<K>`

Replace `metadata: Record<string, any>` with a generic type that narrows based on EntityKind:

```typescript
// Generic metadata type that provides compile-time safety
type EntityMetadata<K extends EntityKind> =
  K extends EntityKind.HABIT ? HabitMetadata & CommonMetadata :
  K extends EntityKind.TASK ? TaskMetadata & CommonMetadata :
  K extends EntityKind.EVENT ? EventMetadata & CommonMetadata :
  K extends EntityKind.GOAL ? GoalMetadata & CommonMetadata :
  K extends EntityKind.PROJECT ? ProjectMetadata & CommonMetadata :
  K extends EntityKind.PERSON ? PersonMetadata & CommonMetadata :
  K extends EntityKind.PROMISE ? PromiseMetadata & CommonMetadata :
  K extends EntityKind.NOTE ? NoteMetadata & CommonMetadata :
  CommonMetadata;

interface CommonMetadata {
  archived?: boolean;
  deleted?: boolean;
  activity_log?: ActivityLogEntry[];
  _legacy?: Record<string, any>;  // Migration bucket for unknown fields
}

interface TaskMetadata {
  subtasks?: Subtask[];
  productivity?: ProductivityType;
}

interface EventMetadata {
  rrule?: string;
  location?: string;
  gcal_id?: string;
  gcal_link?: string;
}

interface GoalMetadata {
  progress?: number;      // 0-100
  subtasks?: Subtask[];
  milestones?: string[];
}

interface ProjectMetadata {
  subtasks?: Subtask[];
  completion_percentage?: number;
}

interface NoteMetadata {
  content_format?: 'markdown' | 'plain';
}

// TypeScript narrows metadata based on kind:
// if (entity.kind === EntityKind.HABIT) {
//   entity.metadata.streak_current  // ← fully typed, no `any`
// }
```

**Migration approach:** Since generic Entity type with kind-dependent metadata requires a discriminated union or assertion pattern, keep the runtime Entity interface using `Record<string, any>` but provide type guard functions:

```typescript
function isHabitEntity(e: Entity): e is Entity & { metadata: HabitMetadata & CommonMetadata } {
  return e.kind === EntityKind.HABIT;
}
function isTaskEntity(e: Entity): e is Entity & { metadata: TaskMetadata & CommonMetadata } {
  return e.kind === EntityKind.TASK;
}
// ... etc for each kind
```

### 4.5 Dead Kind Removal

Remove from `EntityKind` enum:
- `COURSE` — never handled in store, executors, or UI. Use PROJECT.
- `TOPIC` — never handled. Use TAG or NOTE.
- `ROLE` — never handled. Use CONTEXT.

**Migration:** On store hydration (version 15 → 16), remap:
- `COURSE` → `PROJECT`
- `TOPIC` → `TAG`
- `ROLE` → `CONTEXT`

### 4.6 Schema Versioning & Migration

**Store version:** 15 → 16

```typescript
// Migration v15 → v16
if (version < 16) {
  // 1. Normalize metadata field names
  entities.forEach(e => {
    if (e.metadata?.streak !== undefined) {
      e.metadata.streak_current = e.metadata.streak;
      delete e.metadata.streak;
    }
    if (e.metadata?.last_interaction !== undefined) {
      e.metadata.last_completed_at = e.metadata.last_interaction;
      delete e.metadata.last_interaction;
    }
  });

  // 2. Remap dead kinds
  entities.forEach(e => {
    if (e.kind === 'COURSE') e.kind = EntityKind.PROJECT;
    if (e.kind === 'TOPIC') e.kind = EntityKind.TAG;
    if (e.kind === 'ROLE') e.kind = EntityKind.CONTEXT;
  });

  // 3. Clean up orphaned relationships
  const entityIds = new Set(entities.map(e => e.id));
  relationships = relationships.filter(r => entityIds.has(r.from) && entityIds.has(r.to));

  // 4. Prune completed syncQueue items
  syncQueue = syncQueue.filter(item => item.status === 'pending' || item.status === 'in_progress');
}
```

---

## 5. Graph Engine Scalability

### 5.1 Current Problems

- `GraphView.tsx` (806 LOC) runs D3 force simulation on the main thread
- All nodes rendered regardless of viewport
- No level-of-detail — 1000 nodes = 1000 SVG circles + labels + edges
- Mobile degrades past ~200 nodes

### 5.2 Performance Tiers (Auto-Detected)

```typescript
type PerformanceTier = 'high' | 'medium' | 'low' | 'potato';

function detectPerformanceTier(nodeCount: number): PerformanceTier {
  const cpuCores = navigator.hardwareConcurrency || 2;
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  const memoryGB = (navigator as any).deviceMemory || 4;

  if (isMobile || memoryGB < 2) {
    return nodeCount > 100 ? 'potato' : 'low';
  }
  if (nodeCount > 2000 || cpuCores < 4) return 'low';
  if (nodeCount > 500) return 'medium';
  return 'high';
}
```

| Tier | Node Limit | Rendering | Simulation | Labels | FPS Target |
|------|-----------|-----------|------------|--------|-----------|
| **High** | < 500 | SVG (full detail) | D3 force, main thread | All visible | 60 |
| **Medium** | 500-2000 | SVG + viewport culling | D3 force, Web Worker | Hover + selected | 30 |
| **Low** | 2000-5000 | Canvas rendering | Web Worker, alpha decay 0.3 | Selected only | 15 |
| **Potato** | 5000+ or mobile | Static layout (no simulation) | None (grid/tree layout) | On tap/hover | 0 (static) |

### 5.3 Progressive Rendering

**Viewport Culling (Medium+ tiers):**
```typescript
function getVisibleNodes(
  allNodes: SimNode[],
  viewBox: { x: number; y: number; width: number; height: number },
  margin: number = 200
): SimNode[] {
  const expanded = {
    x: viewBox.x - margin,
    y: viewBox.y - margin,
    width: viewBox.width + 2 * margin,
    height: viewBox.height + 2 * margin,
  };
  return allNodes.filter(n =>
    n.x >= expanded.x && n.x <= expanded.x + expanded.width &&
    n.y >= expanded.y && n.y <= expanded.y + expanded.height
  );
}
```

Edges with both endpoints outside viewport are also culled.

**Level-of-Detail (LOD):**
```
High detail:    Node circle + label + status badge + connection count
Medium detail:  Node circle + abbreviated label (first 8 chars)
Low detail:     Node circle only (color = kind)
```

LOD selected per-node based on: zoom level × node priority × distance from viewport center.

**Throttled Simulation:**
```typescript
// Adaptive tick rate based on performance tier
const tickRate = {
  high: 0,      // requestAnimationFrame (60fps)
  medium: 33,   // ~30fps
  low: 66,      // ~15fps
  potato: 0,    // No simulation
};

// Quality degradation: reduce forces when laggy
simulation
  .force('charge', d3.forceManyBody().strength(tier === 'high' ? -300 : -100))
  .alpha(tier === 'high' ? 1 : 0.3)  // Faster stabilization
  .alphaDecay(tier === 'high' ? 0.0228 : 0.05);
```

### 5.4 Web Worker Offloading

```
Main thread                          Worker thread
─────────────                        ─────────────
Send: { nodes, links, config }  →
                                     Run d3.forceSimulation()
                                     On each tick:
                                ←    Send: { positions: [{id, x, y}...] }
Batch DOM update (rAF)
```

**Implementation:**
- Create `workers/graphSimulation.worker.ts`
- Use `new Worker(new URL(..., import.meta.url))` (Vite-native)
- Transfer via `postMessage` (structured clone)
- Main thread handles rendering + interaction events only
- Kill worker on component unmount

### 5.5 Mobile Fallback

On screens < 768px, **replace** force-directed graph with:
- **Entity List** grouped by Context/Project (tree view)
- **Mini-map** showing graph overview (read-only, 200×200px canvas)
- Tap entity → EntityDetailPanel (bottom sheet modal)
- No force simulation on mobile

This is better UX — force-directed graphs on touch devices are unusable.

**Target: 500 nodes (SVG) → 5000 nodes (Canvas/static layout)**

---

## 6. UI/UX System Specification

### 6.1 Design Token System

```css
/* index.css @theme block (TailwindCSS 4) */
@theme {
  /* Typography Scale (modular, 1.25 ratio) */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --text-xs:   0.75rem;   /* 12px */
  --text-sm:   0.875rem;  /* 14px */
  --text-base: 1rem;      /* 16px */
  --text-lg:   1.125rem;  /* 18px */
  --text-xl:   1.25rem;   /* 20px */
  --text-2xl:  1.5rem;    /* 24px */

  /* Spacing Scale (4px base) */
  --space-1:  0.25rem;   /* 4px  */
  --space-2:  0.5rem;    /* 8px  */
  --space-3:  0.75rem;   /* 12px */
  --space-4:  1rem;      /* 16px */
  --space-6:  1.5rem;    /* 24px */
  --space-8:  2rem;      /* 32px */
  --space-12: 3rem;      /* 48px */

  /* Color Semantics — Slate base */
  --color-surface-primary:   theme('colors.slate.950');
  --color-surface-secondary: theme('colors.slate.900');
  --color-surface-elevated:  theme('colors.slate.800');
  --color-border-default:    theme('colors.slate.700/50');
  --color-text-primary:      theme('colors.slate.100');
  --color-text-secondary:    theme('colors.slate.400');
  --color-text-muted:        theme('colors.slate.500');

  /* Semantic Colors */
  --color-accent:    theme('colors.blue.500');
  --color-success:   theme('colors.emerald.500');
  --color-warning:   theme('colors.amber.500');
  --color-danger:    theme('colors.red.500');

  /* Entity Kind Colors (consistent across graph/list/detail) */
  --color-kind-goal:     theme('colors.amber.500');
  --color-kind-project:  theme('colors.blue.500');
  --color-kind-task:     theme('colors.emerald.500');
  --color-kind-event:    theme('colors.violet.500');
  --color-kind-habit:    theme('colors.rose.500');
  --color-kind-note:     theme('colors.slate.400');
  --color-kind-context:  theme('colors.cyan.500');
  --color-kind-person:   theme('colors.orange.500');

  /* Motion */
  --duration-fast:   100ms;
  --duration-normal: 200ms;
  --duration-slow:   300ms;
  --ease-default:    cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring:     cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Radii */
  --radius-sm:  0.375rem;  /* 6px  */
  --radius-md:  0.5rem;    /* 8px  */
  --radius-lg:  0.75rem;   /* 12px */
  --radius-xl:  1rem;      /* 16px */
  --radius-full: 9999px;
}
```

### 6.2 Component Library Extraction

Extract from existing inline patterns into reusable primitives:

| Component | Source | Description |
|-----------|--------|-------------|
| `Button` | Inline across 20+ components | Primary, secondary, ghost, danger variants. Size sm/md/lg. |
| `Card` | Repeated div patterns | Surface container with border, padding, hover states. |
| `Modal` | `AuthModal`, `CreateEntityModal`, etc. | Backdrop + centered panel + close button + transition. |
| `Input` | Inline form fields | Text, textarea with label, error state, disabled state. |
| `Badge` | Inline entity kind indicators | Colored pill with text. Maps to entity kind colors. |
| `Sheet` | Mobile detail panels | Bottom sheet with drag handle, snap points. |
| `EmptyState` | Already exists but not systematically used | Icon + title + description + CTA button. |

### 6.3 Mobile-First PWA Patterns

**Layout:**
```
┌────────────────────────┐
│      Status Bar        │  (system)
├────────────────────────┤
│                        │
│     Content Area       │  (scrollable, reduced density)
│                        │
├────────────────────────┤
│    Chat Input Bar      │  (fixed, 56px)
├────────────────────────┤
│ Home │Cal │+ │Graph│Set│  (bottom nav, 56px, 44px touch targets)
└────────────────────────┘
```

**Interaction Matrix:**

| Pattern | Desktop | Mobile |
|---------|---------|--------|
| Entity selection | Click | Tap |
| Entity detail | Side panel (400px right) | Bottom sheet (full height) |
| Context menu | Right-click | Long press |
| Navigation | Sidebar (left, collapsible) | Bottom tab bar (5 tabs) |
| Quick capture | `Ctrl+K` command palette | FAB → bottom sheet |
| Graph | Force-directed SVG | Tree/list view |
| Modal dismiss | Escape / backdrop | Swipe down / backdrop |

**Touch target minimum:** 44×44px (already enforced).

### 6.4 Consistent Interaction Patterns

**Glanceability rules** — every dashboard card answers one question at a glance:
- **Briefing:** "What should I focus on?" → 1-2 sentences, bold key entities
- **Streak:** "Am I on track?" → Green/Amber/Red indicator
- **Calendar:** "What's next?" → Next event with time, max 3 visible
- **Progress:** "How much did I do?" → Single percentage or hour count
- Max 20 words per card to understand

**Entity color consistency:** Same color for same kind everywhere (graph node, list badge, detail header, calendar event). Enforced via design tokens `--color-kind-*`.

---

## 7. Cost Control & Observability

### 7.1 Token Budget Model

| Operation | Max Input | Max Output | Est. Cost (Gemini 2.5 Flash) |
|-----------|-----------|------------|------------------------------|
| Chat turn | 7,000 tokens | 2,000 tokens | ~$0.0003 |
| Daily briefing | 3,000 | 500 | ~$0.0001 |
| Weekly insights | 5,000 | 1,000 | ~$0.0002 |
| Text improvement | 1,000 | 1,000 | ~$0.0001 |
| Knowledge query | 4,000 | 500 | ~$0.0002 |
| Graph fix chunk | 3,000 | 1,000 | ~$0.0002 |
| Agent trigger | 3,000 | 500 | ~$0.0001 |

**Daily budget per user (heavy usage):**
- 30 chat turns: ~$0.009
- 1 briefing + 1 agent: ~$0.0002
- 5 text improvements: ~$0.0005
- **Total: ~$0.01/day per active user**
- **10,000 users, 30% DAU: ~$30/day = ~$900/month**

### 7.2 Circuit Breakers

Already implemented in `utils/apiRetry.ts`. Current config: 3 retries, exponential backoff, jitter.

**Enhancement — state machine:**
```
CLOSED → (5 failures in 5 min) → OPEN
OPEN → (wait 30s) → HALF_OPEN
HALF_OPEN → (1 success) → CLOSED
HALF_OPEN → (1 failure) → OPEN

When OPEN:
  - Skip all LLM calls
  - Return fallback responses ("AI temporarily unavailable")
  - Surface banner in UI
  - Agent triggers silently skipped
```

### 7.3 Rate Limiting

```typescript
// Per-user limits (client-side enforced)
const RATE_LIMITS = {
  chat: { max: 60, windowMs: 3600_000 },        // 60/hour
  briefing: { max: 3, windowMs: 86400_000 },    // 3/day
  agent: { max: 10, windowMs: 3600_000 },        // 10/hour
  textImprove: { max: 20, windowMs: 3600_000 }, // 20/hour
  knowledge: { max: 20, windowMs: 3600_000 },   // 20/hour
};

// Implementation: module-level timestamp array
// On each call: filter to current window, check count
// Over limit: return cached/default, surface toast
```

### 7.4 Conversation Summarization Triggers

| Trigger | Condition | Action |
|---------|-----------|--------|
| Auto-summarize | `messages.length > 10` | `summarizeOlderMessages()` — local, no LLM |
| Daily summary | Midnight trigger | 1 LLM call, ~500 tokens, stored in `meta/ai` |
| Weekly summary | Sunday trigger | 1 LLM call, ~1000 tokens, stored in `meta/ai` |
| Context truncation | Entity context > 4000 tokens | Drop lowest-relevance entities |

### 7.5 Error Tracking & Crash Recovery

| Error Type | Detection | Recovery |
|------------|-----------|----------|
| React render crash | `ErrorBoundary` (already implemented) | Fallback UI + "Reload" button |
| Zustand hydration failure | try/catch in `onRehydrateStorage` | Clear corrupted storage, fresh start, toast |
| Firestore write failure | `withRetry` + circuit breaker | Retry 3x → offline queue → dead-letter |
| Gemini API failure | `withRetry` + circuit breaker | Retry 3x → fallback message |
| Auth token expiry | Pre-flight check (implemented) | Silent refresh → retry original call |
| Network loss | `navigator.onLine` listener | Offline mode, queue writes |

### 7.6 Data Corruption Detection

```
On hydration (app start):
  1. Validate entity schema (id, kind, title, status, created_at, updated_at)
  2. Validate kind/status are valid enum values
  3. Detect orphaned relationships (from/to points to nonexistent entity)
  4. If >10% entities fail validation:
     - Surface "Data integrity issue" warning
     - Offer "Repair" button (runs graph analyzer)
     - Do NOT silently drop data
  5. Relationships pointing to soft-deleted entities → flag for cleanup
```

Already partially implemented in `utils/validation.ts`. Needs: orphan detection, threshold alert, integration with hydration callback.

### 7.7 Observability Stack

| Layer | Tool | What |
|-------|------|------|
| Client errors | `window.onerror` + ErrorBoundary | Uncaught exceptions, render errors |
| API errors | Structured console + DebugConsole | Gemini/Firestore/auth failures |
| Performance | `web-vitals` library | LCP, FID, CLS, INP |
| User actions | Debug log ring buffer (200 max) | View changes, mutations, sync events |

**No external service for V4.** DebugConsole is the observability layer. Add Sentry in V5.

---

## 8. Production Readiness Assessment

### 8.1 Current State (V3): **No**

Critical gaps:
- ~~Flat arrays limit scalability~~ → Map conversion planned (Week 3-4)
- ~~Timestamp conflicts across devices~~ → LWW with syncVersion designed (Week 3-4)
- ~~Unbounded memory growth~~ → ~~syncQueue capped~~, message pagination planned
- ~~Field name mismatches causing silent data loss in AI~~ → **Fixed**
- ~~Dead code polluting bundle~~ → **Agent scaffold deleted**, dead types to clean
- ~~Auth token silently expires~~ → **Fixed with expiry tracking**
- ~~AI client uses wrong env var~~ → **Fixed**

### 8.2 Target State (V4): **Yes, with phased rollout**

**What's ready now (after this session's fixes):**
- Auth + security rules (strict per-user isolation)
- AI tool calling with correct field names
- Token expiry handling
- Incremental Firestore sync (not full re-write)
- Capped syncQueue (max 200 items, done/failed pruned)
- 60 passing tests, 414KB bundle

**What's needed before 10K users:**
1. Entity Map conversion (O(1) lookups) — Week 3-4
2. Message pagination in Firestore — Week 3-4
3. Rate limiting on AI calls — Week 5
4. Data export/backup — Week 9
5. Offline support testing — Week 9
6. Graph performance at scale — Week 7-8

**Acceptable risks:**
- No server-side infrastructure (acceptable for personal productivity app)
- No external error monitoring (debug console sufficient for early users)
- Gemini costs scale linearly (~$900/month at 10K DAU × 30%)

---

## 9. Execution Roadmap (10-Week Phased)

### Week 1-2: Critical Bug Fixes + Store Hardening ✅ (Partially Complete)

| Task | Status | File(s) |
|------|--------|---------|
| Fix duplicate `delete_entity` — keep soft-delete | ✅ Done | `store.ts` |
| Fix `log_food` race condition — synchronous `set()` | ✅ Done | `store.ts` |
| Fix AI executor field mismatches | ✅ Done | `services/ai/executors.ts` |
| Fix `process.env` → `import.meta.env` in AI client | ✅ Done | `services/ai/client.ts` |
| Add `'warning'` to Toast type union | ✅ Done | `types.ts` |
| Add `'error'`/`'warning'` to DebugLogEntry type | ✅ Done | `types.ts` |
| Add `autoArchiveStaleEntities` to interface | ✅ Done | `store.ts` |
| Cap syncQueue (max 200, prune done/failed) | ✅ Done | `store.ts` |
| Delete empty `services/agent/` scaffold | ✅ Done | filesystem |
| Fix `auth` typing (`any` → `Auth \| null`) | ✅ Done | `services/firebase.ts` |
| Add Google token expiry tracking | ✅ Done | `services/firebase.ts` |
| Fix `syncOperation` — incremental, not full re-write | ✅ Done | `services/firestoreSync.ts` |
| Fix double-fetch on auth (remove redundant `loadFromCloud`) | ✅ Done | `App.tsx` |
| Remove dead EntityKinds (COURSE, TOPIC, ROLE) | Planned | `types.ts` |
| Remove dead types (MessMenuEntry if unused) | Planned | `types.ts` |
| Wire `syncStatus` via store actions (not `setState`) | Planned | `store.ts` |

**Deliverable:** Zero critical bugs. Store is correct. Sync is wired.

### Week 3-4: Entity Model + Sync Upgrade

| Task | File(s) | Effort |
|------|---------|--------|
| Convert `entities: Entity[]` → `Map<string, Entity>` | `store.ts`, all components | 6h |
| Add persist serialization (Map ↔ Object) | `store.ts`, `services/storage` | 2h |
| Add derived indexes (byKind, byStatus, byTag, byParent, relFrom/To) | `store.ts` | 3h |
| Add type-safe metadata (type guards per kind) | `types.ts` | 4h |
| Store migration v15 → v16 (field normalization, kind remapping) | `store.ts` | 3h |
| Update all component metadata access patterns | 48 components | 8h |
| Add messages subcollection to Firestore | `services/firestoreSync.ts` | 3h |
| Add Firestore composite indexes | `firebase.json` | 1h |
| Implement conflict resolution with syncVersion | `services/firestoreSync.ts` | 3h |

**Deliverable:** O(1) entity lookups. Typed metadata. Paginated messages. Version-based conflict resolution.

### Week 5-6: Agent System + Memory

| Task | File(s) | Effort |
|------|---------|--------|
| Create `services/agent/` with proper implementation | `services/agent/*.ts` | — |
| Implement trigger system (app_open, midnight, weekly, manual) | `services/agent/triggers.ts` | 4h |
| Implement planner (context assembly + single LLM call → structured findings) | `services/agent/planner.ts` | 4h |
| Implement executor (tool dispatch, rate limiting, max 3 LLM calls per trigger) | `services/agent/executor.ts` | 3h |
| Implement reflection (dismiss tracking, threshold tuning) | `services/agent/reflection.ts` | 3h |
| Implement memory persistence (daily/weekly summaries in meta/ai) | `services/agent/memory.ts` | 4h |
| Implement goal monitor (stalled goals, conflicting deadlines) | `services/agent/goals.ts` | 3h |
| Add rate limiting module (per-operation counters) | `utils/rateLimiter.ts` | 2h |
| Enhance circuit breaker with CLOSED→OPEN→HALF_OPEN state machine | `utils/apiRetry.ts` | 2h |
| Wire agent triggers into App lifecycle | `App.tsx` | 2h |
| Add agent findings UI (dashboard cards with dismiss/act buttons) | `components/AgentFindings.tsx` | 4h |
| Reduce HISTORY_WINDOW from 12 to 10 | `services/ai/client.ts` | 5m |

**Deliverable:** Agent runs on app_open, midnight, weekly. Surfaces findings. Tracks dismissals. Memory persisted.

### Week 7-8: Graph Engine + UI Hardening

| Task | File(s) | Effort |
|------|---------|--------|
| Add performance tier auto-detection (high/medium/low/potato) | `components/GraphView.tsx` | 2h |
| Implement viewport culling | `components/GraphView.tsx` | 4h |
| Create Web Worker for force simulation | `workers/graphSimulation.worker.ts` | 6h |
| Implement LOD (high/medium/low detail per node) | `components/GraphView.tsx` | 4h |
| Throttled simulation (adaptive FPS by tier) | `components/GraphView.tsx` | 3h |
| Mobile: tree/list view replacing graph | `components/GraphView.tsx` | 4h |
| Implement design token system in CSS | `index.css` | 2h |
| Extract component library (Button, Card, Modal, Input, Badge) | `components/ui/` | 6h |
| Add bottom nav for mobile | `components/layout/MobileNav.tsx` | 3h |
| EntityDetailPanel as bottom sheet on mobile | `components/EntityDetailPanel.tsx` | 3h |
| Reorganize 48 components into subdirectories | filesystem + imports | 3h |

**Deliverable:** Graph scales to 5000 nodes. Mobile is usable. Consistent visual language.

### Week 9: Testing + Production Hardening

| Task | File(s) | Effort |
|------|---------|--------|
| Entity model tests (Map operations, migration, type guards) | `tests/entityModel.test.ts` | 4h |
| Sync integration tests (mock Firestore, conflict resolution) | `tests/sync.test.ts` | 4h |
| Agent trigger/planner tests | `tests/agent.test.ts` | 3h |
| Implement data export (JSON + Markdown ZIP) | `services/export.ts` | 3h |
| Implement auto-backup (24h cycle, 3 slots in localStorage) | `services/backup.ts` | 2h |
| Data corruption detection on hydration (orphan check, threshold alert) | `utils/validation.ts` + `store.ts` | 2h |
| Add `web-vitals` performance tracking | `index.tsx` | 1h |
| Ring buffer for debug logs (cap at 200, already partially done) | `store.ts` | 30m |

**Deliverable:** 100+ tests. Data backup. Corruption detection. Performance monitoring.

### Week 10: Repo Cleanup + Public Release

| Task | File(s) | Effort |
|------|---------|--------|
| Move source into `src/` directory | filesystem + `vite.config.ts` | 2h |
| Group components into subdirectories (core, views, features, chat, layout, ui) | filesystem + imports | 3h |
| Delete outdated docs (00-08 analysis files) | filesystem | 30m |
| Rewrite README (architecture decisions, setup, honest limitations) | `README.md` | 2h |
| Write condensed architecture doc | `docs/architecture.md` | 2h |
| Write developer setup guide | `docs/setup.md` | 1h |
| Clean commit history (interactive rebase, meaningful messages) | git | 3h |
| Remove AI-generated tone from comments/docs | full codebase | 2h |
| Remove email auth (Google only) | `services/firebase.ts`, `components/AuthModal.tsx` | 1h |
| Final build + test + deploy to Firebase Hosting | CI | 1h |

**Deliverable:** Public GitHub repository. Professional README. Clean history. Production deployment.

---

## Appendix A: Bugs Fixed This Session

| # | Bug | Severity | Fix |
|---|-----|----------|-----|
| 1 | Duplicate `delete_entity` case — soft delete was dead code | **Critical** | Replaced first case with soft-delete, removed duplicate |
| 2 | `log_food` uses `setTimeout` → race condition + not in history | **Critical** | Synchronous state update via returned object |
| 3 | AI executor: `s.is_done` should be `s.completed` | **High** | Fixed field name |
| 4 | AI executor: `h.metadata?.streak` should be `streak_current` | **High** | Fixed field name |
| 5 | AI executor: `h.metadata?.last_interaction` should be `last_completed_at` | **High** | Fixed field name |
| 6 | `process.env.API_KEY` wrong for Vite | **Critical** | Changed to `import.meta.env.VITE_GEMINI_API_KEY` |
| 7 | `auth` typed as `any` | **Medium** | Changed to `Auth \| null` |
| 8 | Google token persisted without expiry check | **Medium** | Added expiry key + pre-flight check (5min buffer) |
| 9 | `syncOperation()` does full re-write every time | **High** | Incremental sync of affected entities only |
| 10 | Toast type missing `'warning'` | **Low** | Added to union |
| 11 | DebugLogEntry type missing `'error'`/`'warning'` | **Low** | Added to union |
| 12 | `autoArchiveStaleEntities` missing from interface | **Medium** | Added to `FlowmateState` |
| 13 | `syncQueue` grows unbounded, persisted | **High** | Capped at 200, prune done/failed items |
| 14 | Double-fetch: `loadInitialData()` + `loadFromCloud()` | **Medium** | Removed redundant `loadFromCloud()` call |
| 15 | Empty `services/agent/` scaffold (10 files, 0 bytes) | **Medium** | Deleted |

## Appendix B: Metrics

| Metric | Value |
|--------|-------|
| Total LOC | 27,548 |
| Total files | 103 |
| Components | 48 |
| Tests | 60 (3 files) |
| Store version | 15 |
| Bundle (entry) | 414KB |
| Largest file | store.ts (1,350 LOC) |
| Largest component | EntityDetailPanel.tsx (1,110 LOC) |
| Framework | React 19.2.1 + TypeScript 5.8.2 + Vite 6.2.0 |
| State | Zustand 5.0.9 |
| AI model | gemini-2.5-flash |
| AI tools | 7 function declarations |
| AI modules | 6 (client, tools, executors, context, prompts, index) |

# Services Reference

Detailed documentation of backend/logic services.

---

## `geminiService.ts` (~29KB)

**Role**: The Brain. Handles all LLM interactions.

**Key Functions**:

### `orchestrateMessage(history, userText, snapshot, attachment)`
*   Constructs the System Prompt
*   Injects the "Tool Definitions" (Toon Protocol)
*   Injects the "World State" (Relevant parts of the Graph)
*   Calls Gemini API
*   Parses JSON response

### `generateBriefing(snapshot)`
*   Generates the daily briefing markdown
*   **Logic**: Detects time of day (e.g. "Working Late" support for 12AM-4AM)

### `queryKnowledgeBase(query, entities)`
*   Standalone RAG pipeline for the "Ask AI" feature in Knowledge View
*   Retrieves top 20 relevant notes/contexts based on semantic scoring

**Key Concepts**:
*   **Snapshots**: We don't send the entire graph every time (token limits). We send a summary or relevant nodes (RAG-lite).
*   **Context Separation**: While the Service itself is stateless regarding "Channels", the `App.tsx` filters the history passed to this service based on the active `channelId`.
*   **Structured Output**: Uses JSON schema enforcement for reliable operation parsing.

---

## `store.ts` (Zustand) (~81KB)

**Role**: The Spinal Cord. Central state management.

**Key Actions**:

### Entity Management
*   `addEntity`: Create new entity
*   `updateEntity`: Modify entity fields
*   `deleteEntity`: Remove entity
*   `archiveEntity`: Mark as archived

### Relationship Management
*   `addRelationship`: Create edge between entities
*   `removeRelationship`: Delete edge

### Message Management
*   `addMessage`: Uses `channelId` to segregate data
*   Maintains chat history per channel

### Operation Application
*   `applyOperations`: The interpreter for the AI's instructions
    *   Handles `create_entity`, `link_entities`, `schedule_event`, etc.
    *   Contains business logic (e.g., "If I complete a Task, do I complete the Project?")
    *   Triggers side effects (confetti, XP gain)

### Sync
*   `syncToCloud`: Pushes state to Firestore
*   `loadFromCloud`: Fetches and merges state
*   `setSyncStatus`: Updates connection state

### Tracking
*   `addFoodLog`, `deleteFoodLog`: Food tracking
*   `addAttendanceLog`: Attendance tracking
*   `addSubject`, `deleteSubject`: Subject management

---

## `firestoreSync.ts` (~8KB)

**Role**: Cloud Persistence.

**Key Functions**:

### `saveUserData(uid, data)`
*   Serializes full state to Firestore
*   Handles connection errors gracefully

### `loadUserData(uid)`
*   Fetches and returns state
*   Returns null if no data exists

### `setupConnectionMonitor(callback)`
*   Monitors Firebase connection state
*   Triggers callback on connection changes
*   Enables auto-retry logic

---

## `googleSync.ts` (~18KB)

**Role**: Calendar Integration.

**Key Functions**:

### `initTokenClient()`
*   Request OAuth scope (`calendar.events`)
*   Initializes Google Identity Services

### `createEvent(entity)`
*   Maps Flowmate Entity -> GCal Event
*   Stores `gcal_id` in entity metadata

### `updateEvent(entity)`
*   Updates existing GCal event

### `deleteEvent(gcalId)`
*   Removes event from Google Calendar

*Note*: Needs valid Google Cloud Console credentials in `.env.local`.

---

## `graphAnalyzer.ts` (~11KB)

**Role**: Graph Health Analysis.

**Key Functions**:

### `findOrphanNodes(entities, relationships)`
*   Identifies entities with no incoming or outgoing relationships
*   Excludes top-level entity types (GOALs, CONTEXTs)

### `findPotentialDuplicates(entities)`
*   Detects entities with similar titles
*   Uses fuzzy string matching

### `getGraphHealthMetrics(entities, relationships)`
*   Returns overall graph statistics
*   Counts by entity type
*   Relationship density analysis

### `suggestLinks(entity, entities, relationships)`
*   Suggests potential relationships for an entity
*   Based on tags, context, and title similarity

---

## `liveSession.ts` (~10KB)

**Role**: Real-time Voice AI.

**Key Functions**:

### Connection Management
*   `connect()`: Establishes WebSocket to Gemini Live API
*   `disconnect()`: Cleanly closes connection

### Audio Streaming
*   `sendAudioChunk(pcmData)`: Streams audio to API
*   `onTranscription(callback)`: Receives transcribed text
*   `onResponse(callback)`: Receives AI responses

**Audio Format**:
*   PCM encoding/decoding
*   16kHz sample rate

---

## `firebase.ts` (~5KB)

**Role**: Firebase Initialization.

**Key Functions**:

### `initializeFirebase()`
*   Sets up Firebase app with config from environment

### `getAuth()`
*   Returns Firebase Auth instance

### `signInWithEmail(email, password)`
*   Email/password authentication

### `signInWithGoogle()`
*   Google OAuth popup authentication

### `signOut()`
*   Logs out current user

---

## Utility Services (/utils)

### `streakCalculation.ts` (~16KB)
*   `calculateStreak(entity)`: Computes current and best streak
*   `getContributionData(entities)`: Generates GitHub-style contribution data
*   `aggregateByPeriod(entries, period)`: Groups data by day/week/month

### `graphVisibility.ts` (~6KB)
*   `filterVisibleEntities(entities, filters)`: Applies visibility rules
*   Filters: archived, old completed, past events, orphans

### `progressCalculation.ts` (~2KB)
*   `calculateProgress(entity, entities, relationships)`: Computes completion %
*   Based on child entity completion status

### `imageProcessing.ts` (~4KB)
*   `compressImage(file)`: Reduces image size for LLM
*   `toBase64(file)`: Encodes image as base64 string

### `exportMarkdown.ts` (~3KB)
*   `exportToMarkdown(entities, relationships)`: Generates Markdown export
*   Hierarchical structure based on relationships

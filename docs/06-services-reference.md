# Services Reference

Detailed documentation of backend/logic services.

## `geminiService.ts`

**Role**: The Brain. Handles all LLM interactions.

**Key Functions**:
*   `orchestrateMessage(history, userText, snapshot, attachment)`:
    *   Constructs the System Prompt.
    *   Injects the "Tool Definitions" (Toon Protocol).
    *   Injects the "World State" (Relevant parts of the Graph).
    *   Calls Gemini API.
    *   Parses JSON response.
*   `generateBriefing(snapshot)`:
    *   Generates the daily briefing markdown.
    *   **Logic**: Detects time of day (e.g. "Working Late" support for 12AM-4AM).
*   `queryKnowledgeBase(query, entities)`:
    *   Standalone RAG pipeline for the "Ask AI" feature in Knowledge View.
    *   Retrieves top 20 relevant notes/contexts based on semantic scoring.

**Key Concepts**:
*   **Snapshots**: We don't send the entire graph every time (token limits). We send a summary or relevant nodes (RAG-lite).
*   **Context Separation**: While the Service itself is stateless regarding "Channels", the `App.tsx` filters the history passed to this service based on the active `channelId`.

## `store.ts` (Zustand)

**Role**: The Spinal Cord.

**Key Actions**:
*   `addMessage`: Uses `channelId` to segregate data.
*   `applyOperations`: The interpreter for the AI's instructions.
    *   Handles `create_entity`, `link_entities`, `schedule_event`, etc.
    *   Contains business logic (e.g., "If I complete a Task, do I complete the Project?").
*   `syncToCloud`: Pushes state to Firestore.

## `firestoreSync.ts`

**Role**: Cloud Persistence.
*   `saveUserData(uid, data)`: Serializes full state to Firestore.
*   `loadUserData(uid)`: Fetches and merges state.

## `googleSync.ts`

**Role**: Calendar Integration.
*   `initTokenClient()`: Request OAuth scope (`calendar.events`).
*   `createEvent(entity)`: Maps Flowmate Entity -> GCal Event.
*   *Note*: Needs valid Google Cloud Console credentials in `.env.local`.

## `liveSession.ts`

**Role**: Real-time Voice.
*   Manages WebSocket connection to Gemini Live API.
*   Handles audio streaming (PCM encoding/decoding).

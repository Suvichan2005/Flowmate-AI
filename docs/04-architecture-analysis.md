# Architecture Analysis

This document details the system design, data flow, and technical decisions.

## System Architecture

```mermaid
graph TD
    User[User] -->|Interacts| UI[React UI Components]
    UI -->|Reads| Store[Zustand Store]
    UI -->|Dispatches Actions| Store
    
    Subgraph Logic
        Store -->|Persists| LocalStorage[Browser Storage]
        Store -->|Syncs| Firebase[Firebase Firestore]
        Store -->|Orchestrates| Gemini[Gemini 2.0 Flash]
        Store -->|Syncs| GCal[Google Calendar API]
    End
```

## State Management (Single Source of Truth)
The application uses **Zustand** as the central store.
*   **Store File**: `store.ts`
*   **State Structure**:
    *   `entities[]`: Flat list of all nodes.
    *   `relationships[]`: Flat list of all edges.
    *   `messages[]`: Chat history (now field-partitioned by `channelId`).
    *   `settings`: User preferences.

## Data Flow: The "Toon" Loop
1.  **Trigger**: User sends a message.
2.  **Context Assembly**: The system gathers relevant Entities (Simple RAG) + Recent Chat History.
3.  **LLM Call**: The `geminiService` sends this context to Google Gemini with a specialized System Prompt defining the "Toon" tools.
4.  **Structured Output**: Gemini returns a JSON object containing `ops` (operations) and `assistant` (text).
5.  **Application**: `store.applyOperations(ops)` runs. This function contains the business logic (CRUD, linking, validation).
6.  **Reactivity**: React components subscribe to Store changes and re-render the Graph/List/Dashboard.

## External Integrations

### Gemini (AI)
*   Access via `@google/genai` SDK.
*   Uses `gemini-2.0-flash-exp` (or configured model).
*   Tools are defined not as function calls (to avoid roundtrips) but as a structured JSON schema the model must adhere to.

### Firebase (Cloud)
*   **Auth**: Google Sign-In / Email Password.
*   **Firestore**: Document database.
    *   Collection `users/{uid}/data/main` stores the massive JSON blob of the user graph.
    *   *Note*: Currently uses a "Snapshot Sync" (save/load entire state). Granular sync is in the roadmap.

### Google Calendar
*   Direct API usage via Google Identity Services (Client-side token).
*   Maps `EntityKind.EVENT` to GCal Events.
*   Stores `metadata.gcal_id` to maintain link.

## View Architecture

The central `App.tsx` switches `currentView` to render the main content area:
*   `dashboard`: `Dashboard.tsx`
*   `chat_graph`: `GraphView.tsx` (with overlay chat)
*   `schedules`: `SchedulesView.tsx`
*   `calendar`: `CalendarView.tsx`
*   ...and others.

Sidebar and Chat Overlay (Orchestrator) are global persistent elements.

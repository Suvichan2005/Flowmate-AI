# Functional Analysis

This document describes the key user workflows and functional capabilities of Flowmate.

## 1. The Orchestration Workflow (Chat)
**Goal**: Manage the productivity graph through natural language.

1.  **Input**: User types "Add a task to read clean code and link it to the Learning project", or uploads an image of a class schedule.
2.  **Routing**: The message is routed to the active Channel (General, Schedules, Food, Finance).
3.  **Processing**: Gemini AI analyzes the intent + context (current graph snapshot).
4.  **Proposal**: AI returns a JSON plan (`ToonOperation[]`) and a conversational response.
5.  **Execution**: The system executes the operations (Create Task, Link Task) and updates the Store.
6.  **Feedback**: The UI updates immediately; Toast/Confetti confirms success.

## 2. Schedule Management (New)
**Goal**: Digitize recurring commitments and reference material.

1.  **Class Schedule**:
    *   User navigates to **Chat > Schedules**.
    *   User uploads an image of their Time Table.
    *   AI converts this into recurring `EVENT` entities.
    *   User views these in the **Schedules View** or **Calendar View**.
2.  **Mess Menu**:
    *   User uploads a photo of the mess board.
    *   AI stores it as a `NOTE` tagged `#mess-schedule`.
    *   User can ask "What's for lunch?" in the **Food** channel, and AI retrieves this note to answer.

## 3. Knowledge & Information Management
**Goal**: Organize static information.

*   **Tags & Contexts**: First-class citizens. Creating a `#work` tag creates a TAG entity.
*   **Knowledge Graph**: Users can switch the **Graph View** to "Group by Kind" to see clusters of information.
*   **Search**: Users can ask the AI questions about their data ("What goals did I set last week?").

## 4. Calendar & Time Management
**Goal**: Execute tasks in time.

*   **Google Sync**: Two-way synchronization.
    *   Flowmate -> Google: Creating an EVENT in Flowmate pushes to GCal.
    *   Google -> Flowmate: (Planned/Partial) Pulling GCal events into the graph.
*   **Productivity Logging**: When a Focus Session ends, an `ACTIVITY` log is created. These are visible on the Calendar as purple bars.

## 5. Gamification (Momentum)
**Goal**: Sustain motivation.

*   **XP System**: Completed tasks award XP based on priority.
*   **Heatmap**: A visual record of daily activity volume.
*   **Streaks**: Tracking consecutive days of habit completion.

## 6. Offline Principle
**Goal**: Zero latency.

*   All data interaction is local-first (Zustand store).
*   Changes persist to `localStorage` immediately.
*   If Online + Logged In, changes sync to Firestore in the background.
*   If Offline, changes queue up and sync when connection restores.

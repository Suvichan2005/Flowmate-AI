update # Flowmate Ideation Map & Master Plan

This document serves as the comprehensive "Brain Dump" and strategic roadmap for Flowmate. It outlines the core philosophy, the realized features, and the ambitious future of the platform.

## 1. Core Philosophy: "Life is a Graph, Not a List"

Most productivity tools treat life as a linear list of tasks. Flowmate treats life as a **connected graph**.
*   **Context over Isolation**: A task isn't just "Do X". It is "Do X for Project Y to achieve Goal Z, fulfilling Promise A to Person B."
*   **AI as Orchestrator**: The AI isn't a chatbot; it is an *operator*. It has "hands" (Tools/Operations) to manipulate the graph.
*   **Frictionless Capture**: Whether voice, text, or image, the barrier to entry into the system must be near zero.

---

## 2. The "Toon" Protocol (Token-Oriented Object Notation)

Toon is the internal language the AI uses to manipulate the graph. It is the bridge between Natural Language and Graph Operations.

- **`create_entity`**: Spawning new nodes (Task, Event, Goal, etc.)
- **`link_entities`**: creating semantic edges (FULFILLS, DEPENDS_ON, PROMISED_TO)
- **`log_activity`**: Recording history (Work sessions, meals, spending)
- **`schedule_event`**: Blocking time on the calendar
- **`update_metadata`**: Specific updates (Food macros, Spend amount, Streak count)

---

## 3. The Entity Ontology (The "Atoms" of Flowmate)

### Level 1: Productivity (Implemented)
*   **GOAL**: High-level objectives ("Become an ML Engineer")
*   **PROJECT**: Concrete containers of work ("Build Portfolio App")
*   **TASK**: Actionable items ("Write README")
*   **EVENT**: Time-bound commitments ("Class at 10 AM")
*   **NOTE**: Unstructured information ("Meeting minutes")

### Level 2: Context & Organization (Implemented)
*   **TAG**: Categorization (#urgent, #work)
*   **CONTEXT**: Where/How (@home, @laptop)
*   **ACTIVITY**: A record of past action (Focus session log)

### Level 3: Lifestyle (In Progress/Partial)
*   **CLASS_SCHEDULE**: Recurring academic events.
*   **MESS_MENU**: Daily nutrition plan reference.
*   **FOOD_LOG**: Intake tracking (mapped to Activity or specific Metadata).
*   **TRANSACTION**: Financial spend (mapped to metadata/custom entity).

### Level 4: The "Social Brain" (Flowmate 3.0 - Planned)
*   **PERSON**: A node representing a human being.
*   **PROMISE**: A commitment made TO a Person.
    *   *State*: Pending -> Fulfilled | Broken
*   **OPPORTUNITY**: A potential value node (Lead, Contest, Job).
*   **MINI_STREAK**: Lightweight tracking for daily habits (Reading, Coding).

---

## 4. Modules & Feature Map

### A. The Dashboard (Command Center)
- [x] **Momentum Heatmap**: GitHub-style daily activity visualization.
- [x] **Goal Progress Radar**: Circular progress rings for top goals.
- [x] **Quick Actions**: "Start Focus", "Add Task".
- [x] **Daily Briefing**: AI-generated summary of the day.

### B. The Orchestrator (Chat)
- [x] **Multi-Channel**: Segregated contexts (General, Schedules, Food, Finance).
- [x] **Tool Use**: AI can call ~10 distinct operations.
- [x] **Multimodal**: Accepts images (schedules, receipts) and audio.

### C. The Graph View (Visual Brain)
- [x] **D3 Force Simulation**: Physics-based layout.
- [x] **Semantic Grouping**: "Group by Kind" to organize nodes into clusters.
- [x] **Visual Linking**: Shift+Drag to connect nodes.
- [x] **Filtering**: Toggle visibility of specific node types.

### D. Calendar (Time)
- [x] **Drag & Drop**: Reschedule events easily.
- [x] **Google Sync**: Two-way sync with Google Calendar.
- [x] **Productivity Logs**: See past "Focus Sessions" alongside future "Events".

### E. Schedules & Lifestyle (New!)
- [x] **Class Schedule**: Support for recurring events derived from images.
- [x] **Mess Menu**: Digital reference for daily meals.
- [ ] **Food Tracker**: Dedicated UI for macros/calories (Currently automated via chat).
- [ ] **Finance Tracker**: Dedicated UI for spending visualization.

---

## 5. Technical Architecture

### Frontend
*   **Framework**: React 19 + TypeScript (Vite).
*   **State**: Zustand (Store.ts is the 'Single Source of Truth').
*   **Persistence**: `localStorage` (Instant load) + `Firebase Firestore` (Cloud Backup).

### AI Layer
*   **Model**: Google Gemini 2.0 Flash (Low latency, high reasoning).
*   **Methodology**: System Prompt Engineering -> JSON Structured Output.

### Backward Compatibility
*   The system is designed to "Rehydrate" from simple JSON blobs.
*   Migration scripts (in `store.ts`) handle schema evolution (e.g., adding `channelId` to messages).

---

## 6. The "Blue Sky" Future

1.  **Relationships Radar (CRM)**:
    *   Visualize your network. Who haven't you spoken to in 3 months?
    *   "Remind me to call Mom" -> Creates a Task linked to Person:Mom.

2.  **Promise Tracker**:
    *   Never break a promise again.
    *   "I told Sam I'd send the file by Tuesday" -> Creates a PROMISE entity with a Deadline.

3.  **Opportunity Engine**:
    *   Track job applications (OPPORTUNITY nodes).
    *   Link them to the Company (CONTEXT) and the Recruiter (PERSON).

4.  **Local-First AI**:
    *   Running a small LLM (like Gemma 2B) directly in the browser via WebGPU for offline orchestrator capabilities.

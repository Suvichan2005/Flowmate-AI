# Flowmate Ideation Map & Master Plan

This document serves as the comprehensive "Brain Dump" and strategic roadmap for Flowmate. It outlines the core philosophy, the realized features, and the ambitious future of the platform.

---

## 1. Core Philosophy: "Life is a Graph, Not a List"

Most productivity tools treat life as a linear list of tasks. Flowmate treats life as a **connected graph**.

*   **Context over Isolation**: A task isn't just "Do X". It is "Do X for Project Y to achieve Goal Z, fulfilling Promise A to Person B."
*   **AI as Orchestrator**: The AI isn't a chatbot; it is an *operator*. It has "hands" (Tools/Operations) to manipulate the graph.
*   **Frictionless Capture**: Whether voice, text, or image, the barrier to entry into the system must be near zero.

---

## 2. The "Toon" Protocol (Token-Oriented Object Notation)

Toon is the internal language the AI uses to manipulate the graph. It is the bridge between Natural Language and Graph Operations.

| Operation | Purpose |
|-----------|---------|
| `create_entity` | Spawning new nodes (Task, Event, Goal, etc.) |
| `update_entity` | Modifying entity fields |
| `delete_entity` | Removing entities |
| `link_entities` | Creating semantic edges (FULFILLS, DEPENDS_ON, PART_OF) |
| `unlink_entities` | Removing relationship edges |
| `log_activity` | Recording history (Work sessions, meals, spending) |
| `schedule_event` | Blocking time on the calendar |
| `add_subtask` | Adding nested subtasks to entities |
| `toggle_subtask` | Completing/uncompleting subtasks |
| `log_food` | Recording meal entries |
| `archive_entity` | Archiving stale entities |

---

## 3. The Entity Ontology (The "Atoms" of Flowmate)

### Level 1: Productivity (✅ Implemented)
*   **GOAL**: High-level objectives ("Become an ML Engineer")
*   **PROJECT**: Concrete containers of work ("Build Portfolio App")
*   **TASK**: Actionable items ("Write README")
*   **EVENT**: Time-bound commitments ("Class at 10 AM")
*   **NOTE**: Unstructured information ("Meeting minutes")

### Level 2: Context & Organization (✅ Implemented)
*   **TAG**: Categorization (#urgent, #work)
*   **CONTEXT**: Where/How (@home, @laptop)
*   **ACTIVITY**: A record of past action (Focus session log)
*   **HABIT**: Recurring behaviors (Morning workout)
*   **MINI_STREAK**: Quick one-tap streaks (Reading, Pushups)

### Level 3: Lifestyle (✅ Implemented)
*   **COURSE**: Academic courses
*   **TOPIC**: Subject matter areas
*   **Food Tracking**: Full meal logging with vendor analytics
*   **Attendance Tracking**: Class attendance with skip calculator

### Level 4: The "Social Brain" (🔄 Planned)
*   **PERSON**: A node representing a human being
*   **PROMISE**: A commitment made TO a Person
    *   *State*: Pending -> Fulfilled | Broken
*   **OPPORTUNITY**: A potential value node (Lead, Contest, Job)
*   **ROLE**: User identity roles (Student, Developer, Leader)

---

## 4. Modules & Feature Map

### A. The Dashboard (Command Center) ✅
- [x] **Momentum Heatmap**: GitHub-style daily activity visualization
- [x] **Goal Progress Radar**: Circular progress rings for top goals
- [x] **Quick Actions**: Button grid for common tasks
- [x] **Daily Briefing**: AI-generated summary of the day
- [x] **Recent Activity**: Clickable recent entities
- [x] **Upcoming Events**: Today's and tomorrow's events
- [x] **Past Event Confirmation**: Tap-to-cycle confirmation

### B. The Orchestrator (Chat) ✅
- [x] **Multi-Channel**: Segregated contexts (General, Schedules, Food, Finance)
- [x] **Tool Use**: AI can call 15+ distinct operations
- [x] **Multimodal**: Accepts images (schedules, receipts) and audio
- [x] **Structured Output**: JSON operation parsing

### C. The Graph View (Visual Brain) ✅
- [x] **D3 Force Simulation**: Physics-based layout
- [x] **Semantic Grouping**: "Group by Kind" to organize nodes into clusters
- [x] **Visual Linking**: Shift+Drag to connect nodes
- [x] **Filtering**: Toggle visibility of specific node types
- [x] **Context Menu**: Right-click for quick actions
- [x] **Orphan Detection**: Find disconnected nodes

### D. Calendar (Time) ✅
- [x] **Multiple Views**: Month, Week, Day, Agenda, History
- [x] **Drag & Drop**: Reschedule events easily
- [x] **Google Sync**: Two-way sync with Google Calendar
- [x] **Productivity Logs**: See past "Focus Sessions" alongside future "Events"
- [x] **Quick Event Creation**: Fast event adding

### E. Tracking Features ✅
- [x] **Food Tracker**: Full meal logging with vendor analytics, nutrition
- [x] **Attendance Tracker**: Class attendance with skip calculator
- [x] **Quick Streaks**: Lightweight daily habit tracking
- [x] **Focus Timer**: Pomodoro sessions with activity logging
- [x] **Feature Toggles**: Enable/disable tracking features

### F. Knowledge & Analytics ✅
- [x] **Knowledge View**: Browse Notes, Tags, Contexts
- [x] **Contribution Heatmap**: GitHub-style yearly visualization
- [x] **Productivity Charts**: Time breakdown analytics
- [x] **Weekly Summary**: Productivity rollup
- [x] **Graph Analysis**: Orphan/duplicate detection

---

## 5. Technical Architecture

### Frontend
*   **Framework**: React 19 + TypeScript (Vite)
*   **State**: Zustand (Store.ts is the 'Single Source of Truth')
*   **Persistence**: `localStorage` (Instant load) + `Firebase Firestore` (Cloud Backup)
*   **Components**: 42 React components

### AI Layer
*   **Model**: Google Gemini 2.0 Flash (Low latency, high reasoning)
*   **Methodology**: System Prompt Engineering -> JSON Structured Output
*   **Voice**: WebSocket connection for real-time voice AI

### Services
*   **geminiService.ts**: LLM orchestration (~29KB)
*   **firestoreSync.ts**: Cloud persistence with connection monitoring
*   **googleSync.ts**: Google Calendar integration (~18KB)
*   **graphAnalyzer.ts**: Graph health analysis (~11KB)
*   **liveSession.ts**: Real-time voice AI

### Backward Compatibility
*   The system is designed to "Rehydrate" from simple JSON blobs
*   Migration scripts (in `store.ts`) handle schema evolution
*   Import/Export functionality for data portability

---

## 6. The "Blue Sky" Future

1.  **Relationships Radar (CRM)**:
    *   Visualize your network. Who haven't you spoken to in 3 months?
    *   "Remind me to call Mom" -> Creates a Task linked to Person:Mom

2.  **Promise Tracker**:
    *   Never break a promise again
    *   "I told Sam I'd send the file by Tuesday" -> Creates a PROMISE entity with a Deadline

3.  **Opportunity Engine**:
    *   Track job applications (OPPORTUNITY nodes)
    *   Link them to the Company (CONTEXT) and the Recruiter (PERSON)

4.  **Local-First AI**:
    *   Running a small LLM (like Gemma 2B) directly in the browser via WebGPU for offline orchestrator capabilities

5.  **Behavioral Analytics**:
    *   Productive vs unproductive hours tracking
    *   Commitment Load Index
    *   Burnout prediction

6.  **Mobile Native**:
    *   Capacitor migration for iOS/Android
    *   Push notifications
    *   Native widgets

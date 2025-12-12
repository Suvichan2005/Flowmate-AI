# Structural Analysis

This document provides a breakdown of the codebase structure, file organization, and module boundaries.

## Top-Level Structure

```
c:/Users/KIIT0001/Documents/FLOWMATE/flowmate-v3/
├── App.tsx                  # Main Application Shell & Chat Logic
├── store.ts                 # Global State Management (Zustand)
├── types.ts                 # TypeScript Core Definitions
├── index.tsx                # Entry Point
├── index.css                # Global Styles (Tailwind directives)
├── index.html               # HTML Template
├── vite.config.ts           # Vite Bundler Config
├── metadata.json            # Application metadata
└── .env.local               # Environment Variables (API Keys)
```

## Directory: /components

Contains all 42 React UI components.

### Core Views

| Component | Responsibility |
|-----------|----------------|
| `Dashboard.tsx` | Main landing view with summary widgets, recent activity, quick actions |
| `GraphView.tsx` | D3.js interactive force-directed graph visualization |
| `CalendarView.tsx` | Drag-and-drop calendar for Events and Logs |
| `KnowledgeView.tsx` | Interface for browsing Notes, Tags, and Contexts |
| `AnalyticsView.tsx` | Dashboard for productivity metrics and charts |
| `SchedulesView.tsx` | Dedicated view for Class Schedules & Mess Menus |
| `SettingsView.tsx` | Configuration panel (API Keys, Timezone, Feature Toggles) |
| `TimelineView.tsx` | Linear timeline visualization of events |

### Entity Management

| Component | Responsibility |
|-----------|----------------|
| `EntityDetailPanel.tsx` | Sidebar for editing selected node details, relationships, subtasks |
| `EntityList.tsx` | List view components for Goals/Projects |
| `CreateEntityModal.tsx` | Form for manually creating entities |
| `KanbanBoard.tsx` | Kanban view for tasks (To Do, Doing, Done) |

### Tracking Features

| Component | Responsibility |
|-----------|----------------|
| `FoodTracker.tsx` | Full food logging UI with vendor analytics |
| `AttendanceTracker.tsx` | Academic attendance tracking with skip calculator |
| `QuickStreaks.tsx` | Lightweight habit streak tracker with inline forms |
| `HabitCard.tsx` | Widget for tracking simple habits |
| `FocusTimer.tsx` | Pomodoro timer with floating widget |

### Productivity & Analytics

| Component | Responsibility |
|-----------|----------------|
| `ActivityHeatmap.tsx` | Visualizes activity logs over time |
| `ContributionHeatmap.tsx` | "GitHub-style" contribution graph |
| `MomentumHeatmap.tsx` | Advanced heatmap for dashboard |
| `ProductivityChart.tsx` | Productivity time breakdown visualization |
| `GoalProgressChart.tsx` | Circular progress visualization for goals |
| `WeeklySummary.tsx` | Weekly productivity rollup |

### Chat & Input

| Component | Responsibility |
|-----------|----------------|
| `UnifiedChatInput.tsx` | Input bar for text/files/voice |
| `CommandPalette.tsx` | Quick action menu (Ctrl+K) |
| `QuickCapture.tsx` | Fast input for thoughts/tasks |
| `LiveVoiceModal.tsx` | UI for real-time voice interaction |

### Modals & Overlays

| Component | Responsibility |
|-----------|----------------|
| `AuthModal.tsx` | Firebase authentication (Sign In/Up) |
| `PreviewModal.tsx` | Modal for previewing operations before commit |
| `OpsPreviewForm.tsx` | Detailed operation preview and editing |
| `GraphFixingModal.tsx` | Tools for fixing graph issues (orphans, duplicates) |
| `ReviewPrompt.tsx` | Dialog for End-of-Day review |

### UI Primitives & Alerts

| Component | Responsibility |
|-----------|----------------|
| `Sidebar.tsx` | Main navigation rail |
| `ContextSummary.tsx` | Displays active contexts in the dashboard |
| `ConnectionStatus.tsx` | Real-time sync status indicator |
| `ToastNotification.tsx` | Floating notification alerts |
| `Confetti.tsx` | Visual celebration effect |
| `BadHabitAlert.tsx` | Visual alert when "bad habits" are tracked |
| `DebugConsole.tsx` | Floating console for system logs |
| `MarkdownText.tsx` | Utility to render Markdown safely |
| `StreakLeaderboard.tsx` | Gamification leaderboard |
| `SmartEditor.tsx` | Enhanced text editor (experimental) |

## Directory: /services

Contains logic for external APIs and backend integrations.

| Service | Responsibility |
|---------|----------------|
| `firebase.ts` | Firebase initialization and Auth wrappers |
| `firestoreSync.ts` | Sync logic for Firestore (Save/Load) with connection status |
| `geminiService.ts` | LLM Orchestration logic and prompt engineering |
| `googleSync.ts` | Google Calendar API adapter |
| `graphAnalyzer.ts` | Graph health analysis (orphans, duplicates, issues) |
| `liveSession.ts` | WebSocket management for Gemini Live API |

## Directory: /utils

Helper functions.

| File | Responsibility |
|------|----------------|
| `exportMarkdown.ts` | Export entities and graph data to Markdown format |
| `graphVisibility.ts` | Logic for filtering entity visibility (archived, old, orphans) |
| `imageProcessing.ts` | Compressing and encoding images for LLM |
| `progressCalculation.ts` | Logic to calculate project/goal completion % |
| `streakCalculation.ts` | Streak, aggregation, and contribution data utilities |

## Directory: /public

Static assets for PWA support.

| File | Responsibility |
|------|----------------|
| `manifest.json` | PWA manifest for installability |
| `sw.js` | Service worker for offline caching |

## Directory: /scripts

Build and utility scripts.

| File | Responsibility |
|------|----------------|
| Various scripts | Build utilities and automation |

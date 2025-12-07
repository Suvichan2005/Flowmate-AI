# Structural Analysis

This document provides a breakdown of the codebase structure, file organization, and module boundaries.

## Top-Level Structure

```
c:/Users/KIIT0001/Documents/FLOWMATE/copy-of-copy-of-copy-of-flowmate/
├── App.tsx                  # Main Application Shell & Chat Logic
├── store.ts                 # Global State Management (Zustand)
├── types.ts                 # TypeScript Core Definitions
├── index.tsx                # Entry Point
├── index.css                # Global Styles (Tailwind directives)
├── index.html               # HTML Template
├── vite.config.ts           # Vite Bundler Config
└── .env.local               # Environment Variables (API Keys)
```

## Directory: /components

Contains all React UI components.

| Component | Responsibility |
|-----------|----------------|
| `ActivityHeatmap.tsx` | Visualizes activity logs over time. |
| `AnalyticsView.tsx` | Dashboard for productivity metrics and charts. |
| `AuthModal.tsx` | Firebase authentication (Sign In/Up). |
| `BadHabitAlert.tsx` | Visual alert when "bad habits" are tracked. |
| `CalendarView.tsx` | Drag-and-drop calendar for Events and Logs. |
| `CommandPalette.tsx` | Quick action menu (Ctrl+K). |
| `Confetti.tsx` | Visual celebration effect. |
| `ContextSummary.tsx` | Displays active contexts in the dashboard. |
| `ContributionHeatmap.tsx` | "Github-style" contribution graph. |
| `CreateEntityModal.tsx` | Form for manually creating entities. |
| `Dashboard.tsx` | Main landing view with summary widgets. |
| `DebugConsole.tsx` | Floating console for system logs. |
| `EntityDetailPanel.tsx` | Sidebar for editing selected node details. |
| `EntityList.tsx` | List view components for Goals/Projects. |
| `FocusTimer.tsx` | Pomodoro timer with floating widget. |
| `GoalProgressChart.tsx` | Circular progress visualization. |
| `GraphView.tsx` | D3.js interactive force-directed graph. |
| `HabitCard.tsx` | Widget for tracking simple habits. |
| `KanbanBoard.tsx` | Kanban view for tasks (To Do, Doing, Done). |
| `KnowledgeView.tsx` | Interface for browsing Notes, Tags, and Contexts. |
| `LiveVoiceModal.tsx` | UI for real-time voice interaction. |
| `MarkdownText.tsx` | Utility to render Markdown safely. |
| `MomentumHeatmap.tsx` | Advanced heatmap for dashboard. |
| `PreviewModal.tsx` | Modal for previewing operations before commit. |
| `QuickCapture.tsx` | Fast input for thoughts/tasks. |
| `QuickStreaks.tsx` | Lightweight habit streak tracker. |
| `ReviewPrompt.tsx` | Dialog for End-of-Day review. |
| `SchedulesView.tsx` | **NEW**: Dedicated view for Class Schedules & Mess Menus. |
| `SettingsView.tsx` | Configuration panel (API Keys, Timezone). |
| `Sidebar.tsx` | Main navigation rail. |
| `SmartEditor.tsx` | Enhanced text editor (unused/experimental). |
| `StreakLeaderboard.tsx` | Gamification leaderboard. |
| `TimelineView.tsx` | Linear timeline visualization of events. |
| `ToastNotification.tsx` | Floating notification alerts. |
| `UnifiedChatInput.tsx` | Input bar for text/files/voice. |
| `WeeklySummary.tsx` | Weekly productivity rollup. |

## Directory: /services

Contains logic for external APIs and backend integrations.

| Service | Responsibility |
|---------|----------------|
| `firebase.ts` | Firebase initialization and Auth wrappers. |
| `firestoreSync.ts` | Sync logic for Firestore (Save/Load). |
| `geminiService.ts` | LLM Orchestration logic and prompt engineering. |
| `googleSync.ts` | Google Calendar API adapter. |
| `liveSession.ts` | WebSocket management for Gemini Live API. |

## Directory: /utils

Helper functions.

| File | Responsibility |
|------|----------------|
| `exportMarkdown.ts` | Export entities and graph data to Markdown format. |
| `imageProcessing.ts` | Compressing and encoding images for LLM. |
| `progressCalculation.ts` | Logic to calculate project/goal completion %. |
| `streakCalculation.ts` | Streak, aggregation, and contribution data utilities. |

## Directory: /public

Static assets for PWA support.

| File | Responsibility |
|------|----------------|
| `manifest.json` | PWA manifest for installability. |
| `sw.js` | Service worker for offline caching. |


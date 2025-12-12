# Components Reference

A directory of all 42 React components and their usage.

## Core Views

### `App.tsx`
The root component. Handles:
*   Global Layout (Sidebar + Main Content).
*   Chat Overlay visibility and resizing.
*   **Keyboard Shortcut**: `Cmd+B` or `Ctrl+B` toggles the Chat Overlay.
*   **Chat Channels**: Tabbed interface for switching contexts (General, Schedules, Food, Finance).

### `Dashboard.tsx` (~47KB)
The home screen.
*   **Widgets**: `MomentumHeatmap`, `GoalProgressChart`, `ContextSummary`, `QuickCapture`
*   **Recent Activity**: Clickable list of recent entities
*   **Upcoming Events**: Today's and tomorrow's events
*   **Quick Actions**: Button grid for common tasks
*   **Daily Briefing**: AI-generated summary
*   **Past Events Confirmation**: Tap-to-cycle confirmation for past events

### `GraphView.tsx` (~41KB)
The visual brain.
*   **Lib**: D3.js
*   **Interactions**:
    *   **Drag Node**: Move nodes manually
    *   **Shift + Drag**: Draw a visual line between nodes to create a Relationship
    *   **Right Click**: Opens context menu (Start Focus, Edit, Delete, Toggle Completion)
    *   **Double Click**: Focuses the camera on the node
*   **Physics**:
    *   **Context Gravity**: `CONTEXT` nodes have higher gravity to act as anchors
    *   **Group by Kind**: Applies a grid force layout to organize nodes by type
    *   **Refresh**: Applies a temporary centripetal force to gather scattered nodes

### `CalendarView.tsx` (~53KB)
*   **Lib**: `react-big-calendar`
*   **Views**: Month, Week, Day, Agenda, History
*   **Features**:
    *   Displays `EVENT` entities
    *   Displays `ACTIVITY` logs (purple bars)
    *   Drag-and-drop rescheduling
    *   Quick event creation
    *   Mobile-responsive layout

### `SchedulesView.tsx`
*   **Purpose**: Display academic and mess schedules
*   **Sections**:
    *   Recurring Classes (derived from recurring Events)
    *   Mess Menu (derived from labelled Notes)
*   **Actions**: Prompts user to use Chat for uploading schedule images

### `KnowledgeView.tsx` (~33KB)
Browser for data that isn't tasks/projects.
*   **Tabs**: All Notes, By Tag, By Context
*   **Visuals**: Tag cloud with usage counts
*   **Filtering**: By kind, search, context

### `AnalyticsView.tsx`
Dashboard for productivity metrics.
*   Productivity charts
*   Time breakdown by category

### `TimelineView.tsx`
Linear timeline visualization of events and activities.

---

## Entity Management

### `EntityDetailPanel.tsx` (~62KB)
The "Inspector" side panel.
*   **Usage**: Opens when a node is clicked in Graph or List
*   **Features**:
    *   Edit Title/Description
    *   Change Status/Priority
    *   Manage Relationships (Link/Unlink)
    *   Add/Toggle/Delete Subtasks
    *   View Activity Logs
    *   Parent entity selection

### `EntityList.tsx`
List view for Goals/Projects/Tasks.
*   Filtering by kind and status
*   Quick status toggles

### `CreateEntityModal.tsx`
Form for manually creating entities.
*   Entity type selection
*   All field inputs
*   Relationship linking

### `KanbanBoard.tsx`
Kanban view for tasks.
*   Columns: To Do, In Progress, Done
*   Drag-and-drop between columns

---

## Tracking Components

### `FoodTracker.tsx` (~28KB)
Full food logging UI.
*   Log meals with nutrition data
*   Vendor analytics
*   Meal pattern breakdown
*   Cost tracking
*   Favorites management

### `AttendanceTracker.tsx` (~32KB)
Academic attendance management.
*   Subject management
*   Class schedule definition
*   Attendance logging (present/absent/cancelled)
*   Skip calculator
*   Today's classes with quick mark

### `QuickStreaks.tsx` (~20KB)
Lightweight habit streak tracker.
*   Inline add/edit forms (mobile-friendly)
*   Streak visualization
*   Best streak tracking
*   Completion history

### `HabitCard.tsx`
Widget for tracking individual habits.
*   Progress visualization
*   Quick toggle

### `FocusTimer.tsx`
Pomodoro timer with floating widget.
*   **State**: Persisted in Store (`focusSession`)
*   **Logic**: On complete, triggers `log_activity` operation
*   Active/Paused/Completed states

---

## Analytics & Visualization

### `ActivityHeatmap.tsx`
Visualizes activity logs over time as a heatmap.

### `ContributionHeatmap.tsx`
"GitHub-style" contribution graph.
*   Yearly activity visualization
*   Color-coded intensity

### `MomentumHeatmap.tsx`
Advanced heatmap for dashboard.
*   Weekly momentum tracking

### `ProductivityChart.tsx`
Productivity time breakdown visualization.
*   Pie/bar charts for productive hours

### `GoalProgressChart.tsx`
Circular progress visualization for goals.

### `WeeklySummary.tsx`
Weekly productivity rollup.
*   Stats for the week
*   Comparison with previous week

### `StreakLeaderboard.tsx`
Gamification leaderboard for streaks.

---

## Chat & Input

### `UnifiedChatInput.tsx`
The main input bar.
*   **Inputs**: Text, Image Upload, Voice (Mic)
*   **State**: Local input state, attachment handling

### `CommandPalette.tsx`
Quick action menu (Ctrl+K).
*   Fuzzy search for entities
*   Quick navigation

### `QuickCapture.tsx`
Fast input for thoughts/tasks.
*   Minimal UI for rapid entry

### `LiveVoiceModal.tsx`
UI for real-time voice interaction.
*   Audio visualization
*   Transcription display

---

## Modals & Overlays

### `AuthModal.tsx`
Firebase authentication (Sign In/Up).
*   Email/Password
*   Google OAuth

### `PreviewModal.tsx`
Modal for previewing operations before commit.

### `OpsPreviewForm.tsx`
Detailed operation preview and editing.
*   Edit proposed changes
*   Approve/Reject individual ops

### `GraphFixingModal.tsx`
Tools for fixing graph issues.
*   Orphan node management
*   Duplicate merging
*   Bulk operations

### `ReviewPrompt.tsx`
Dialog for End-of-Day review.

---

## UI Primitives

### `Sidebar.tsx`
Main navigation rail.
*   View switching
*   Conditional feature visibility based on toggles

### `ContextSummary.tsx`
Displays active contexts in the dashboard.

### `ConnectionStatus.tsx`
Real-time sync status indicator.
*   Synced/Syncing/Offline states
*   Auto-retry notification

### `ToastNotification.tsx`
Floating notification alerts.
*   Success/Error/Info types

### `Confetti.tsx`
Visual celebration effect.
*   Triggered on achievements

### `BadHabitAlert.tsx`
Visual alert when "bad habits" are tracked.

### `DebugConsole.tsx`
Floating console for system logs.
*   Orchestrator logs
*   Sync logs

### `MarkdownText.tsx`
Utility to render Markdown safely.
*   React-Markdown wrapper

### `SmartEditor.tsx`
Enhanced text editor (experimental).

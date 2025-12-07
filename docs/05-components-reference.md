# Components Reference

A directory of all React components and their usage.

## Core Views

### `App.tsx`
The root component. Handles:
*   Global Layout (Sidebar + Main Content).
*   Chat Overlay visibility and resizing.
*   **Keyboard Shortcut**: `Cmd+B` or `Ctrl+B` toggles the Chat Overlay.
*   **Chat Channels**: Tabbed interface for switching contexts (General, Schedules, Food, Finance).

### `Dashboard.tsx`
The home screen.
*   **Key Props**: None (Connects to Store).
*   **Widgets**: `MomentumHeatmap`, `GoalProgressChart`, `ContextSummary`, `QuickCapture`.

### `GraphView.tsx`
The visual brain.
*   **Lib**: D3.js.
*   **Interactions**:
    *   **Drag Node**: Move nodes manually (positions are not persisted unless pinned, currently transient).
    *   **Shift + Drag**: Draw a visual line between nodes to create a Relationship.
    *   **Right Click**: Opens context menu (Start Focus, Edit, Delete, Toggle Completion).
    *   **Double Click**: Focuses the camera on the node.
*   **Physics**:
    *   **Context Gravity**: `CONTEXT` nodes have higher gravity to act as anchors.
    *   **Group by Kind**: Applies a grid force layout to organize nodes by type.
    *   **Refresh**: Applies a temporary centripetal force to gather scattered nodes back to center.

### `CalendarView.tsx`
*   **Lib**: `react-big-calendar`.
*   **Features**:
    *   Displays `EVENT` entities.
    *   Displays `ACTIVITY` logs (purple bars).
    *   Drag-and-drop rescheduling.

### `SchedulesView.tsx` (New)
*   **Purpose**: Display academic and mess schedules.
*   **Sections**:
    *   Recurring Classes (derived from recurring Events).
    *   Mess Menu (derived from labelled Notes).
*   **Actions**: Prompts user to use Chat for uploading schedule images.

## Feature Components

### `UnifiedChatInput.tsx`
The main input bar.
*   **Inputs**: Text, Image Upload, Voice (Mic).
*   **State**: Local input state, attachment handling.

### `EntityDetailPanel.tsx`
The "Inspector" side panel.
*   **Usage**: Opens when a node is clicked in Graph or List.
*   **Features**:
    *   Edit Title/Description.
    *   Change Status/Priority.
    *   Manage Relationships (Link/Unlink).
    *   Add Subtasks.

### `KnowledgeView.tsx`
Browser for data that isn't tasks/projects.
*   **Tabs**: All Notes, By Tag, By Context.
*   **Visuals**: Tag cloud with usage counts.

### `FocusTimer.tsx`
Production timer.
*   **State**: Persisted in Store (`focusSession`).
*   **Logic**: On complete, triggers `log_activity` operation.

### `SettingsView.tsx`
*   **Config**: API Keys, Timezone, Debug Mode.
*   **Actions**: "Sync Now", "Import/Export Data".

## Visual primitives
*   `Confetti.tsx`: Celebration.
*   `ToastNotification.tsx`: Alerts.
*   `MarkdownText.tsx`: React-Markdown wrapper for safe rendering.

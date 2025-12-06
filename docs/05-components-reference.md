# Components Reference

This document provides a detailed reference for all 22 React components in Flowmate.

---

## Component Categories

| Category | Components | Purpose |
|----------|------------|---------|
| **Views** | Dashboard, CalendarView, KnowledgeView, EntityList, SettingsView | Full-page content areas |
| **Visualization** | GraphView, KanbanBoard, TimelineView, ActivityHeatmap | Data display |
| **Modals** | CreateEntityModal, PreviewModal, LiveVoiceModal, EntityDetailPanel, CommandPalette, AuthModal | Overlays |
| **Utility** | Sidebar, FocusTimer, DebugConsole, ToastNotification, Confetti, MarkdownText, SmartEditor | Supporting UI |

---

## 1. View Components

### Dashboard.tsx
**Lines**: 354 | **Bytes**: 18,134

**Purpose**: Main overview with stats, briefing, and activity visualization.

**Key Features**:
- Stat cards (goals, projects, tasks, events)
- AI-generated daily briefing
- Activity heatmap integration
- Overdue task warnings
- Relationship graph preview

**Props**: None (uses store directly)

**Store Dependencies**:
- `entities`, `relationships`
- `dailyBriefing`, `refreshDailyBriefing`

---

### CalendarView.tsx
**Lines**: 211 | **Bytes**: 9,667

**Purpose**: Monthly calendar for events and deadlines.

**Key Features**:
- Month navigation (prev/next/today)
- Drag-and-drop event rescheduling
- Click-to-create new events
- Color coding by entity kind
- Day popover with event list
- **IST timezone support** (dates stored with +05:30 offset)

**Props**: None

**Key Functions**:
| Function | Description |
|----------|-------------|
| `handleDragStart` | Initiate event drag |
| `handleDrop` | Update entity date on drop |
| `handleDayClick` | Open create modal for date |

---

### KnowledgeView.tsx
**Lines**: 290 | **Bytes**: 12,000

**Purpose**: Note browser with AI-powered Q&A and tag/context management.

**Key Features**:
- **Tab switcher**: All / Tags / Contexts
- **Universal tags display** with usage counts
- **Context entities** included in listing
- Search and filter functionality
- "Ask AI" for knowledge queries
- Quick note creation
- Tags displayed on entity cards

**Key Functions**:
| Function | Description |
|----------|-------------|
| `handleAskAI` | Query knowledge base via Gemini |
| `handleCreateNote` | Quick create NOTE entity |

---

### EntityList.tsx
**Lines**: 234 | **Bytes**: 11,985

**Purpose**: Filtered list of entities (Goals/Projects).

**Props**:
```typescript
interface EntityListProps {
  kinds: EntityKind[];  // Filter by these kinds
  title: string;        // Page title
}
```

**View Modes**:
- Grid (cards)
- Kanban (by status)
- Timeline (chronological)

**Key Functions**:
| Function | Description |
|----------|-------------|
| `getProgress` | Calculate completion percentage |
| `getChildCount` | Count linked child entities |

---

### SettingsView.tsx
**Lines**: 229 | **Bytes**: 10,521

**Purpose**: User preferences and data management.

**Sections**:
1. **AI Configuration**: Model selection, custom instructions
2. **Sync Settings**: Google Calendar toggle
3. **Debug Mode**: Enable debug console
4. **Data Management**: Export, Import, Reset

**Key Functions**:
| Function | Description |
|----------|-------------|
| `handleExport` | Download JSON backup |
| `handleFileChange` | Import from JSON |
| `handleReset` | Clear all data |

---

## 2. Visualization Components

### GraphView.tsx
**Lines**: 632 | **Bytes**: 25,941

**Purpose**: Interactive D3.js force-directed graph.

**Props**:
```typescript
interface GraphViewProps {
  entities: Entity[];
  relationships: Relationship[];
}
```

**Features**:
- Force simulation with collision detection
- Zoom and pan
- Node filtering by kind
- Context menu (right-click)
- Link creation mode (Shift+click)
- Status indicators (checkmarks)

**Key Functions**:
| Function | Description |
|----------|-------------|
| `drag` | D3 drag behavior |
| `handleContextAction` | Process context menu selection |
| `toggleKind` | Filter visibility by kind |
| `resetZoom` | Reset to initial view |

**Node Colors by Kind**:
```typescript
GOAL: '#6366f1'     // Indigo
PROJECT: '#8b5cf6'  // Violet
TASK: '#10b981'     // Emerald
EVENT: '#f59e0b'    // Amber
NOTE: '#06b6d4'     // Cyan
```

---

### KanbanBoard.tsx
**Lines**: ~200 | **Bytes**: 6,750

**Purpose**: Status-based kanban columns.

**Columns**:
1. PENDING
2. ACTIVE / IN_PROGRESS
3. COMPLETED

**Features**:
- Drag-drop between columns
- Status auto-update on drop
- Card preview with priority

---

### TimelineView.tsx
**Lines**: ~250 | **Bytes**: 9,008

**Purpose**: Chronological timeline visualization.

**Features**:
- Time-based ordering
- Deadline indicators
- Status coloring
- Expandable details

---

### ActivityHeatmap.tsx
**Lines**: ~120 | **Bytes**: 4,380

**Purpose**: GitHub-style contribution grid.

**Time Range**: Last 365 days

**Intensity**: Based on completed ACTIVITY count per day

---

## 3. Modal Components

### CreateEntityModal.tsx
**Lines**: 172 | **Bytes**: 7,758

**Purpose**: Form for creating new entities.

**Props**:
```typescript
interface CreateEntityModalProps {
  onClose: () => void;
  initialDate?: string | null;
  initialKind?: EntityKind;
}
```

**Fields**:
- Title (required)
- Kind (TASK, PROJECT, GOAL, EVENT, NOTE)
- Date/Deadline (optional)
- Recurrence (DAILY, WEEKLY, MONTHLY, YEARLY)
- Description (optional)

---

### PreviewModal.tsx
**Lines**: 72 | **Bytes**: 3,013

**Purpose**: Confirmation dialog for AI operations.

**Props**:
```typescript
interface PreviewModalProps {
  ops: ToonOperation[];
  onConfirm: () => void;
  onCancel: () => void;
}
```

**Displays**:
- Operation type badge
- Payload key-value pairs
- Confirm/Reject buttons

---

### LiveVoiceModal.tsx
**Lines**: 193 | **Bytes**: 7,013

**Purpose**: Real-time voice AI interface.

**Props**:
```typescript
interface LiveVoiceModalProps {
  onClose: () => void;
}
```

**Features**:
- Audio visualizer (canvas)
- Live transcription
- Status indicator
- Session management

---

### EntityDetailPanel.tsx
**Lines**: 769 | **Bytes**: 34,949

**Purpose**: Slide-over panel for viewing/editing entities.

**Sections**:
1. **Header**: Title, kind, status
2. **Quick Actions**: Focus, Delete
3. **Fields**: Description, dates, priority
4. **Tags**: Add/remove canonical tags
5. **Relationships**: View/create links
6. **Subtasks**: Manage child tasks
7. **AI Tools**: Generate description, breakdown

**Key Functions**:
| Function | Description |
|----------|-------------|
| `handleSave` | Apply entity updates |
| `handleDelete` | Remove entity |
| `handleCreateSubtask` | Add linked child task |
| `handleCreateLink` | Create relationship |
| `handleAiGenerateDescription` | AI text improvement |

---

### CommandPalette.tsx
**Lines**: 201 | **Bytes**: 8,717

**Purpose**: Cmd+K quick action overlay.

**Activation**: `Cmd+K` or `Ctrl+K`

**Features**:
- Fuzzy search
- Keyboard navigation
- View switching
- Entity search
- AI query passthrough

---

## 4. Utility Components

### Sidebar.tsx
**Lines**: 183 | **Bytes**: 6,642

**Purpose**: Main navigation sidebar.

**Sections**:
1. Logo
2. Create button
3. Navigation items
4. Undo/Redo buttons
5. Gamification display
6. Settings + Zen Mode

---

### FocusTimer.tsx
**Lines**: 119 | **Bytes**: 4,416

**Purpose**: Floating focus session widget.

**Features**:
- Countdown timer
- Pause/resume
- Complete button (logs activity)
- Progress bar
- Cancel option

---

### DebugConsole.tsx
**Lines**: ~100 | **Bytes**: 3,800

**Purpose**: Developer debug log viewer.

**Shows**:
- Orchestrator requests
- Sync operations
- System events
- Timestamps

---

### ToastNotification.tsx
**Lines**: ~50 | **Bytes**: 1,673

**Purpose**: Toast notification container.

**Types**:
- `success` (green)
- `error` (red)
- `info` (blue)

**Duration**: 3 seconds auto-dismiss

---

### Confetti.tsx
**Lines**: ~80 | **Bytes**: 2,626

**Purpose**: Celebration animation on task completion.

**Trigger**: `triggerConfetti()` store action

---

### MarkdownText.tsx
**Lines**: 195 | **Bytes**: 7,930

**Purpose**: Markdown parser and renderer.

**Supports**:
- Headers (H1-H3)
- Bold, Italic
- Inline code
- Code blocks with copy
- Links
- Bullet lists
- Numbered lists
- Task lists (`- [ ]`, `- [x]`)
- Blockquotes

---

### SmartEditor.tsx
**Lines**: 120 | **Bytes**: 4,967

**Purpose**: AI-enhanced text editor.

**Props**:
```typescript
interface SmartEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}
```

**AI Actions**:
- Fix Grammar
- Make Professional
- Expand
- Summarize

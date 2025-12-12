# Flowmate Feature Roadmap

> **Last Updated:** December 2025
> See also: [FLOWMATE_ROADMAP.md](./FLOWMATE_ROADMAP.md) for detailed development roadmap.

---

## ✅ Completed (Dec 2025)

### Core Features
- [x] **AI Orchestrator**: Natural language chat with Gemini 2.5 Flash
- [x] **Graph Visualization**: D3.js force-directed graph with grouping
- [x] **Multimodal Input**: Image, audio, and text attachments
- [x] **Chat Channels**: Separated flows for General, Schedules, Food, Finance
- [x] **Timezone Fix**: AI outputs dates with IST offset (+05:30)

### Entity Management
- [x] **EntityDetailPanel**: Full edit mode with subtask management
- [x] **Nested Subtasks**: Stored in metadata, not as separate entities
- [x] **Embedded Activity Logs**: Activity history within entities
- [x] **Auto-Archive**: Stale entity archival
- [x] **Parent References**: Direct parent_id for hierarchy

### Tracking Features
- [x] **Food Tracking**: Full meal logging with vendor analytics
- [x] **Attendance Tracking**: Academic class attendance with skip calculator
- [x] **Quick Streaks**: Lightweight daily habit tracking
- [x] **Focus Timer**: Pomodoro sessions with activity logging
- [x] **Feature Toggles**: Enable/disable Food/Attendance/People tracking

### Calendar & Scheduling
- [x] **Calendar Views**: Month, Week, Day, Agenda, History
- [x] **Drag & Drop**: Reschedule events by dragging
- [x] **Recurring Events**: RRULE pattern support
- [x] **Event Confirmation**: Tap-to-cycle past event status
- [x] **Schedules View**: Dedicated class schedules and mess menus

### Knowledge & Analytics
- [x] **Knowledge Base**: Tabs for All/Tags/Contexts with usage counts
- [x] **Contribution Heatmap**: GitHub-style activity visualization
- [x] **Productivity Charts**: Time breakdown analytics
- [x] **Weekly Summary**: Productivity rollup

### Integrations
- [x] **Google Calendar Sync**: Two-way sync with OAuth
- [x] **Firebase Auth/Sync**: Cloud backup with authentication
- [x] **Connection Status**: Real-time sync indicator with auto-retry

### Graph Analysis
- [x] **Orphan Detection**: Find unconnected entities
- [x] **Duplicate Detection**: Identify similar entities
- [x] **Graph Fixing Modal**: Tools for graph maintenance

### Mobile & UI
- [x] **Mobile Responsiveness**: Optimized for mobile devices
- [x] **Unified Chat Input**: Mobile-friendly chat interface
- [x] **Inline Forms**: Mobile-friendly streak/entity creation

---

## 🔴 High Priority (Next Sprint)

### 1. PWA & Offline Enhancement
- [ ] Service worker improvements for true offline
- [ ] Push notifications (upcoming events, streaks)
- [ ] "Add to Homescreen" improvements

### 2. Advanced Food Tracking
- [ ] Nutrition API integration (calorie lookup)
- [ ] Meal planning with mess menu integration
- [ ] Weekly nutrition summary

### 3. Finance Dashboard
- [ ] Spending visualization (Finance channel data)
- [ ] Monthly budget limits
- [ ] Expense categorization

---

## 🟡 Medium Priority

### 4. The "Social Brain"
- [ ] `PERSON` entity implementation
- [ ] `PROMISE` entity and tracking
- [ ] Relationship Radar view
- [ ] "Haven't talked to X in N days" alerts

### 5. Natural Language Enhancements
- [ ] Better approximate date parsing
- [ ] Voice-to-Action refinements
- [ ] Context-aware suggestions

### 6. Behavioral Analytics
- [ ] Productive vs unproductive hours tracking
- [ ] 24-hour productivity bar visualization
- [ ] Commitment Load Index

---

## 🟢 Future Priorities

### 7. Academic Intelligence
- [ ] Topic mastery graph
- [ ] Exam readiness predictor
- [ ] Course module progress tracking

### 8. Integrations
- [ ] Gmail → Event ingestion
- [ ] Slack integration
- [ ] Notion import

### 9. Mobile Native (Capacitor)
- [ ] iOS/Android native builds
- [ ] Offline-first with SQLite
- [ ] Native widgets
- [ ] Haptic feedback

---

## Technical Debt

- [ ] Optimize D3 Graph for >500 nodes (consider WebGL)
- [ ] Granular Firestore Sync (delta updates instead of full snapshot)
- [ ] Unit tests for `store.applyOperations`
- [ ] E2E tests for critical workflows
- [ ] Performance profiling and optimization

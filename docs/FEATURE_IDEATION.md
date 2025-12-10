# Flowmate: Complete Feature Ideation & Implementation Plan

> **Last Updated:** December 2024
> **Version:** 3.1
> **Vision:** Flowmate is a Cognitive Offloading Engine — your external brain that stores commitments, tracks progress, and prioritizes actions so your RAM is freed for actual thinking.

---

## 🧠 Philosophy: Why Flowmate Exists

### The Core Problem
Modern knowledge workers (students, founders, freelancers) suffer from:
1. **Cognitive Overload** — Too many buckets: academics, projects, side-hustles, personal
2. **Context Loss** — Forgetting commitments made in WhatsApp, email, meetings
3. **Priority Paralysis** — Not knowing what to work on next
4. **Execution Drift** — Starting tasks but not finishing them
5. **Zero Visibility** — No single dashboard for "my entire life"

### The Flowmate Solution
> "I should be able to dump EVERYTHING into Flowmate and trust it to show me the right thing at the right time."

Flowmate is NOT a to-do list. It's a **Personal Life Operating System** that:
- Captures commitments from any source (chat, voice, calendar, email)
- Organizes them into a cognitive graph
- Surfaces the RIGHT priority at the RIGHT time
- Tracks execution and learns your patterns
- Provides AI-driven insights on productivity, health, relationships

---

## 🏗️ Architecture Overview

### Entity Model (Simplified in V3.1)
```
CONTEXTS (domains)     → Academics, IEEE, Wifthub, Staffroom
└── GOALS              → "Master ML by May 2025"
    └── PROJECTS       → "Complete Coursera ML Course"
        └── TASKS      → "Finish Week 5 Assignment"
            └── subtasks (nested in metadata)
            └── activity_log (nested in metadata)
```

### Core Entity Types
| Kind | Purpose | Example |
|------|---------|---------|
| CTX | Life domains | "Academics", "E-Cell", "Personal" |
| GOL | Long-term objectives | "Get placed at Google" |
| PRJ | Multi-task initiatives | "Build Flowmate V3" |
| TSK | Actionable items | "Review PR #42" |
| EVT | Calendar entries | "Meeting at 3pm" |
| HAB | Recurring behaviors | "Morning Workout" |
| MINI_STREAK | Quick habits | "Read 10 pages daily" |
| PERSON | Relationship tracking | "Prof. Sharma" |
| PROMISE | Commitments to others | "Send notes to Rahul" |

### Smart Features Already Implemented ✅
- [x] Feature toggles (Food/Attendance/People)
- [x] Event confirmation (tap-to-cycle: done/skipped/postponed)
- [x] Food tracking with vendor analytics
- [x] Attendance tracking with skip calculator
- [x] Nested subtasks in metadata
- [x] Embedded activity logs
- [x] Smart graph visibility filters
- [x] RRULE recurrence patterns
- [x] AI-powered daily briefing
- [x] Quick streaks

---

## 🚀 Implementation Phases

### Phase 0: MVP Foundation (CURRENT - December 2024)
**Goal:** Deploy usable product for personal use

| Feature | Status | Priority |
|---------|--------|----------|
| Dashboard with top priorities | ✅ Done | P0 |
| AI chat with entity creation | ✅ Done | P0 |
| Calendar with event sync | ✅ Done | P0 |
| Food tracking dashboard | ✅ Done | P0 |
| Attendance tracking | ✅ Done | P0 |
| Feature toggles | ✅ Done | P0 |
| Event confirmation | ✅ Done | P0 |
| Graph view with filters | ✅ Done | P0 |
| Mobile responsiveness | ✅ Done | P0 |
| Cloud sync (Firebase) | ✅ Done | P0 |

### Phase 1: Behavioral Analytics (January 2025)
**Goal:** See where your time goes

| Feature | Description | Effort |
|---------|-------------|--------|
| Productive Hours Tracking | Log activities as productive/neutral/unproductive | M |
| 24-Hour Productivity Bar | Visual day breakdown (green/yellow/red/grey) | M |
| Weekly Insights | "Most productive on Tuesday mornings" | L |
| Time by Category | Hours spent per context/project | L |
| Commitment Load Index | Daily overwhelm score (1-10) | M |

### Phase 2: Social Brain (February 2025)
**Goal:** Track relationships and promises

| Feature | Description | Effort |
|---------|-------------|--------|
| PERSON Entity | Name, last_met, relationship_quality, frankness_level | S |
| PROMISE Entity | Commitment, linked person, due date | S |
| Promise Auto-Detection | Parse "I'll..." / "Remind me to..." | M |
| Relationship Radar | "Haven't talked to X in 10 days" | M |
| Meeting Frequency | Track interaction patterns | L |

### Phase 3: Academic Intelligence (March 2025)
**Goal:** Master academics with data

| Feature | Description | Effort |
|---------|-------------|--------|
| Enhanced Attendance Form | Days/time/room/teacher per subject | S |
| Class Schedule Import | Bulk add from image/text | M |
| Holiday Management | List of holidays to exclude | S |
| Mess Menu Calendar | Show daily mess menu | M |
| Exam Readiness Predictor | Based on study hours vs syllabus | L |
| Topic Mastery Graph | Subject → topic → weak areas | L |

### Phase 4: Integrations (April 2025)
**Goal:** Pull data from everywhere

| Integration | Scope | Effort |
|-------------|-------|--------|
| Gmail | Read-only, parse actionable emails | L |
| Google Calendar Sync | Two-way sync | M (Partial) |
| Slack | OAuth, detect tasks from channels | L |
| WhatsApp (forward-to-email) | Parse forwarded messages | M |
| Notion Import | Pull pages as notes | M |

### Phase 5: Life OS Features (Q2 2025)
**Goal:** Complete life management

| Feature | Description | Effort |
|---------|-------------|--------|
| Life Pillars Radar | 6 pillars balance chart | M |
| Opportunity Tracker | ROI scoring for leads | M |
| Trajectory Predictor | "Launch-ready by Jan 15 at current pace" | L |
| Smart Weekly Review | Habits, goals, stagnating projects | M |
| Burnout Prediction | Load + sleep + stress → warning | L |

### Phase 6: Mobile Native (Q3 2025)
**Goal:** True mobile app

| Feature | Description | Effort |
|---------|-------------|--------|
| Capacitor Migration | iOS/Android builds | L |
| Offline-First | IndexedDB/SQLite | L |
| Push Notifications | Events, deadlines, streaks | M |
| Haptic Feedback | Task complete, streak milestone | S |
| Widget Support | iOS/Android widgets | L |

---

## 📋 Feature Details by Category

### 🍕 Food Tracking (Implemented)
- **Log food** with: name, cost, calories, vendor, source (mess/ordered/homemade), rating
- **Vendor analytics**: Top vendors, spending per vendor
- **Meal patterns**: Breakfast/lunch/dinner/snack counts
- **AI context**: Ask "What's my favorite food?" or "How much did I spend?"
- **Mess menu**: Store and display on calendar (planned)

### 📚 Attendance Tracking (Implemented)
- **Subjects**: Name, code, min attendance %
- **Class schedule**: Day, time, room (needs enhancement)
- **Attendance log**: Present/absent/cancelled per date
- **Skip calculator**: "Can skip 3 more classes"
- **Today's classes**: Quick mark buttons

### ✅ Event Confirmation (Implemented)
- **Past events section**: Shows last 24h unconfirmed events
- **Tap to cycle**: 1=green (done), 2=red (skipped), 3=popup
- **Popup options**: Postponed, cancelled, rescheduled
- **1.5s delay**: Preview before confirming
- **AI visibility**: Confirmation status in entity metadata

### ⚙️ Feature Toggles (Implemented)
- **Settings page**: Toggle Food/Attendance/People
- **Sidebar visibility**: Hides disabled features
- **AI context**: Will exclude disabled features from prompt
- **Default**: All enabled

### 🎯 Priority Stack (Planned)
**Smart prioritization based on:**
1. Deadlines (urgency)
2. Importance weight (user-set)
3. Energy level (inferred from time/mood)
4. Momentum (recent activity on project)
5. Commitment load (how overloaded today)

**Output:**
- **Tier 1**: Must do today
- **Tier 2**: Should do today
- **Tier 3**: Optional/backlog

### 📊 Productive Hours (Planned)
- **Activity categories**: Productive / Neutral / Unproductive
- **24h bar**: Color-coded day view
- **Weekly heatmap**: Hour × Day productivity matrix
- **Insights**: "Your best deep work time is 2-6 PM"

### 👥 Relationship Tracker (Planned)
- **PERSON entity**: Name, relationship type, frankness level
- **Interaction logging**: Auto-detect from calendar/messages
- **Decay alerts**: "Haven't talked to X in 10 days"
- **Promise tracking**: Link commitments to people

---

## 🔧 Technical Notes

### AI Context Strategy
```
BASE CONTEXT (always included):
  - User settings, preferences
  - Active contexts and goals (titles only)
  - Last 5 messages
  - Today's events + next 3 days
  - Quick stats (pending tasks, streaks)

ON-DEMAND TOOLS (AI calls when needed):
  - get_entity_details(id)
  - search_entities(query)
  - get_calendar_range(start, end)
  - get_food_stats(days)
  - get_attendance_summary()
```

### Operation Shortcodes
| Short | Full | Purpose |
|-------|------|---------|
| c | create_entity | Create new entity |
| u | update_entity | Update fields |
| d | delete_entity | Delete entity |
| f | log_food | Log food entry |
| rel | create_relationship | Link entities |

### Metadata Patterns
```typescript
// Subtasks in metadata
metadata.subtasks: [{ id, text, done, estimated_minutes }]

// Activity log in metadata
metadata.activity_log: [{ id, title, timestamp, duration_minutes }]

// Event confirmation
metadata.confirmation_status: 'confirmed' | 'skipped' | 'cancelled' | 'postponed'

// Class schedule
metadata.schedule: [{ day_of_week, start_time, end_time, room }]
```

---

## 🎨 UI/UX Principles

1. **Glanceability**: See everything important in 3 seconds
2. **Tap-First**: Mobile interactions (tap, swipe, hold)
3. **Progressive Disclosure**: Simple by default, details on demand
4. **Visual Hierarchy**: Color-coded priorities and statuses
5. **Gamification**: XP, levels, streaks, confetti
6. **Dark Mode**: Premium aesthetic, easy on eyes

---

## 📱 Deployment Strategy

### Current: PWA (Progressive Web App)
- Deployed to Vercel/Netlify
- Installable on mobile via "Add to Home Screen"
- Works offline with service worker

### Future: Native (Capacitor)
- iOS App Store
- Google Play Store
- Push notifications
- Widgets

---

## 📅 Weekly Development Cycle

| Day | Focus |
|-----|-------|
| Mon | Bug fixes + polish |
| Tue | New feature dev |
| Wed | New feature dev |
| Thu | Testing + docs |
| Fri | Code review + deploy |
| Sat | User testing + feedback |
| Sun | Planning next week |

---

## 🏆 Success Metrics

| Metric | Target |
|--------|--------|
| Daily active usage | Personal: Daily |
| Task completion rate | >70% |
| Streak maintenance | 80% days tracked |
| Food logs/week | 21+ (3/day) |
| Event confirmation rate | 90% |

---

*This document is a living specification. Updated as features are implemented.*

# Flowmate V3.1 Feature Roadmap — "Suvansh Brain OS"

> Last Updated: December 2024
> See also: [FEATURE_IDEATION.md](./FEATURE_IDEATION.md) for comprehensive vision and implementation plan.

---

## ✅ IMPLEMENTED (V3.0 Core)

### Data Model Refinements
- [x] Nested subtasks in metadata (`add_subtask`, `toggle_subtask`, `delete_subtask`)
- [x] Embedded activity logs (`log_to_entity`)
- [x] Auto-archive stale entities (`archive_entity`)
- [x] Smart graph visibility filters (archived, old completed, past events, orphans)
- [x] Duplicate entity detection utility

### Food Tracking
- [x] `FoodLogEntry` + `FoodPreferences` types
- [x] `log_food` operation with vendor/source tracking
- [x] Dietary preference dropdown (veg/non-veg/vegan/eggetarian)
- [x] Calorie + cost tracking per meal
- [x] Vendor analytics (top vendors, spend breakdown)
- [x] Meal pattern breakdown (B/L/D/Snack)
- [x] Delete food logs, source/rating badges
- [x] AI context for food questions

### Attendance Tracking (V3.1)
- [x] Subject types with min attendance %
- [x] Attendance log (present/absent/cancelled)
- [x] Skip calculator ("Can skip X more")
- [x] Today's classes with quick mark
- [x] Attendance dashboard

### Feature Toggles (V3.1)
- [x] Toggle Food/Attendance/People in Settings
- [x] Sidebar conditionally shows/hides disabled features
- [ ] AI context exclusion for disabled features

### Event Confirmation (V3.1)
- [x] Dashboard "Confirm Past Events" section
- [x] Tap-to-cycle: 1=green (done), 2=red (skipped), 3=popup
- [x] Popup options: Postponed, Cancelled, Rescheduled
- [x] 1.5s preview delay before confirming

---

## 🎯 PRIORITY 1: Behavioural Core (Next Sprint)

### Productive vs Unproductive Hours (CORE FEATURE)
> *"Log my life, see what I did, analytics to improve" — Suvansh*

- [ ] Categorize activities: productive / neutral / unproductive
- [ ] 24-hour daily productivity bar (green/yellow/red/grey)
- [ ] Weekly insights: "Most productive on Mon/Tue"
- [ ] "Late evening productivity drops 60%"
- [ ] Time breakdown by category/project

### Commitment Load Index
- [ ] Rate each project/area by intensity
- [ ] Daily load score (1-10)
- [ ] "Do NOT take new tasks today" warning
- [ ] Burnout prediction based on load + sleep + intensity

### Execution Reliability Engine (OPTIONAL — User Toggle)
> *Not core — for users who want schedule-based tracking*

- [ ] Track scheduled vs actual task execution
- [ ] Detect missed/late tasks
- [ ] Reschedule count tracking (procrastination loops)
- [ ] Execution Reliability Score (ERS)
- [ ] "You start tasks 23 min late on average" insights

---

## 🎯 PRIORITY 2: Social Brain (PERSON + PROMISE)

### Relationship Radar
- [ ] `PERSON` entity type with metadata
- [ ] Track: last_met, relationship_quality (1-10), frankness_level
- [ ] "Haven't talked to X in 10 days"
- [ ] Meeting frequency patterns

### Promise Tracker
- [ ] `PROMISE` entity type
- [ ] Auto-detect from "I'll..." / "Remind me to..."
- [ ] Link promises to people
- [ ] "Follow up on IEEE recruitment results"

---

## 🎯 PRIORITY 3: Cognitive Intelligence

### Energy & Fatigue Model
- [ ] Sleep quality → productivity correlation
- [ ] Heavy food → low productivity detection
- [ ] "Cognitive fatigue: 65% — do light tasks"
- [ ] Optimal deep-work time prediction

### Attention Drift Monitor
- [ ] Context switch frequency tracking
- [ ] "7 switches in 20 min — focus block recommended"
- [ ] Hyperfocus detection

### Mood × Productivity Matrix
- [ ] Infer mental state from journaling
- [ ] Trigger patterns (alcohol, heavy food, overstimulation)
- [ ] "Every time you X → next day productivity -70%"

---

## 🎯 PRIORITY 4: Knowledge & Academics

### Academic Knowledge Graph
- [ ] Topic → mastery level mapping
- [ ] Prerequisite relationships
- [ ] "Weakest in: Transformers → Attention"
- [ ] Exam readiness predictor

### Attendance Tracker
- [ ] Min attendance required per subject
- [ ] Buffer simulator: "Can miss 3 more AI classes"
- [ ] Teacher strictness index

### Course Module Builder
- [ ] Paste course outline → auto-generate subtasks
- [ ] Progress tracking per module
- [ ] "Finished 5/11 Coursera courses"

---

## 🎯 PRIORITY 5: Integrations

### Gmail → Event Ingestion
- [ ] Connect Gmail (read-only)
- [ ] Parse actionable emails → suggested events
- [ ] Categories: academic, internship, society, career
- [ ] Daily briefing from emails

### Slack Integration
- [ ] OAuth + channel subscription
- [ ] Detect deadlines, meetings, tasks from messages
- [ ] Convert to Flowmate events

### WhatsApp (Forward-to-Email)
- [ ] Dedicated inbox for forwarded messages
- [ ] Parse WhatsApp → events
- [ ] Group-context awareness

---

## 🎯 PRIORITY 6: Life OS Modules

### Life Pillars Balance
- [ ] 6 pillars: Career, Academics, Entrepreneurship, Skills, Health, Social
- [ ] Weekly radar chart
- [ ] "22h on entrepreneurship, 0h on DSA"

### Opportunity Ranking Engine
- [ ] Track potential leads, competitions, connections
- [ ] ROI scoring
- [ ] "High ROI: Contact Staffroom schools before pilot"

### Trajectory Predictor
- [ ] "At current pace, Staffroom launch-ready by Jan 15"
- [ ] "6 more hours ML revision needed for A grade"

---

## 🎯 PRIORITY 7: Advanced Behavioural

### Cognitive Momentum Engine
- [ ] Project momentum decay/growth tracking
- [ ] "Staffroom momentum high — do next task now"

### Personal Philosophy Engine
- [ ] Extract life rules from repeated statements
- [ ] "This task breaks your rule: DSA first"

### Risk-Escalation System
- [ ] Calm → Warm → Hot → Critical states
- [ ] "Entering Critical zone — reduce commitments"

### Regret Minimization
- [ ] Learn what you regret
- [ ] "Skip DSA today → 78% guilt probability tomorrow"

### Habit Recovery Engine
- [ ] Track habit breaks + recovery time
- [ ] "Average recovery window: 2 days — restart with 20 min"

---

## 🎯 PRIORITY 8: Anti-Distraction

### Impulse Firewall v2
- [ ] Detect distraction triggers
- [ ] Grounding interventions
- [ ] "This looks like stress-born impulse"

### Urge Prediction Model
- [ ] Pattern: overstimulation + late night + after coding = risk
- [ ] "Shut down device in 10 minutes"

---

## 🎯 PRIORITY 9: Intelligence Features

### Memory Convergence
- [ ] Build compact internal model of user
- [ ] "Here's what I understand about you"
- [ ] Periodic refinement

### Smart Weekly Review
- [ ] Habits kept/broken
- [ ] Goal progress
- [ ] Stagnating projects
- [ ] Approaching deadlines

### Temporal Personality Model
- [ ] Hour-by-hour focus/stress/creativity scoring
- [ ] "Don't do DSA at 11 PM"
- [ ] "Flowmate dev best in 2-6 PM hyperfocus zone"

---

## 🎯 PRIORITY 10: UI/UX Enhancements

### Graph Clustering
- [ ] Areas as clusters (Work, College, IEEE)
- [ ] Goals inside clusters
- [ ] Visual hierarchy

### Brain Filters
- [ ] Today mode, Work mode, Study mode, Clean mode
- [ ] Deadline mode (sort by urgency)
- [ ] Quick toggles

### Progress Bars Everywhere
- [ ] Goal: 5/11 courses
- [ ] Habit streaks inline
- [ ] Visual dopamine

---

## Implementation Notes

### Architecture Principles
1. **Container Model**: High-level entities contain nested metadata, not separate nodes
2. **Logs Inside Entities**: Activity logs in metadata, not as ACTIVITY entities
3. **Graph = Cognitive Model**: Only meaningful items become graph nodes
4. **Auto-Visibility**: System decides what to show, not manual hiding

### AI Tool Strategy
- `update_entity` for progress changes, not `create_entity`
- Nested metadata paths: `metadata.modules[0].completed = true`
- Smart entity resolution by title or ID prefix

---

## Documentation Updates Needed
- [ ] Update `08-ideation-map.md` with new features
- [ ] Create `09-brain-os-architecture.md`
- [ ] Update system instructions for AI operations
- [ ] Add usage examples to `07-ai-tools.md`

---

## 🏗️ FUTURE ARCHITECTURE (Dec 2024 Notes)

### AI Context Optimization
> Reference: [Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)

- [ ] Sparse AI context: Only tags, goals, and high-level entities in base context
- [ ] Recent items: Last 10 message creations only
- [ ] Upcoming context: Next week/month events in base payload
- [ ] **On-demand tools** for detailed data:
  - `get_calendar_events(date_range)` - fetch specific date ranges
  - `get_entity_details(entity_id)` - full entity with subtasks/logs
  - `search_entities(query)` - semantic search
  - `get_activity_log(entity_id, days)` - recent activity

### Mobile-First (Capacitor)
- [ ] Migrate to Capacitor for native iOS/Android
- [ ] Offline-first: Complete IndexedDB/SQLite local storage
- [ ] Async Firestore sync with conflict resolution
- [ ] Background sync when online

### Native Features
- [ ] Haptic feedback on:
  - Task complete ✅
  - Streak milestone 🔥
  - Focus session start/end ⏱️
- [ ] Push notifications:
  - Upcoming events
  - Deadline warnings
  - Streak at risk
  - Daily briefing
- [ ] iOS/Android widgets

### Flexible Recurrence (Implemented Dec 2024)
- [x] INTERVAL type: "Every N days/weeks"
- [x] `flexible_timing` flag: Can push to next day
- [x] When pushed, next occurrence calculates from completion date
- [x] RRULE field for complex patterns


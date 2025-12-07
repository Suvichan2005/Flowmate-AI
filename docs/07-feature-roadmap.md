# Flowmate Feature Roadmap

## Completed (Dec 2025)

### ✅ Core Fixes
- [x] **Timezone Fix**: AI outputs dates with IST offset (+05:30) instead of UTC
- [x] **EntityDetailPanel**: Rebuilt from corruption with full edit functionality
- [x] **Knowledge Base**: Enhanced with tabs, universal tags, contexts, usage counts
- [x] **Chat Channels**: Separated flows for General, Schedules, Food, Finance.
- [x] **Schedules View**: Dedicated UI for recurrences and menus.

### ✅ Integrations
- [x] **Google Calendar Sync**: Full 2-way sync with OAuth.
- [x] **Firebase Auth/Sync**: Cloud backup enabled.

---

## Proposed Features

### 🔴 High Priority

#### 1. PWA & Mobile Polish
- Service worker for true offline capability.
- "Add to Homescreen" manifest.
- Touch alignment for Graph View.

#### 2. Advanced Food Tracking
- Dedicated Food Log UI (currently chat-only).
- Nutrition API integration (Calorie lookup).

#### 3. Finance Dashboard
- Visualization of spending logged in Finance channel.
- Monthly budget limits.

### 🟡 Medium Priority

#### 4. The "Social Brain"
- Implement `PERSON` and `PROMISE` entities.
- Relationship Radar view.

#### 5. Natural Language Enhancements
- Approximate date parsing ("Next Tuesday").
- Voice-to-Action refinements.

---

## Technical Debt

- [ ] Optimize D3 Graph for >500 nodes (use WebGL?).
- [ ] Granular Firestore Sync (Delta updates instead of full snapshot).
- [ ] Unit Tests for `store.applyOperations`.

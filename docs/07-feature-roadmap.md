# Flowmate Feature Roadmap

## Completed (Dec 2025)

### ✅ Core Fixes
- [x] **Timezone Fix**: AI outputs dates with IST offset (+05:30) instead of UTC
- [x] **EntityDetailPanel**: Rebuilt from corruption with full edit functionality
- [x] **Knowledge Base**: Enhanced with tabs, universal tags, contexts, usage counts

### ✅ Integrations
- [x] **Google Calendar Sync**: Full 2-way sync with OAuth, duplicate prevention, and conflict resolution

---

## Proposed Features

### 🔴 High Priority

#### 1. Mobile & PWA
- Responsive sidebar refinements
- PWA manifest for install
- Service worker for offline capability

#### 2. Offline Support (Deep)
- IndexedDB (Dexie.js) fallback when offline
- Sync queue robust retries

#### 2. Mobile Responsiveness
- Responsive sidebar (hamburger menu)
- Touch-friendly graph interactions
- PWA manifest for install

#### 3. Offline Support
- Service worker for offline access
- IndexedDB fallback when offline
- Sync queue for pending operations

---

### 🟡 Medium Priority

#### 4. Recurring Task Improvements
- Visual indicator for recurring items
- Skip occurrence option
- Recurrence preview

#### 5. Natural Language Date Parsing
- Enhance AI to handle "next Tuesday at 3pm"
- Date suggestion chips in UI
- Relative date display ("in 2 days")

#### 6. Collaboration Features
- Shared projects/goals
- Real-time cursors in graph view
- Activity feed

#### 7. Notifications
- Browser push notifications for deadlines
- Daily digest email
- Focus session reminders

---

### 🟢 Nice to Have

#### 8. Integrations
- Notion import
- Todoist import
- GitHub issues sync
- Slack notifications

#### 9. Advanced Analytics
- Productivity trends over time
- Goal completion velocity
- Time tracking reports

#### 10. Themes & Customization
- Light mode
- Custom color schemes
- Compact view option

#### 11. AI Improvements
- Voice-to-task with better parsing
- Smart priority suggestions
- Automatic tag inference

---

## Technical Debt

- [ ] Add unit tests for store operations
- [ ] Add E2E tests for critical flows
- [ ] Optimize graph rendering for 100+ nodes
- [ ] Add error boundaries to all views
- [ ] Implement proper loading states

---

## Getting Started with Firebase

To enable cloud sync, create a Firebase project and add these environment variables:

```bash
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

Then restart the dev server and the Auth features will be enabled.

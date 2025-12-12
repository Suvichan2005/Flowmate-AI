# Flowmate

<div align="center">
  <img width="1200" height="475" alt="Flowmate Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

**AI-powered productivity orchestration platform** - Manage goals, projects, tasks, and knowledge through a graph-based data structure with natural language.

## Features

- 🤖 **AI Orchestrator** - Natural language chat powered by Gemini 2.5 Flash
- 🕸️ **Knowledge Graph** - Interactive D3.js visualization of your productivity data
- 📅 **Calendar** - Drag-and-drop event scheduling with multiple views
- 📚 **Knowledge Base** - AI-powered Q&A over your notes with tag filtering
- 🔥 **Focus Timer** - Pomodoro-style sessions with activity logging
- 🍕 **Food Tracking** - Meal logging with vendor analytics and nutrition tracking
- 📊 **Attendance** - Academic class attendance with skip calculator
- ⚡ **Quick Streaks** - Lightweight daily habit tracking
- 🎮 **Gamification** - XP system and productivity levels
- ☁️ **Cloud Sync** - Firebase authentication and real-time sync
- 🎤 **Voice Mode** - Real-time voice AI interaction
- 📱 **Mobile Ready** - Responsive design with PWA support

## Quick Start

```bash
# Prerequisites: Node.js 18+

# Install dependencies
npm install

# Set up environment (create .env.local)
echo "API_KEY=your_gemini_api_key" > .env.local

# Start dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Firebase Setup (Optional)

For cloud sync and authentication:

1. Create a project at [Firebase Console](https://console.firebase.google.com)
2. Enable **Authentication** → Email/Password + Google
3. Create a **Firestore Database** (Standard edition)
4. The Firebase config is already set in `services/firebase.ts`

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + TypeScript |
| Styling | TailwindCSS |
| State | Zustand (localStorage + Firestore) |
| AI | Google Gemini API |
| Visualization | D3.js |
| Cloud | Firebase (Auth + Firestore) |
| Build | Vite |

## Project Structure

```
├── App.tsx              # Main application shell
├── store.ts             # Zustand global state (~81KB)
├── types.ts             # TypeScript definitions
├── components/          # 42 React components
├── services/
│   ├── geminiService.ts # AI orchestration
│   ├── firebase.ts      # Firebase config & auth
│   ├── firestoreSync.ts # Cloud data sync
│   ├── googleSync.ts    # Google Calendar sync
│   ├── graphAnalyzer.ts # Graph health analysis
│   └── liveSession.ts   # Voice AI
├── utils/               # Helper functions
└── docs/                # Documentation (11 files)
```

## Documentation

See the [/docs](./docs) folder for detailed documentation:
- [Overview](./docs/00-overview.md)
- [Structural Analysis](./docs/01-structural-analysis.md)
- [Semantic Analysis](./docs/02-semantic-analysis.md)
- [Functional Analysis](./docs/03-functional-analysis.md)
- [Architecture](./docs/04-architecture-analysis.md)
- [Components Reference](./docs/05-components-reference.md)
- [Services Reference](./docs/06-services-reference.md)
- [Feature Roadmap](./docs/07-feature-roadmap.md)

## License

MIT


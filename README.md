# Flowmate

**AI-powered productivity platform** — manage goals, projects, tasks, and knowledge through a graph-based data model with natural language.

## Features

- 🤖 **AI Orchestrator** — natural language chat powered by Gemini 3 Flash
- 🕸️ **Knowledge Graph** — interactive D3.js visualization of your productivity data
- 📅 **Calendar** — drag-and-drop scheduling with month/week/day/agenda views
- 📚 **Knowledge Base** — AI-powered Q&A over your notes with tag filtering
- 🔥 **Focus Timer** — Pomodoro-style sessions with activity logging
- 🍕 **Food Tracking** — meal logging with vendor analytics and nutrition tracking
- 📊 **Attendance** — academic class attendance tracking with skip calculator
- ⚡ **Quick Streaks** — lightweight daily habit tracking
- 🎮 **Gamification** — XP system and productivity levels
- ☁️ **Cloud Sync** — Firebase auth and real-time Firestore sync
- 🎤 **Voice Mode** — real-time voice interaction via Gemini Live API
- 📱 **Mobile Ready** — responsive design with PWA support

## Quick Start

```bash
# Prerequisites: Node.js 18+

# Install dependencies
npm install

# Set up environment
cp .env.example .env.local
# Then edit .env.local with your API keys

# Start dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Firebase Setup (Optional)

Cloud sync and authentication require Firebase:

1. Create a project at [Firebase Console](https://console.firebase.google.com)
2. Enable **Authentication** → Email/Password + Google sign-in
3. Create a **Firestore Database**
4. Copy your project config values into `.env.local` (see `.env.example` for required keys)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript |
| Styling | TailwindCSS |
| State | Zustand 5 (localStorage + Firestore) |
| AI | Google Gemini 3 Flash (`@google/genai`) |
| Visualization | D3.js force-directed graph |
| Cloud | Firebase (Auth + Firestore) |
| Build | Vite |

## Project Structure

```
├── App.tsx              # Main application shell + chat UI
├── store.ts             # Zustand global state
├── types.ts             # TypeScript type definitions
├── components/          # React components
├── services/
│   ├── ai/              # Gemini orchestrator + context builder
│   ├── firebase.ts      # Firebase config & auth
│   ├── firestoreSync.ts # Cloud data sync
│   ├── googleSync.ts    # Google Calendar integration
│   ├── graphAnalyzer.ts # Graph topology analysis
│   └── liveSession.ts   # Voice AI (Gemini Live API)
├── utils/               # Helpers (validation, retry, debounce)
└── docs/                # Technical documentation
```

## Documentation

See [/docs](./docs) for technical docs:
- [Overview](./docs/00-overview.md)
- [Structural Analysis](./docs/01-structural-analysis.md)
- [Semantic Analysis](./docs/02-semantic-analysis.md)
- [Functional Analysis](./docs/03-functional-analysis.md)
- [Architecture](./docs/04-architecture-analysis.md)
- [Components Reference](./docs/05-components-reference.md)
- [Services Reference](./docs/06-services-reference.md)

## License

MIT — see [LICENSE](./LICENSE)

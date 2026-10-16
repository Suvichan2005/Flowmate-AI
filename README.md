# Flowmate

> **A graph-native productivity workspace for connecting goals, projects, tasks, schedules, and the conversations around them.**

Flowmate brings planning into one navigable workspace. Its typed relationships link the work behind a goal, while shared Dashboard, Graph, Calendar, Timeline, Analytics, and Library views make those connections easier to follow.

**[Open Flowmate](https://flowmate-ai.web.app/)** · [View the source on GitHub](https://github.com/Suvichan2005/Flowmate-AI)

[![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white)](https://vite.dev/)
[![D3.js](https://img.shields.io/badge/D3.js-7-f9a03c?logo=d3&logoColor=white)](https://d3js.org/)
[![Zustand](https://img.shields.io/badge/Zustand-5-443e38)](https://github.com/pmndrs/zustand)
[![Firebase](https://img.shields.io/badge/Firebase-optional-ffca28?logo=firebase&logoColor=222)](https://firebase.google.com/)
[![Gemini](https://img.shields.io/badge/Gemini-configurable-8e75b2?logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![MIT](https://img.shields.io/badge/License-MIT-2f7d5b.svg)](./LICENSE)

## Why Flowmate

Goals, tasks, schedules, notes, and conversations often live in separate tools. That makes everyday planning questions difficult: which project supports a goal, what work depends on a milestone, and how do a meeting and its follow-up fit together?

Flowmate represents work as typed entities and relationships. The Graph visualizes those connections; the other views present the same workspace for planning, review, and day-to-day use.

## What you can do

- **Plan with connected records:** create and edit goals, projects, tasks, events, habits, notes, and other supported entities.
- **Explore relationships:** add typed links and inspect the workspace in an interactive D3 graph.
- **Use multiple planning views:** review work in Dashboard, Calendar, Timeline, Analytics, and Library.
- **Branch conversations:** create alternate conversation paths and navigate their histories.
- **Track progress:** review project and goal progress, habits, focus sessions, and productivity summaries.
- **Personalize Flowmate:** choose among four complete palettes, with local persistence and cross-tab synchronization.
- **Work locally:** core workspace capture and views use browser storage. Optional Firebase sign-in enables cloud synchronization.

## Gemini assistance and user control

When configured, Gemini supports conversational planning grounded in workspace context. A key entered through Settings is held in memory for the active browser tab and sent from the browser to Google's Gemini API. AI-generated operations are subject to Flowmate's review and confirmation pipeline; a model response alone does not apply a workspace change.

Live provider check: four short requests through the deployed Chat experience succeeded with **Gemini 3.8 Flash**, using a synthetic workspace. The final response accurately identified the saved goal, project, event, tasks, and relationship state. No changes were proposed or executed. The runtime key was cleared from the isolated test session afterward; it is not part of the deployment or repository.

AI assistance requires a configured Gemini key and network access. Browser API keys are visible to the browser environment, so use a suitably restricted key. Do not place Gemini credentials in Vite `VITE_*` build variables or commit them.

## Architecture

Flowmate is a client-side React application without an application server in this release. The browser owns local workspace state. Firebase and Gemini are optional direct client integrations.

~~~mermaid
flowchart LR
  User[User] --> UI[React views]
  UI --> Store[Zustand store]
  Store --> Kernel[Domain kernel and validated operations]
  Kernel --> Projections[Dashboard, Graph, Calendar, Timeline, Library]
  Store <--> Local[Browser storage]
  Store -. optional signed-in sync .-> Firebase[Firebase Auth and Firestore]
  UI -. configured runtime key .-> Gemini[Google Gemini API]
  Gemini --> Tools[Declared workspace tools]
  Tools --> Review[Review proposed operations]
  Review -->|user confirms| Kernel
  Review -->|user declines| Stop[No mutation]
  SW[Service worker caches application shell] --> UI
~~~

## Data model and cross-view behavior

Entities represent goals, projects, tasks, events, habits, and other supported records. Typed relationships connect entity identifiers with links such as `PART_OF`, `DEPENDS_ON`, `FULFILLS`, `PRECEDES`, and `RELATED_TO`.

Validated operations update the shared workspace store. Graph, Dashboard, Calendar, Timeline, and Library read projections over that state, keeping changes visible across views. Browser storage provides local persistence; signed-in users can enable user-scoped synchronization with Firestore.

## Engineering choices

- **A shared domain model:** views project the same entities and typed relationships instead of maintaining separate feature-specific copies.
- **Review before mutation:** proposed AI operations pass through validation and user confirmation.
- **Local-first access:** workspace capture and core views remain available without a remote account.
- **Explicit integration boundaries:** Firebase synchronization and Gemini assistance have separate configuration and failure paths.

## Technology

| Area | Technologies |
| --- | --- |
| Application | React 19, TypeScript, Vite |
| State and domain | Zustand, Flowmate domain kernel, typed entity relationships |
| Visualization | D3.js, Recharts |
| Styling and icons | Tailwind CSS 4, Lucide |
| Optional cloud | Firebase Authentication, Cloud Firestore |
| Optional AI | Google Gemini via `@google/genai` |
| Verification | Vitest, Testing Library, Playwright, TypeScript, project invariants |

## Repository map

~~~text
App.tsx                  Application shell and route composition
components/              Workspace views and user interactions
services/kernel/         Domain operations and validation
services/ai/             Gemini client, context, tools, and orchestration
services/sync/           Optional cloud synchronization
services/storage/        Local persistence adapters
store.ts                 Zustand application state
store/kernelProjection.ts View projections over kernel entities
utils/calendarConflicts.ts Calendar interval conflict checks
browser-tests/           Browser acceptance journeys
tests/                   Unit and integration coverage
docs/assets/             Deployed application screenshots
~~~

## Run locally

Requirements: Node.js 20 or a current supported LTS release, plus npm.

~~~bash
git clone https://github.com/Suvichan2005/Flowmate-AI.git
cd Flowmate-AI
npm ci
npm run dev -- --host 127.0.0.1
~~~

Open the loopback URL printed by Vite. Start from `.env.example` for optional Firebase browser configuration. Never commit `.env.local`. Configure Gemini at runtime in Settings; do not put its key in the build environment.

## Verification

Run these checks from the repository root:

~~~bash
npm run test:release
npm run check:types
npm run check:invariants
npm run check:themes
npm run build
~~~

The deployed browser acceptance pass covered workspace editing across views and reload, conversation and branch controls, responsive layouts, four themes, and offline application-shell reload. Firebase Authentication and Firestore received a bounded preview smoke test with synthetic data. Four bounded live Gemini requests succeeded through the deployed Chat UI as described above.

Google sign-in, Google Calendar integration, every Firebase security-rule scenario, and multi-user collaboration were not established by these checks.

## Security and limitations

- Firebase browser configuration is public client configuration, not an authorization secret. Protect user data with Firebase Authentication and backend security rules.
- A Hosting preview connected to the production Firebase project still uses that backend; use synthetic accounts and records for provider testing.
- Gemini requires a user-configured runtime key. Treat browser keys as exposed to the browser and restrict their API access and quota.
- Local data is browser-profile-specific until optional cloud synchronization is configured.
- This release is a personal productivity workspace, not a hosted team collaboration service.

## Future direction: Flowmate Next

Flowmate Next is a product and research direction, not a capability claim about this deployed web release. It explores richer contextual memory and more capable assistance while the live Flowmate Web application remains the feature set described above.

## License

Flowmate is available under the MIT License. See [LICENSE](LICENSE).

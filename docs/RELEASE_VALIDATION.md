# Release validation

Run from an isolated checkout pinned to the complete candidate commit, using a fresh lockfile install. These checks do not publish or deploy.

```powershell
npm ci --no-audit --no-fund
npm run check:types
npm run test:release
npm run check:invariants
$env:VITE_SECRET_CANARY='SYNTHETIC_BUILD_MARKER_ONLY'
npm run build
$env:RELEASE_SENTINEL=$env:VITE_SECRET_CANARY
npm run release:scan -- --directory dist --base <full-public-baseline-sha> --candidate <full-candidate-sha> --sentinel-env RELEASE_SENTINEL
```

Use a synthetic marker, never a real credential. A sentinel must not occur in public assets. Do not skip failed transition tests or convert them to expected failures to obtain a green release. The two-worker release command bounds local resource pressure; it does not extend normal interaction-test deadlines.

The scanner inspects complete artifact bytes and each public-bound commit tree, including deleted historical blobs. Model build-variable references are a current-source design gate; removed references alone are not proof of historical key exposure. Google API-key-shaped matches require service/restriction review: their shape cannot establish whether they are public Firebase configuration or privileged model credentials. Exit 0 means no defined pattern matched, exit 1 means findings, exit 2 means inspection could not complete. Partial Git argument pairs, empty directories, symbolic links and unreadable inputs fail closed. Findings omit matched content and redact suspicious locators.

This heuristic is supplemental. Independently review the full diff, commit ancestry, documentation, encoded/configuration material, production Firebase authorization rules and deployment configuration. No regex scan proves that a repository contains no private information or privileged credentials.

Serve the production output only on loopback:

```powershell
npm run preview -- --host 127.0.0.1 --port 4182 --strictPort
```

Use a separate synthetic browser origin/profile. Verify demo entry/use/exit/reload, personal data restoration, task editing/completion/persistence, goals/projects/relationships, keyless chat and session navigation, calendar conflicts, graph visibility, keyboard focus, responsive layout and provider failures. Mock transport tests do not verify production cloud or cross-device behavior. Record the tested full SHA and browser limitations. Re-review any integrated candidate; passing a predecessor does not certify it.

## 2026-10-20 managed-AI acceptance checkpoint

The currently published preview is source-pinned to `25e6c345fbf93e088a0fdb4bc4c2baa76ee8b693`; Hosting version `e8bd19726957a3dc`. Production remains on source `658929364cd4350d2d857bcdda35b0f5bedd9149`; Hosting version `3145575cc9193f6e`. The active Gen2 `managedGemini` Function was last updated 2026-10-19, uses Secret Manager version 4, and enforces `APP_CHECK_REQUIRED=true`. The project budget is enabled at the owner-approved $20/$5/$0.50 limits. Managed text is open only in exact-identity test mode; general access is closed. Managed Live is disabled.

An authenticated, non-privileged account on the published preview completed one genuine managed Gemini Chat turn and one genuine Dashboard Briefing. The response and briefing were visible; the Chat and Briefing counters each advanced by one, and a reload retained the briefing. The server settled both requests, leaving no reserved exposure. This establishes authenticated preview provider acceptance only; it does not establish fresh-guest or production acceptance.

A separate Chrome profile failed during client reCAPTCHA Enterprise token acquisition (`appCheck/recaptcha-error`), before a managed request was attempted. The interactive preview browser did obtain accepted App Check and complete the two requests. A read of the registered reCAPTCHA Enterprise configuration returned permission denied for the active gcloud release principal. The exact remaining diagnostic permission is `firebaseappcheck.recaptchaEnterpriseConfig.get` on project `flowmate-ai`; do not lower the score, relax enforcement, or use a debug token. The smallest grant is a project-scoped custom role containing only that permission. Public guest and production Chat/Briefing remain unaccepted until this configuration can be inspected and a fresh guest journey succeeds.

Managed Live remains unaccepted and disabled. The deployed browser-direct ephemeral-token flow has a one-use token and requested expiry, but no server-owned socket termination or trustworthy pre-call cost ceiling. A Firestore client-end acknowledgement is not proof that Gemini closed its connection. The Gemini Live API reports usage metadata during the session, but costs compound with retained context; a server-controlled relay or equivalent enforced transport is required before enabling it.

Local work since this checkpoint adds durable request-failure records excluded from future AI context, actionable hard-limit guidance, explicit guest Briefing exhaustion, and an owner-only evidence-based cost-reservation reconciliation action. The current local candidate is not deployed. Local verification: 739 client tests passed; 11 focused usage/guidance tests passed after the last client change; 9 Functions unit tests passed; 17 ledger/budget emulator tests passed in the initial run; the owner budget/admin emulator suite passed 2/2 on an isolated Firestore emulator; the updated guest Briefing ledger and reset tests passed 2/2. The separate admin Auth integration test file did not run because its combined Auth/Firestore emulator configuration was unavailable. TypeScript, production build, and applicable architecture invariants passed. These results do not close guest App Check, production, or Live acceptance.

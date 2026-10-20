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

The published preview's release manifest was verified against source `fd0352427193376f7011f1d2a3083d42cd47dbfc`; its current Hosting version ID was not recorded in this checkpoint. Production was last verified on source `658929364cd4350d2d857bcdda35b0f5bedd9149` (Hosting version `3145575cc9193f6e`). The active Gen2 `managedGemini` revision is `managedgemini-00014-hip`, uses Secret Manager version 4, and enforces `APP_CHECK_REQUIRED=true`. The project budget is enabled at the owner-approved $20/$5/$0.50 limits. Managed text is open only in exact-identity test mode; general access is closed. Managed Live is disabled. A current read-only Cloud Run inventory shows only `managedGemini`; no Live relay is deployed.

An authenticated, non-privileged account on the published preview completed one genuine managed Gemini Chat turn and one genuine Dashboard Briefing. The response and briefing were visible; the Chat and Briefing counters each advanced by one, and a reload retained the briefing. The server settled both requests, leaving no reserved exposure. This establishes authenticated preview provider acceptance only; it does not establish fresh-guest or production acceptance.

A separate Chrome profile failed during client reCAPTCHA Enterprise token acquisition (`appCheck/recaptcha-error`), before a managed request was attempted. The interactive preview browser did obtain accepted App Check and complete the two requests. The configuration read initially failed because ADC lacked a quota project; repeating the same GET with `x-goog-user-project: flowmate-ai` succeeded. The registered web app is `1:297013476805:web:bb5fe68c411ff7e9509fac`, bound to site key `6Ld7v_ItAAAAAEpDjstv3-MWIJLbTY-7kUl_38cD`, with a one-hour token TTL and minimum valid score 0.5. The Enterprise key uses score-based integration, disallows arbitrary domains, and allows the production, Firebase, and established preview hostnames. No score or enforcement threshold was changed, and no debug token was used. This removes the configuration-read blocker, but a fresh guest and production Chat/Briefing journey remain unaccepted.

Managed Live remains unaccepted and disabled. The deployed browser-direct ephemeral-token flow has a one-use token and requested expiry, but no server-owned socket termination or trustworthy pre-call cost ceiling. A Firestore client-end acknowledgement is not proof that Gemini closed its connection. The Gemini Live API reports usage metadata during the session, but costs compound with retained context; a server-controlled relay or equivalent enforced transport is required before enabling it.

Local work since this checkpoint adds durable request-failure records excluded from future AI context, actionable hard-limit guidance, explicit guest Briefing exhaustion, and an owner-only evidence-based cost-reservation reconciliation action. Guest allowance notices now make sign-in the sole CTA instead of suggesting BYOK. Managed Chat now sends the complete selected transcript to server-side token/cost preflight rather than silently applying the rolling history window; the explicit recent-context retry forks a separate branch and preserves the original. The published preview remains pinned to `fd035...`; subsequent changes in the release checkout are local and uncommitted. The current base passed `npm run test:release` (89 files, 755 tests); after the full-history change, the three focused history/branching/guidance files passed 59 tests, `npm run check:types`, `npm run build`, and `npm run check:invariants` passed. Functions unit tests passed 13/13 and the full Auth/Firestore demo-emulator suite passed 24/24 after waiting for both emulators to be ready. The relay emulator case exercises Firebase Auth/App Check gating, exact test-UID authorization, one-use ticket rejection and a missing-provider-key denial, without making a Gemini call. These are local tests, not protected provider acceptance.

A server-owned Live relay scaffold now replaces the browser's direct managed-token path in local source. It reserves the approved $0.50 ceiling before provider connection, enforces session time/audio/control/output limits, requires verified App Check and Firebase identity, closes the upstream socket from the server, and retains a full safety hold if usage cannot be verified. Its metering tests validate the current Live modality prices and fail closed on missing or contradictory usage. The Cloud Run entrypoint now explicitly starts the relay. The owner Live-control route now permits enabling only when the existing project/user/per-operation budget is active, has at least the approved $0.50 envelope, has no emergency stop, and the relay's code-verified worst-case estimate remains below its stop amount; this does not change the existing $20/$5/$0.50 policy or managed-AI test-mode gate. Emulator tests exercise missing policy, emergency stop, undersized operation cap and test-mode preservation. The relay has not been deployed, no genuine managed Live session has been accepted, and the Live kill switch remains off. The full provider lifecycle and actual Cloud Run billing/latency still require a controlled preview run.

The reCAPTCHA configuration is now inspected; its actual score outcome for the failed automated Chrome attempt is not available in the current evidence. The next diagnostic should capture an interactive-browser token exchange and compare it with the automated browser's failure without changing App Check. Public guest and production acceptance remain open. The authenticated preview Chat and Briefing success does not close production acceptance.

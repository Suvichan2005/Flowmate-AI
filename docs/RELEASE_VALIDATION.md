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

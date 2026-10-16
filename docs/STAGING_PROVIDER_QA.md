# Provider validation plan (staging only)

Provider-backed behavior has not been exercised in this owner QA pass. Do not connect these steps to production Firebase, Google Calendar, real user data, or an unrestricted Gemini key.

## Preparation

1. Create or select a dedicated Firebase staging project owned by the project owner. Use synthetic accounts and synthetic records only.
2. Review and deploy staging Authentication settings and Firestore Security Rules separately from application release changes. Confirm default-deny behavior for unauthenticated and cross-user reads/writes before running the app.
3. Prefer Firebase Local Emulator Suite for repeatable auth and Firestore tests. The current app does not contain a verified emulator connection switch, so emulator validation requires an explicit, reviewed config path before use. Do not repoint an existing production `.env.local`.
4. Use a restricted Gemini key with an owner-approved quota limit. Enter it at runtime in the browser only for the authorized staging session. Do not add it to `.env`, `VITE_*`, source control, screenshots, logs, or test reports.
5. Record the exact tested commit, staging project identifier (not credentials), browser version, test account labels, timestamps, and sanitized evidence.

## Test sequence

1. Start with Firebase configuration absent. Verify local storage, graph, calendar and CRUD; verify chat clearly reports that it did not generate an AI response and no Firebase or Gemini request is made.
2. Configure only the dedicated staging Firebase project. Test sign-up, sign-in, sign-out, expired/invalid credentials, and reload while signed in. Confirm user identity is shown accurately.
3. Create synthetic records as account A. Verify reads and writes are restricted to A. Attempt reads and writes as account B and unauthenticated; each must be denied by the rules and surfaced without claiming success.
4. Test first sync, edit, reconnect after offline interruption, retry after transient provider failure, and conflict behavior in two tabs. Compare server records to the synthetic operations performed. Verify local edits remain visible when provider access fails.
5. Confirm ordinary production routes expose no synthetic sample workspace or injected sample records. Verify account switching and per-user persistence using synthetic staging accounts.
6. If Google Calendar is in scope, use a synthetic staging calendar and least-privilege test account. Verify consent, import, export, revoke, expiry, error, and token clearing. The current client stores its access token in localStorage; treat XSS/token exposure review as a prerequisite to enabling this path for real accounts.
7. With the restricted Gemini key, verify one approved text request and each supported tool proposal. Confirm proposals require user review before mutation. Test invalid key, quota denial, network loss, and provider error. Do not claim deterministic local summaries are AI output.
8. Clear the ephemeral Gemini key and sign out. Verify the app returns to the keyless local experience, synthetic data stays in the staging account, and no credentials appear in storage, assets, console output, or artifacts.

## Acceptance evidence

Keep separate results for local-only behavior and each provider. A build, configured client, emulator-only test, or successful sign-in does not establish secure production rules, multi-account isolation, synchronization recovery, Google token safety, or Gemini reliability. Those require their own reviewed staging evidence before any provider-backed release decision.

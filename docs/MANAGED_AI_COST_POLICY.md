# Managed AI cost and abuse policy

This policy preserves the visible monthly Chat and daily Briefing allowances. Token totals remain informational. Separate server-side exposure controls protect the project key and do not publish service-wide counters to ordinary users.

## Text request envelope

The endpoint validates Auth, App Check, identity, feature state, model and allowance before generation. It constructs the provider request, calls Gemini `countTokens` on the complete contents/system-instruction/tool declaration envelope, and verifies the selected model's current provider limits before reserving cost:

| Request | Input envelope | Output envelope |
| --- | --- | --- |
| Chat | Selected model's full supported input limit | Selected model's full synchronous output capacity unless the request explicitly selects a smaller length |
| Dashboard Briefing | Complete assembled briefing prompt | Product-selected 512-token response length |

The input count includes conversation history and supported request context, not just the latest message. Tool continuations are counted again against their complete assembled request. One user turn is limited to six provider generations and a configured cumulative monetary exposure. Every fresh Briefing generation is independently subject to the same maximum exposure; it has no Chat turn document to carry that check. A cap rejection occurs before provider generation and does not consume a successful Chat turn or Briefing allowance. Unless the request explicitly chooses a smaller response length, the cost estimate uses the selected model's full synchronous output capacity; Flowmate does not silently impose a smaller tier-specific output cap. Gemini's current synchronous output maximum is 65,536 for standard Gemini 3 models. Consequently, the $0.50 safety boundary can reject large-context or high-cost model requests before provider generation. Gemini 4 Argon uses a shared input/thinking/output context and is checked against that combined limit.

## Pricing and estimate method

`functions/src/cost.ts` is the versioned server price catalogue. It uses standard paid-tier list prices, records integer micro-USD, rounds up per token category and adds a 25% reservation margin. Cached input is estimated at the regular uncached input rate, so an unknown or changing cache discount cannot under-reserve. Thinking tokens use the model's output rate. Gemini Search or other separately priced tools are not accepted by this request policy; Flowmate's allowlisted application function declarations are tokenized as part of the input.

Examples for Gemini 3.8 Flash at the current standard rate of $0.75 / 1M input tokens and $3.75 / 1M output tokens:

| Representative request | Estimated list cost | Exposure reserved with 25% margin |
| --- | ---: | ---: |
| 10,000 input + 2,000 output | $0.0150 | $0.01875 |
| 100,000 input + 8,192 output | $0.10572 | $0.13215 |
| 1,000,000 input + 8,192 output | $0.78072 | $0.97590 |

The 2026 introductory Flash rates change on 2027-01-01; Argon's scheduled price change is 2026-12-01. The price catalogue switches automatically on those dates. If a date/model has no reviewed price, the request fails closed. Refresh this file and catalogue against the official [Gemini pricing page](https://ai.google.dev/gemini-api/docs/pricing) before later price changes.

## Atomic financial protection

Before Gemini receives a text request, Firestore atomically reserves the estimate against:

- A monthly, hashed-UID exposure bucket.
- A project-wide monthly exposure bucket shared by guests, accounts, and privileged users.
- A cumulative exposure ceiling for a Chat turn, or the same ceiling for one complete Briefing generation.

An owner must configure the project monthly amount, per-user monthly amount and per-turn amount in the owner-only Admin / AI Access panel. The default is absent/disabled: requests fail closed until these amounts are set. The application keeps separate successful-turn/daily-briefing counters and does not substitute a hidden token quota. A project-level stop is set if provider-reported token cost exceeds the reservation; an owner must review and reset it.

Unknown provider outcomes retain their full reservation; there is no timed refund. A verified owner can inspect aged holds through the authenticated `/admin/access` action `listUncertainCostReservations` (holds older than 15 minutes, at most 50 returned per read). Reconciliation is a separate explicit `reconcileCostReservation` action and requires a hashed call ID plus an operator evidence reference. Choose `settle` only with authoritative provider usage and a reviewed pricing version; choose `confirmed_not_billed` only with evidence that the provider did not process the request. Both outcomes atomically update project, identity and Chat-turn balances and write an owner audit record. Reconciliation never edits prompts or user conversation content. Older records without the private hashed ledger-path metadata are marked not reconcilable by this endpoint and require a documented manual accounting review; no automatic refund is performed.

The owner-approved pilot guard is **$20 per project/month, $5 per identity/month, and $0.50 maximum exposure per Chat turn or single Briefing generation**. These are separate financial safeguards, not replacements for the visible 30/150 monthly Chat and 3/5 daily Briefing allowances. Users see their own estimated monthly spend and the per-operation ceiling; the shared project cap remains operator-only. The $0.50 ceiling can reject unusually large-context requests before the model's full context limit, and the $5 personal cap can be reached before the advertised turn count if requests are consistently long. For scale, a 100k-input account request with a 16,384-token output reserves about $0.171 now and $0.341 from 2027-01-01 at current standard Flash prices. Typical prompts should cost much less, but this guard intentionally prioritizes the owner's chosen spend ceiling over completing every allowance under worst-case usage. The aggregate `callsReserved` value is request-reservation telemetry, not proof that the provider received or completed every call; pre-generation budget denials are rolled back from it.

When complete provider usage is returned, the reserved exposure is settled to a conservative estimate using provider usage metadata. Missing or incomplete usage, function timeout, uncertain response, or settlement failure keeps the full reservation for the month. Failed model generations do not consume successful Chat or Briefing allowances, but possibly billed provider exposure is retained. A reservation failure occurs before generation and does not submit a provider request. The project budget is an application-level estimate cap, not an exact copy of Google's invoice meter; currency conversion, taxes, and provider-side adjustments may differ.

The available production usage metadata is a small acceptance sample, not representative demand. The pilot ceilings above are owner-approved hard safeguards, not a calibration claim. Do not treat the current sample as typical usage; retain privacy-preserving aggregates for later review and keep exact operational samples out of this public source repository.

## Live voice

Live remains independently disabled. The backend currently grants a one-use, short-lived ephemeral token, allows one active session per UID, limits token-grant burst rate, and requests a provider-enforced 15-minute session expiry. The browser then speaks directly to Gemini. The provider bills the growing context again on successive turns, so duration times a single-pass audio rate is not a strict maximum; client-reported usage cannot be trusted as a financial enforcement source. The owner control therefore refuses to enable Live until a server-observable session path can enforce and reserve an auditable liability. Do not describe the existing text budget as covering Live.

The smallest robust next step is a server-side WebSocket relay or equivalent provider-supported usage-enforcement path that can terminate a session at its approved budget, count authoritative usage, cap grants/concurrency and retain authenticated end/expiry records. Until then, Live stays off. The current direct ephemeral-token architecture should not be represented as having a hard monetary cap.

## Operational telemetry and privacy

Generation logs and private server-only call records may contain request/session IDs, a one-way UID reference, tier, feature, model, price-catalogue version, token usage, estimated/reserved/settled exposure, duration, outcome, and a fixed denial category. They exclude prompts, responses, decrypted workspace content, voice recordings, credentials and full tool arguments. Ordinary users receive only their own allowances and token totals; project-wide exposure and model-call totals are owner-only.

Firestore TTL policies for `managedAiCalls.expiresAt` (90 days), `managedAiCostProjectMonthly.expiresAt` (400 days), and `managedAiCostUserMonthly.expiresAt` (400 days, approximately 13 months) were submitted and read back on 2026-10-20. The call-record TTL is `ACTIVE`; both cost-ledger TTL policies remain in Firestore's `CREATING` state. Expiry timestamps are written by the source ledger. The separate owner audit log is not subject to these policies.

## Live release gate

Text and Briefing cannot be opened generally until the monetary policy has a real owner-approved budget, pricing and ledger emulator tests pass, settlement and timeout paths are tested, and the exact protected browser/provider acceptance passes. Live is a separate gate and remains disabled until an authoritative server-side usage-enforcement path exists.

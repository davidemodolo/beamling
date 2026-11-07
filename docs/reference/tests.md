# Tests

The repository contains four layers.

| Suite | Count | Coverage |
|---|---|---|
| `packages/mascot/test/geometry.test.mjs` | 6 | Eye/beam geometry, expressions, state mapping |
| `packages/web/tests/unit/crypto.test.ts` | 7 | KMS-backed credential encryption and rotation, workspace-key re-wrap by the rotation script, integrity vs KMS-outage decryption errors, hidden last four for short keys, fail-closed plaintext reads |
| `packages/web/tests/unit/providers.test.ts` | 22 | Model allowlist, Brave/Tavily/Exa/OpenRouter/DeepSeek validation, search and status mapping, 429 retry, network vs abort, unsafe URLs, malformed provider bodies, streams without a finish reason, Tavily free validation, DeepSeek query limit, cost estimate and thinking switch |
| `packages/web/tests/unit/answer.test.ts` | 8 | Citations, ranking, freshness, language, prompt injection, history handling, shared stream events |
| `packages/web/tests/unit/security.test.ts` | 11 | Client IP HMAC, derived keys, test-only sign-in, same-origin anchors, production config, body limits, provider-safe log redaction, credential status, signup allowlists, English shutdown notice |
| `packages/web/tests/unit/analytics.test.ts` | 13 | Analytics allowlist, identity, delivery, opt-out, deletion and kill-switch deletion, shared client, erasure backoff, PostHog host rules |
| `packages/web/tests/integration/answers.test.ts` | 15 | Quick/Deep/Deeper persistence, the Quick and Deeper AI SDK tool loops, planner repair/degrade, partial search, missing keys (named by provider), selected-provider persistence and cost, no fallback, timeout, NUL, retry, one DeepSeek key for model and search |
| `packages/web/tests/integration/streams.test.ts` | 10 | One stream per conversation, global and per-account concurrency, lock timeout, stop flag, mid-answer delete, stale repair, empty-conversation cleanup, interrupted-terminal race, the new-stream flag |
| `packages/web/tests/integration/conversations.test.ts` | 4 | Pinned ordering, pagination, the 100-conversation cap, 60-day expiry |
| `packages/web/tests/integration/accounts.test.ts` | 12 | Session revocation and cleanup, inactive/unaccepted account cleanup, data export, analytics opt-out and erasure queue, sign-up cap, rate limits, Brave spacing, key replacement, unverified keys, scheduled shutdown |
| `packages/web/e2e/*.spec.ts` | 46 | 15 API checks, 20 UI flows and 11 public-route variants for CSP and axe; the terms gate refuses the API until acceptance and a new account accepts on `/welcome`, data export and analytics opt-out work, `security.txt` is served, only Brave and Exa keys skip validation; Quick checks search details, reasoning and tables, provider selection checks Tavily and marks a provider without a key, an Exa key is saved unvalidated and checked later, the killswitch rejects new streams and metrics stay secret-protected, the license page and its footer links resolve, Deeper checks the third mode, sidebar checks pinning and title search, and a scheduled shutdown is announced in the app, at sign-in and on the status page |

Commands:

```sh
pnpm test
DATABASE_URL=postgres://... pnpm --filter @beamling/web test
pnpm --filter @beamling/web typecheck
pnpm --filter @beamling/web lint
pnpm licenses:check
pnpm web:build
E2E_DATABASE_URL=postgres://... pnpm --filter @beamling/web test:e2e
```

Integration tests skip with a message when `DATABASE_URL` is absent. `pnpm test` runs the unit files in parallel, then the integration files one at a time (`--test-concurrency=1`), because several integration tests change database-wide state (the global stream cap, the sign-up cap, the new-stream flag). Shared helpers live in `tests/helpers.ts` (`withEnv`, `mockFetch`, `jsonResponse`, used by both suites), `tests/unit/helpers.ts` and `tests/integration/helpers.ts`. Playwright starts a production server on `E2E_PORT` (default 3210) with fixture providers and a random master key; it requires a migrated disposable database.

The Playwright suite checks:

- Anonymous API requests are refused with `UNAUTHENTICATED`.
- Test sign-in creates one reusable HttpOnly, SameSite=Lax session.
- Cross-origin mutations are rejected.
- Brave plan/expiry/budget metadata is stored and updated.
- Oversized, NUL and mutually exclusive chat bodies are rejected.
- Authenticated responses are private.
- Pages carry a nonce-based CSP and all script tags use the nonce.
- Conversation pagination and cursor rejection, including pinned ordering across pages.
- Account deletion clears the cookie.
- An account that has not accepted the current terms gets `TERMS_REQUIRED` from the API but can still export its data; acceptance without the age confirmation is rejected and a stale version gets `TERMS_OUTDATED`.
- A new account is sent to `/welcome`, must tick both checkboxes, and then reaches the app.
- An account can download its data export and opt out of analytics.
- `/.well-known/security.txt` names a contact, a policy and a future expiry.
- `validate: false` is refused for an OpenRouter key.
- The killswitch rejects new streams with `SERVICE_BUSY`/`Retry-After`, requires the kill secret, and keeps metrics behind their separate secret.
- The generated license page lists production packages, and its footer links resolve.
- Onboarding preserves saved model and mode; settings accepts a launch provider and rejects an unknown one.
- Quick answers stream citations, costs and sources.
- A Tavily answer can be selected per question and keeps its provider badge after reload.
- Answers stay isolated per conversation when switching.
- Client-side navigation keeps a stream alive.
- Stop keeps partial text; “Ask again” replaces the answer without repeating the question.
- Reload mid-answer shows a stopped stored answer.
- Failures before storage can be retried as a new question.
- Deletion of an active conversation returns to a new question.
- Older conversations load on demand.
- A scheduled shutdown shows its banner in the app, the date and closed sign-up on `/login`, and the date on `/status`.
- Public routes and `/welcome` have no CSP violations or serious/critical axe violations.

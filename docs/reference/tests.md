# Tests

| Suite | Count | Coverage |
|---|---|---|
| `packages/mascot/test/geometry.test.mjs` | 6 | Eye/beam geometry, expressions, state mapping |
| `packages/web/tests/unit/crypto.test.ts` | 7 | Encryption, rotation, re-wrap, integrity vs KMS-outage errors, fail-closed reads |
| `packages/web/tests/unit/providers.test.ts` | 25 | Model allowlist, setup defaults, key validation, search and error mapping, 429 retry, unsafe URLs, malformed bodies, DeepSeek query limit, cost, thinking switch |
| `packages/web/tests/unit/answer.test.ts` | 8 | Citations, ranking, freshness, language, prompt injection, history, stream events |
| `packages/web/tests/unit/security.test.ts` | 11 | IP HMAC, derived keys, test sign-in, origins, production config, body limits, log redaction, signup allowlists, shutdown notice |
| `packages/web/tests/unit/analytics.test.ts` | 13 | Allowlist, identity, delivery, opt-out, deletion, erasure backoff, host rules |
| `packages/web/tests/integration/answers.test.ts` | 15 | All modes, tool loops, planner repair, partial search, missing keys, provider and cost, no fallback, timeout, NUL, retry, single DeepSeek key |
| `packages/web/tests/integration/streams.test.ts` | 10 | Per-conversation, global and per-account limits, lock timeout, stop, mid-answer delete, stale repair, cleanup, terminal race, new-stream flag |
| `packages/web/tests/integration/conversations.test.ts` | 4 | Pinned ordering, pagination, 100-conversation cap, 60-day expiry |
| `packages/web/tests/integration/accounts.test.ts` | 12 | Sessions, account cleanup, export, analytics opt-out and erasure, sign-up cap, rate limits, Brave spacing, keys, shutdown |
| `packages/web/e2e/*.spec.ts` | 48 | 15 API checks, 22 UI flows, 11 public-route CSP/axe variants (below) |

## Running

Commands: [Tests and checks](../development.md#tests-and-checks). With databases:

```sh
DATABASE_URL=postgres://... pnpm --filter @beamling/web test
E2E_DATABASE_URL=postgres://... pnpm --filter @beamling/web test:e2e
```

- Integration tests skip, with a message, without `DATABASE_URL`.
- `pnpm test` runs unit files in parallel, then integration files one at a time (`--test-concurrency=1`): some change database-wide state (global stream cap, sign-up cap, new-stream flag).
- Helpers: `tests/helpers.ts` (`withEnv`, `mockFetch`, `jsonResponse`), plus `helpers.ts` in `unit/` and `integration/`.
- Playwright starts a production server on `E2E_PORT` (default 3210) with fixture providers and a random master key. It needs a migrated, disposable database.

## Playwright checks

API and security:

- Anonymous requests get `UNAUTHENTICATED`; test sign-in creates one reusable HttpOnly, SameSite=Lax session.
- Cross-origin mutations and oversized, NUL or mutually exclusive chat bodies are rejected; authenticated responses are private.
- Every script tag uses the page's CSP nonce.
- Brave plan/expiry/budget metadata is saved; `validate: false` is refused for OpenRouter (only Brave and Exa may skip validation).
- Conversation pagination, cursor rejection, pinned ordering across pages.
- Account deletion clears the cookie.
- Without current terms: `TERMS_REQUIRED`, but export works; no age confirmation fails; a stale version gets `TERMS_OUTDATED`.
- `/.well-known/security.txt` has a contact, policy and future expiry.
- The killswitch returns `SERVICE_BUSY`/`Retry-After` for new streams and needs its secret; metrics need their own.

UI:

- New accounts accept terms on `/welcome`; export and analytics opt-out work.
- The license page lists production packages and its footer links resolve.
- Onboarding: free setup (OpenRouter, Brave, free model), DeepSeek with one key, resuming at the search step, defaults following saved keys; landing CTAs follow the session.
- Quick answers show citations, costs, sources, search details, reasoning and tables; Deeper works.
- Per-question Tavily selection keeps its badge after reload; providers without a key are marked; an Exa key is saved unvalidated and checked later.
- Sidebar pinning and title search; older conversations load on demand.
- Streams stay isolated per conversation and survive client-side navigation.
- Stop keeps partial text; “Ask again” replaces the answer; reload mid-answer shows a stopped answer.
- Failures before storage retry as a new question; deleting the active conversation returns to a new question.
- A scheduled shutdown shows in the app, on `/login` (date, sign-up closed) and on `/status`.
- Public routes and `/welcome` have no CSP violations or serious/critical axe violations.

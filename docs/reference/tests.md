# Tests

| Suite | Count | Coverage |
|---|---|---|
| `packages/mascot/test/geometry.test.mjs` | 6 | Eye/beam geometry, expressions, state mapping |
| `packages/web/tests/unit/crypto.test.ts` | 7 | Encryption, rotation, re-wrap, integrity vs KMS-outage errors, fail-closed reads |
| `packages/web/tests/unit/providers.test.ts` | 26 | Model allowlist, setup defaults, key validation, search and error mapping, 429 retry, unsafe URLs, malformed bodies, DeepSeek query limit, cost, thinking switch, result pictures |
| `packages/web/tests/unit/answer.test.ts` | 10 | Citations, ranking, freshness, language, prompt injection, history, stream events, picture rule and history |
| `packages/web/tests/unit/safe-fetch.test.ts` | 4 | Public-address check (IPv4, IPv6, mapped), refused URLs before connecting, picture URL rules, raster signatures |
| `packages/web/tests/unit/security.test.ts` | 11 | IP HMAC, derived keys, test sign-in, origins, production config, body limits, log redaction, signup allowlists, shutdown notice |
| `packages/web/tests/unit/analytics.test.ts` | 13 | Allowlist, identity, delivery, opt-out, deletion, erasure backoff, host rules |
| `packages/web/tests/integration/answers.test.ts` | 19 | All modes, tool loops, planner repair, partial search, missing keys, provider and cost, no fallback, timeout, research time share, NUL, retry, regenerate and edit, text files, single DeepSeek key |
| `packages/web/tests/integration/streams.test.ts` | 10 | Per-conversation, global and per-account limits, lock timeout, stop, mid-answer delete, stale repair, cleanup, terminal race, new-stream flag |
| `packages/web/tests/integration/conversations.test.ts` | 6 | Pinned ordering, pagination, 100-conversation cap, 60-day expiry, per-chat and storage caps |
| `packages/web/tests/integration/accounts.test.ts` | 13 | Sessions, account cleanup, export, analytics opt-out and erasure, sign-up cap, rate limits, Brave spacing, keys, shutdown |
| `packages/web/tests/unit/images.test.ts` | 7 | Image type and signature checks, image markers in prompts, single entity decoding, model vision flags, text file validation, `<file>` blocks and their budget, address-bar fragment and auto-send rule |
| `packages/web/tests/unit/visuals.test.ts` | 4 | Fence language, chart validation and limits, pie rules, document markers and file names |
| `packages/web/tests/unit/markdown.test.ts` | 8 | Heading levels, nested and task lists across blank lines, quotes, fences, tables, documents, inline formatting and citations, document export with sources, picture references |
| `packages/web/e2e/*.spec.ts` | 61 | 15 API checks, 34 UI flows, 12 route CSP/axe variants (below) |

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
- Settings: a model is picked under its keyed provider, an unkeyed provider's models stay disabled until its key is added, a search provider is picked by card, and the dialog has no serious axe violations.
- Install: the manifest is linked and standalone, its icons load, the service worker activates, and a page load offline shows the offline page.
- Sidebar pinning and title search; older conversations load on demand; several chats are selected and deleted in one request, in a dialog centred in the window.
- Images: only the image id and type are stored; a follow-up re-sends the image from the browser; after 7 days, or in another browser, a placeholder shows and the model does not get it; an image-only question is titled "Image question" and deleting it clears the device copy.
- Text files: a binary file is refused; only the file id and name are stored; the model gets the text, also with a follow-up.
- Regenerate replaces the latest answer; editing the latest question rewrites it, replaces the answer and retitles the chat.
- `/search`: a typed question from the fragment is sent; arriving from another site only fills the composer and sets the mode; `/opensearch.xml` carries the fragment template.
- `/limits` does not scroll horizontally at phone width.
- Visuals (`[fixture:visuals]`): a `ts` block is highlighted and copies its code; a chart and a diagram are drawn, a broken chart falls back to code; the document opens in a panel right of the chat with its title once, heading levels, nested and task lists, citations linking to the source and the cited sources listed; after a reload the card reopens it and downloads `fixture-plan.md` with reference links.
- Setup offers sign-out and account deletion without any key.
- Streams stay isolated per conversation and survive client-side navigation.
- Stop keeps partial text; “Ask again” replaces the answer; reload mid-answer shows a stopped answer.
- Failures before storage retry as a new question; deleting the active conversation returns to a new question.
- A scheduled shutdown shows in the app, on `/login` (date, sign-up closed) and on `/status`.
- Public routes and `/welcome` have no CSP violations or serious/critical axe violations.

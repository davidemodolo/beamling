# Beamling — Production Readiness Review

> **Status:** historical review at commit `9b0efd9`, superseded by [`TECHNICAL.md`](TECHNICAL.md) and the current code. It describes an older guest-account model that no longer exists (accounts are Google-only), and later commits changed many behaviors and line numbers. Do not use it as a description of the present state.

**Scope:** full repo at `9b0efd9` (web app, mascot package, Docker/Compose, migrations, tests). No code was changed.

**Checks run:** `typecheck`, `lint`, `test` (17/17), production `next build`, `db:migrate`, `pnpm audit --prod` — all pass. I also ran DB experiments for the concurrency cap, deletion-during-generation, NUL input, and IP-limit spoofing, plus a header check on the running standalone server.

**Bottom line:** no evidence of SQL injection, IDOR, XSS, key leakage, or SSRF. The main risks are unbounded data loading/retention, deployment configuration, a non-atomic global cap, deletion during generation, and several client lifecycle/state bugs. I would not run this publicly until F1–F6 are addressed.

---

## High severity

### F1. `/api/state` loads the entire workspace, with no pagination or rate limit **[verified by inspection]**

**Where:** `packages/web/lib/server/repo.ts:128-155`, `:183-190`, `:525-537`; `packages/web/app/api/state/route.ts`

Every state request returns **all** conversations, all messages and all sources. `loadConversations` builds two `IN (...)` queries with one bind parameter per conversation/message. There is no limit, cursor, or rate limit on `GET /api/state` (only guest creation is limited).

**Impact:**

- Response size, memory, and query time grow forever; the client stores everything.
- A long-lived workspace can eventually exceed PostgreSQL's 65,535 bind-parameter limit in the sources query, making `/api/state` return 500 permanently (the UI shows "Could not load your workspace").
- Repeated expensive GETs are an easy DoS; `/api/conversations/:id` also loads all messages for that conversation.

**Fix:** split into a paginated conversation list and lazy message/source loading (`GET /api/conversations/:id/messages?before=...`), cap page size and history, and add per-user/IP limits on those GETs. At minimum, cap the number of conversations/messages returned and stop loading sources for the list.

### F2. Guest data has no retention path after the session expires **[verified by inspection]**

**Where:** `packages/web/lib/server/session.ts:19-21,60-65` (30-day session); `packages/web/lib/server/repo.ts:576-583` (`cleanupExpired`); `repo.ts:565-573` (`deleteAccount` only manual)

When the 30-day session expires, the browser loses the cookie and the app silently creates a **new** guest workspace. The old user/conversations/messages/sources/credentials remain forever. `cleanupExpired` deletes expired sessions, rate-limit rows, and stale streaming messages, but never users. There is no login/recovery, so the user can no longer access or delete the orphaned data.

**Impact:** unbounded DB growth and indefinite retention of user content while the privacy policy says "conversations stay until you delete them." This is a data-protection and storage problem for production.

**Fix:** decide and implement a retention policy: e.g., delete users with no unexpired session after N days in `cleanupExpired`; warn/export before expiry; add a global guest-creation quota; add `robots`/noindex handling for app routes. If data is intentionally retained, provide a recovery/ownership mechanism — otherwise it is inaccessible personal data.

### F3. Per-IP limits trust client-controlled `X-Forwarded-For` in the default deployment **[verified]**

**Where:** `packages/web/lib/server/http.ts:76-87`, `packages/web/lib/server/env.ts:64-67`, `docker-compose.yml` (port 3000 exposed directly, no proxy)

`clientIpKey` reads `forwarded[length - hops]` with `TRUSTED_PROXY_HOPS` defaulting to `1`, and falls back to `forwarded[0]` if the configured hop is missing. Compose exposes the app directly, so there is no proxy appending the real address.

**Experiment:** 21 `GET /api/state` requests with the same forged `X-Forwarded-For` returned `200` twenty times and then `429`; one request with a different forged value returned `200`.

**Impact:** guest creation and `chat-ip` limits can be bypassed by rotating the header; an attacker can create unlimited workspaces (DB growth) and each new workspace gets a fresh per-user chat quota. Per-user limits still apply once a workspace exists.

**Fix:** require a trusted proxy in production and document it; do not fall back to `forwarded[0]` when the trusted index is missing (use `unknown`); use the platform/socket-provided address where possible; add a global guest-creation cap. In Compose, put the app behind a proxy or set an explicit trusted mode.

### F4. The global concurrency cap is not atomic **[verified]**

**Where:** `packages/web/lib/server/repo.ts:292-298`

The cap is a `COUNT` followed by an `INSERT` inside a transaction. Different conversations do not share a lock, so concurrent transactions each see the old count.

**Experiment:** with `MAX_CONCURRENT_CHATS=1`, 8 concurrent `createExchange` calls for 8 distinct conversations were **all accepted**.

**Impact:** the cap can be exceeded by the number of concurrent inserts; provider quota and memory protection are not guaranteed under load or with multiple instances.

**Fix:** serialize the cap with a singleton counter row (`FOR UPDATE`), a PostgreSQL advisory lock, or a single atomic statement; or rely on a platform-native limiter. Test it with a concurrency test, not just sequential calls.

### F5. Deleting a conversation/account during generation causes a FK error and can keep billing **[verified]**

**Where:** `packages/web/lib/server/repo.ts:359-405` (`completeAssistant`), `:234-240` (`deleteConversation`), `:565-573` (`deleteAccount`), `packages/web/lib/server/active-chats.ts`

`completeAssistant` updates the message (0 rows if it was deleted) and then unconditionally inserts sources for that message; the insert hits the `sources.message_id` FK.

**Experiment:** `deleteConversation` followed by `completeAssistant` with sources throws `DrizzleQueryError` with PG code `23503`.

`deleteConversation`/`deleteAccount` do not consult or abort the active-chat controller. If the deletion happens from another tab (or the abort loses the race), the provider request continues and bills the user for an answer whose row no longer exists.

**Impact:** noisy 500s/logs, failed persistence, unnecessary provider spend, rows left in `streaming` until the 3-minute reaper.

**Fix:** on conversation/account deletion, abort any active chat for those message ids; make `completeAssistant` return early if the message update affected 0 rows, or verify existence before inserting sources. Add a test for "delete while streaming."

### F6. Compose/`APP_URL` can silently disable Secure cookies and defeat production checks **[verified]**

**Where:** `docker-compose.yml:38`, `packages/web/lib/server/env.ts:9-19,39-44,74-88`

Compose sets `APP_URL: ${APP_URL:-http://localhost:3000}`. That means:

- `productionConfigErrors()` sees a configured URL and **passes**;
- `isLocalAppUrl()` is true, so `secureCookies()` returns **false**;
- if `BEAMLING_FAKE_PROVIDERS=1` is set, localhost mode also permits fake providers.

**Experiment:** with compose defaults, `productionConfigErrors()` returned `[]` and `secureCookies()` returned `false`. Separately, `APP_URL=http://example.com` also passed validation (`[]`) while `secureCookies()` returned `true`, which breaks sessions on a plain-HTTP deployment.

**Impact:** a production Compose deployment that forgets to set `APP_URL` can run with non-Secure cookies (session theft if HTTP is reachable), and fake-provider mode is considered allowed. A plain-HTTP non-local URL creates a broken session loop.

**Fix:** require `APP_URL` in compose (`${APP_URL:?...}`) or remove the default; in `productionConfigErrors`, reject non-HTTPS non-local URLs (and reject the localhost default when `NODE_ENV=production` unless explicitly opted in). Keep fake providers impossible outside a real local run.

---

## Medium severity

### F7. Switching conversations while an answer streams shows the old answer in the new conversation **[verified by inspection]**

**Where:** `packages/web/components/chat-view.tsx:22-35`, `packages/web/lib/hooks/use-answer-stream.ts:49-53`, `chat-view.tsx:61,112,235`

`ChatPane` is keyed only by a local `session` counter that increments only when returning to `/chat` with no id. Navigating A → B does not remount it, so `live`, `stage`, `detail`, and `sources` from A remain. B renders A's working answer/sources, and B's composer stays busy until A finishes. The eventual refresh updates A, not B.

**Impact:** wrong answer under the wrong conversation title; B is unusable for up to the 90s timeout; confusing UI.

**Fix:** key the pane by the active conversation id (and the new-chat draft state), or cancel/clear the stream whenever `conversationId` changes. Replace the `pathname`/`session`/`localId` state machine with the route id as the source of truth.

### F8. Retry/"Ask again" duplicates the user message **[verified by inspection]**

**Where:** `packages/web/components/chat-view.tsx:152-154`, `packages/web/lib/hooks/use-answer-stream.ts:86-94`, `packages/web/lib/server/repo.ts:300-311`

The client passes `appendUser=false` to avoid a local duplicate, but `prepareChat` always calls `createExchange`, which always inserts the question as a new user message. After retrying an error/stopped answer that was already persisted, the thread and prompt history contain the question twice (once per retry).

**Impact:** polluted history/prompt, extra tokens, confusing repeated questions.

**Fix:** add a regenerate path that reuses the original user message id (server skips the user insert), or accept `userMessageId` in the chat request and validate ownership.

### F9. In-flight/streaming state recovery is fragile **[verified by inspection]**

**Where:** `packages/web/components/answer-card.tsx:45-51`, `packages/web/lib/hooks/use-answer-stream.ts:120-151`, `packages/web/lib/api.ts:301-313`, `packages/web/lib/server/repo.ts:414-421`, `packages/web/lib/store.tsx` (no polling)

Three related behaviors:

- A reload or a second tab that fetches state before the server persists an abort sees an assistant message with status `streaming` and empty content. `AnswerCard` renders it as a normal empty answer — no spinner, no polling.
- The Stop button sends `/api/chat/stop` and immediately aborts the fetch. The server's `stage: stopped` event is emitted **after** `completeAssistant`, so the client never receives it. `finish("stopped")` relies on a fixed **450 ms** delay and can refresh before the DB write, leaving the same empty streaming state.
- If the post-`done` `refreshConversation` fails, `setLive(null)` drops the only copy of the answer until a manual reload.

**Impact:** answers appear blank/lost after reload, stop, or a network blip; no recovery without manual refresh.

**Fix:** handle `pending`/`streaming` in `AnswerCard` (indicator + polling/resume); on stop, keep reading until `stage: stopped` (or poll the message) instead of aborting immediately; use the locally accumulated content as a fallback when refresh fails.

### F10. Provider transport failures are misclassified **[verified by code paths]**

**Where:** `packages/web/lib/server/providers/openrouter.ts:82`, `packages/web/lib/server/providers/brave.ts:186-192`, `packages/web/lib/server/chat.ts:393-410`, `packages/web/app/api/credentials/route.ts:31-38`, `packages/web/app/api/credentials/[id]/validate/route.ts`

A `fetch` network error/timeout is not an `ApiError`. As a result:

- on chat it becomes `INTERNAL` ("The answer could not be completed.");
- on credential creation it becomes `INVALID_KEY`;
- on revalidation it marks the stored key `invalid`.

Also, OpenRouter `502` falls through `mapStatus` to `PROVIDER_ERROR` (only `503` is mapped). The spec expects `PROVIDER_UNAVAILABLE` and does not want good keys invalidated by a transient outage.

**Impact:** misleading "key rejected" states, poor retry behavior, broken stable-code contract; users may delete working keys.

**Fix:** wrap provider fetches and map `TypeError`/timeout/mid-stream errors to `PROVIDER_UNAVAILABLE` with the provider; map 502; on revalidation only mark `invalid` for auth/plan errors (401/402/422), keep the previous status for 5xx/timeout/429.

### F11. Revalidation status changes are not reflected in the UI **[verified by inspection]**

**Where:** `packages/web/app/api/credentials/[id]/validate/route.ts:26-29`, `packages/web/lib/store.tsx:198-204`, `packages/web/components/settings/keys-panel.tsx:80-90`

On failure the server updates the credential to `invalid`/`rate_limited` and then throws. `validateCredential` only updates the store on success; `revalidate` only shows a toast. The row keeps the old status (usually "Active") until a full state refresh.

**Impact:** the UI says a key is active when the server just marked it invalid.

**Fix:** include the updated credential in the error response, or refresh the state in the catch, or optimistically update the store.

### F12. Onboarding overwrites saved model and default mode **[verified by inspection]**

**Where:** `packages/web/app/onboarding/page.tsx:16-17,67,149`

`llmModel` is initialized to `DEFAULT_LLM_MODEL` instead of the store's `settings.llmModel`, and submitting always calls `updateSettings({ llmModel, defaultMode: "quick" })`. An existing user who visits `/onboarding` (the footer links there) silently loses their chosen model and default mode.

**Impact:** silent preference loss; the form also displays a model that is not the saved one.

**Fix:** initialize from `settings` once loaded, preserve `defaultMode`, and only PATCH fields the user changed.

### F13. NUL bytes in text cause a 500 **[verified]**

**Where:** `packages/web/lib/server/http.ts:37-49`, `packages/web/lib/server/repo.ts:300-310`

`{"question":"a\u0000b",...}` passes zod, then PostgreSQL rejects the text insert with `22021` (`invalid byte sequence`).

**Experiment:** calling `createExchange` with a NUL question produced `DrizzleQueryError` with cause `22021`.

The same risk applies to model output or upstream snippets containing NULs, which would fail persistence of an entire answer.

**Impact:** a 400-class input produces a 500/log; a malicious or odd provider response can lose an answer.

**Fix:** reject/strip `\u0000` (and ideally other control characters) at the API boundary and when persisting provider text.

### F14. Brave 429 has no retry, backoff, or `Retry-After` handling **[spec P0, verified absent]**

**Where:** `packages/web/lib/server/providers/brave.ts:151-192`

`searchBrave` performs one request; a `429` immediately fails that query. SPEC FR-48 requires one retry with backoff and `Retry-After`. Per-key spacing reduces but does not eliminate 429s.

**Impact:** avoidable failed or partial answers.

**Fix:** retry once on 429 after `Retry-After` or exponential backoff, within the run's signal/timeout.

### F15. Brave per-key serialization is in-process only **[verified by inspection]**

**Where:** `packages/web/lib/server/providers/brave.ts:96-140`

`lastRequestAt` and `queues` are module-level maps. With two app instances, each process allows its own request for the same user key, so a 1 req/s plan can see 2+ concurrent requests. The spec says instances are stateless and not to rely on process memory for global limits.

**Impact:** 429s and failed searches as soon as the app scales horizontally; the "serialized per key" guarantee in `.env.example` is only per process.

**Fix:** a DB/Redis-backed limiter keyed by credential, or explicitly document and enforce a single-replica deployment.

### F16. Missing partial-search warning **[spec P0, verified by inspection]**

**Where:** `packages/web/lib/server/chat.ts:299-319`

Individual search errors are swallowed; the run continues with available sources, but nothing tells the client that coverage is partial. The `done` event has only `noSources`/`truncated`.

**Impact:** the user trusts an answer built from fewer searches than planned; FR-39 not met.

**Fix:** track failed queries, emit a visible warning/`partial` flag, and surface it in the answer card.

### F17. Resolved model/upstream provider and cost breakdown are not recorded/displayed **[spec transparency, verified by inspection]**

**Where:** `packages/web/lib/server/providers/openrouter.ts:127-165`, `packages/web/lib/server/chat.ts:365-392`, `packages/web/components/answer-card.tsx:139-160`, `packages/web/lib/server/repo.ts:70-79`

`openRouterChat` returns the resolved `model` and upstream `provider`, but `chat.ts` ignores them. The DB/UI show the **selected** model only. The Brave cost is folded into the total; `usage.searchRequests` is stored but not shown; there is no "actual vs estimated" label or cumulative cost.

**Impact:** violates FR-22/FR-34 transparency; users cannot verify routing or split costs.

**Fix:** persist `resolvedModel`/`provider` (schema + UI), display them next to the selected model, show generation vs search cost and request count, and label the estimated Brave cost.

---

## Low severity / hardening

- **F18. No request body size limit.** `parseBody` (`http.ts:37-49`) does `await request.json()` before zod's `max()` checks. Route Handlers have no default body-size limit, so a large body can force a large allocation. Add a `Content-Length`/streaming byte cap (e.g., 64 KB) at the app and proxy.
- **F19. Authenticated JSON responses lack `Cache-Control: private, no-store`.** Verified with curl: `/api/state` has no cache header. The app's own fetches use `cache: "no-store"`, but direct requests/intermediaries could cache. Add `private, no-store` and `Vary: Cookie` to authenticated JSON responses.
- **F20. A stream can outlive the component during conversation creation.** `useAnswerStream` awaits `resolveConversation()` before assigning `runRef` (`use-answer-stream.ts:78,153`). If the component unmounts during that await, the cleanup sees `runRef = null`; the start continues and streams with no UI, billing the key. Use an `alive` ref checked after awaits and an `AbortController` for the start phase.
- **F21. Initial `refresh()` can overwrite optimistic state.** `store.tsx:60-77` replaces the whole store. If `/api/state` is slow and the user creates a conversation before it resolves, the late snapshot drops it until `refreshConversation` re-adds it. Disable the composer until `ready`, merge by id, or ignore stale responses.
- **F22. Client API calls have no timeout.** `api()` uses `fetch` without a timeout; a stalled connection can leave `busyRef`/`ready` stuck indefinitely. Add timeouts/abort for non-SSE requests.
- **F23. No statement timeouts / graceful shutdown.** A hung DB query can leave an SSE request (and its `watchChat` poll) open indefinitely. Configure `statement_timeout`/`lock_timeout`, and drain/abort on SIGTERM. `pool.end()` is never called.
- **F24. Master-key rotation is unsafe.** The ciphertext has no key id/version; changing `CREDENTIAL_MASTER_KEY` makes all existing credentials undecryptable. Add a key id and a re-wrap migration if rotating is expected.
- **F25. CSP still allows `'unsafe-inline'` scripts** (`next.config.ts`). The comment acknowledges it; it is a weakened defense, not an observed XSS. React escaping and link filtering are doing the real work. Consider a nonce-based CSP.
- **F26. Cookie hardening.** Consider the `__Host-` prefix (requires Secure, path `/`, no Domain) now that production should always be HTTPS.
- **F27. Deploy-time config checks.** `productionConfigErrors()` does not verify HTTPS (F6), DB TLS, or a non-default DB password. Consider warnings for `DATABASE_SSL=false` with a non-local DB.

---

## Spec deviations (functional/quality, not crashes)

- **No source ranking/domain diversity/near-duplicate-domain collapse.** Sources are deduped by exact URL and kept in provider order (`chat.ts:129-139`). SPEC §11.1 asks for canonicalization, near-duplicate domain collapse, recency/domain diversity.
- **Planner JSON failure falls back without the one repair attempt** in SPEC §11.5 (`parseQueries`, `chat.ts:102-117`); the run is not marked "degraded Deep."
- **No language detection.** The prompt says "Answer in the user's language"; SPEC §11.5 uses an explicit `{{LANGUAGE}}`.
- **Stable error-code vocabulary differs** from SPEC §15.4 (`MISSING_LLM_KEY` vs `CREDENTIAL_MISSING`, `INVALID_KEY` vs `CREDENTIAL_INVALID`, `PROVIDER_ERROR`/`INTERNAL`, no `SEARCH_FAILED`/`SEARCH_PARTIAL`/`MODEL_NOT_FOUND`/`CONTEXT_TOO_LARGE`/`GENERATION_TIMEOUT`). The client is internally consistent, but the published contract is not.
- **No 30-day key-revalidation warning**, no per-credential 60s validation limit, no model picker context/price hints, no follow-up questions/conflict notes, no search cache — all P1/later, listed so they are not mistaken for implemented behavior.
- **Privacy page claims structured, redacted 30-day logs and 30-day backups.** The repo has only ad-hoc `console.*` calls and no backup configuration (backups are infra). Reconcile the policy with what is actually operated.

---

## Code quality / maintainability

- **`repo.ts` is 584 lines mixing six domains** (conversations, messages, credentials, settings, rate limits, account). Splitting by domain would make the high-risk delete/complete paths easier to audit.
- **`runChat` is ~170 lines** of planner → retrieval → gap pass → synthesis. Extract `planQueries`, `retrieveSources`, `fillEvidenceGaps`, `streamSynthesis` for testability. The existing `runBounded`/`dedupeSources` helpers are good.
- **`ChatPane` is ~200 lines** and the `pathname`/`session`/`localId` state machine is the root cause of F7. Make the route id the source of truth; keep only a draft id for `/chat`.
- **Route boilerplate** (`assertSameOrigin` + `requireUser` + try/catch) is duplicated in 8 handlers. A small `withUser` wrapper would reduce repetition and make it harder to forget a check.
- **Duplicated constants:** model default in `schema.ts:71` and `providers.ts:3`; `"New conversation"` in `schema.ts:83`, `repo.ts:38`, and `store.tsx:111`. Centralize (schema can import a string constant).
- **Fake-provider detection by prompt text** (`providers/fake.ts:59`) is brittle: changing the planner/reviewer prompt text silently breaks Deep fixtures. Pass an explicit mode/flag instead.
- **CSS is large** (`globals.css` 1,786 lines, landing 915). Not a logic issue, but splitting by surface would help review.
- **Tests:** good unit coverage for crypto/citations/Brave; integration covers chat persistence, Deep progress, one-streaming, stop flag, rate limit, key replacement. Missing: route/session/CSRF tests, deletion-during-generation, pagination/state size, onboarding/preferences, client lifecycle (switch/retry/stop/reload), mascot geometry, E2E/Playwright, load/k6, prompt-injection regression, accessibility/axe.

---

## What is solid

Worth keeping in perspective; these are not accidental:

- **Crypto:** AES-256-GCM envelope encryption, random per-credential DEK, AAD binds user + credential id + kind + provider; tests cover round-trip and cross-user failure.
- **Sessions:** 256-bit opaque token, SHA-256 at rest, HttpOnly/SameSite, DB expiry, account deletion revokes sessions.
- **Authorization:** all repo reads/deletes are scoped by `userId`; stop requests are owner-scoped; IDs are UUID-validated before Postgres.
- **SQL:** parameterized throughout; no string interpolation.
- **XSS:** model output is rendered by a small React-escaped markdown subset; no raw HTML; link schemes restricted to http(s); source URLs filtered server-side and client-side.
- **SSRF:** no page fetching; only fixed provider endpoints; Brave queries URL-encoded and clamped.
- **Key handling:** validated before save, encrypted at rest, never returned, not in prompts; no secrets in git history; `.env` ignored and `.dockerignore`d.
- **Streaming:** SSE heartbeat, request-abort propagation, 60s/90s timeouts, one streaming row per conversation via partial unique index, DB-backed stop flag for cross-instance stops, stale reaper.
- **Ops basics:** migrations serialized with an advisory lock and applied transactionally; standalone non-root Docker image; healthcheck; startup config validation (but see F6).
- **Build quality:** strict TypeScript, clean lint/typecheck, 17/17 tests, production build, `pnpm audit --prod` clean.

---

## Suggested order

1. **F6 + F3** (HTTPS/config/IP trust) before any public deploy.
2. **F1 + F2** (state pagination, retention) and **F4** (atomic cap) — these are data-model/scale decisions.
3. **F5** (delete/cancel generation), **F7–F9** (client lifecycle), **F10–F12** (provider status/onboarding).
4. **F14 + F16 + F17** (spec P0 behavior/transparency).
5. **F18–F23**, then observability/CI/E2E/load tests, then the maintainability refactors.

I did not exercise live OpenRouter/Brave calls (no provider keys); provider behavior above is based on the code paths and the documented provider contracts. The DB/experiment findings (F3, F4, F5, F6, F13, F19) were reproduced locally.

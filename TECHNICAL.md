# Beamling — Current Technical Reference

**Status:** describes the code in this checkout, not a roadmap.
**Last verified against the code:** 2026-10-21.
**Scope:** the web application, API, database schema, answer pipeline, browser UI, security controls, tests and local deployment.

Beamling is a hosted, bring-your-own-key answer engine. A visitor signs in with Google, connects an OpenRouter key and a Brave Search key, and asks questions in Quick, Deep or Deeper mode. The server searches the web, builds a grounded prompt from the retrieved snippets, streams an OpenRouter answer over SSE, and persists the conversation, sources and usage data.

The application is a single Next.js service plus a small workspace package for the mascot. There is no separate backend, queue, worker or client-side orchestration.

---

## 1. System at a glance

```text
Browser
  │  HTML/CSS/JS from Next.js
  │  JSON + SSE with the account session cookie
  ▼
Next.js 16 application (Node.js runtime)
  ├─ App Router pages: landing, login, onboarding, chat, privacy, terms
  ├─ Google OIDC sign-in and database sessions
  ├─ Route handlers under /api
  ├─ Answer pipeline (Quick / Deep / Deeper)
  ├─ KMS-backed envelope encryption for credentials and content
  └─ PostgreSQL access through pg + Drizzle
       │
       ├─ Google OIDC  discovery + code exchange
       ├─ KMS         wrap/unwrap workspace and credential keys
       ├─ OpenRouter  GET /api/v1/key
       │              POST /api/v1/chat/completions (SSE)
       └─ Brave       GET /res/v1/web/search
```

Current external dependencies:

| Dependency | Use |
|---|---|
| PostgreSQL 18 | Accounts, sessions, workspace keys, credentials, usage, conversations, messages, sources, rate limits, provider slots |
| Google OIDC | Account sign-in and verified identity |
| KMS | Wrapping workspace keys and credential data keys; LocalStack locally, GCP Cloud KMS in production |
| OpenRouter | Model validation and streamed chat completions |
| Brave Search API | Web Search validation and retrieval |
| Browser | Session cookie, SSE consumption, UI state |

The server does not fetch result pages, crawl the web, load remote media in answers, or send analytics to a third party. Provider traffic goes directly from the Next.js process to OpenRouter or Brave using the user's key.

---

## 2. Repository and build

```text
.
├─ packages/web/                  Next.js application
│  ├─ app/                        Pages and route handlers
│  ├─ components/                 React UI
│  ├─ lib/                        Client state, API client, shared types
│  ├─ lib/server/                 Server-only code
│  │  ├─ providers/               OpenRouter, Brave, fixtures
│  │  ├─ repo/                    Database access
│  │  ├─ chat.ts                  Answer pipeline
│  │  ├─ auth.ts                  Google OIDC flow and account upsert
│  │  ├─ kms.ts                   Env/AWS/GCP KMS adapters
│  │  ├─ workspace-key.ts          Per-account content encryption
│  │  ├─ crypto.ts                 Credential envelope encryption
│  │  ├─ prompts.ts                Prompt assembly
│  │  └─ ...
│  ├─ drizzle/                    SQL migration and Drizzle metadata
│  ├─ scripts/                    Migration and key-rotation CLIs
│  ├─ tests/                      Node test runner suites
│  └─ e2e/                        Playwright suites
├─ packages/mascot/               Framework-agnostic mascot engine + React wrapper
├─ local/                         Caddy, Dex and LocalStack parity configuration
├─ Dockerfile                     Multi-stage standalone image
├─ docker-compose.yml             Production-parity local stack
└─ pnpm-workspace.yaml
```

Toolchain:

| Item | Version / choice |
|---|---|
| Package manager | pnpm 10.33.0 |
| Web framework | Next.js 16.4.2, App Router |
| UI | React 19.3.1, TypeScript 6.0.3 |
| Styling | Tailwind CSS 4.3.3 plus hand-written CSS files under `app/styles` |
| Database | PostgreSQL 18 |
| ORM | Drizzle ORM 0.45.4, `pg` 8.23.1 |
| Validation | Zod 4.6.7 |
| Agent loop | AI SDK 7.0.148 `ToolLoopAgent` with `@openrouter/ai-sdk-provider` 3.1.0 (Deeper only) |
| SSE parsing | `eventsource-parser` 4.1.2 |
| Test runner | Node test runner through `tsx`; Playwright 1.64.1 |
| Runtime target | Node.js 24 in Docker |

Useful commands:

```sh
pnpm install
pnpm web:dev             # build mascot, then next dev
pnpm web:build           # build mascot, then next build
pnpm web:start           # start the production build
pnpm test                # mascot + web tests
pnpm db:migrate          # apply SQL migrations
pnpm local:up            # build and start the parity stack
pnpm local:down          # stop the parity stack
pnpm --filter @beamling/web typecheck
pnpm --filter @beamling/web lint
pnpm --filter @beamling/web test:e2e
```

---

## 3. Runtime configuration

Configuration is read from environment variables at request/startup time. There is no config file.

### 3.1 Required in production

| Variable | Behavior |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Required when `NODE_ENV=production`. Falls back to `postgres://beamling:beamling@127.0.0.1:5432/beamling` outside production. |
| `APP_URL` | Public origin. Required in production and must be an origin only (no credentials, path, query or fragment); `https://` outside localhost. Development falls back to `OPENROUTER_APP_URL`, then `NEXT_PUBLIC_APP_URL`, then `http://localhost:3000`. Also sent to OpenRouter as `HTTP-Referer`. |
| `AUTH_SECRET` | Exactly 32 bytes, base64 encoded. Root secret for two HKDF-SHA256 subkeys: one encrypts the short-lived OIDC transaction cookie, the other keys the IP hashes. |
| `OIDC_CLIENT_ID` | Google OAuth client id. |
| `OIDC_CLIENT_SECRET` | Google OAuth client secret. |
| `KMS_PROVIDER` | `gcp` in production, `aws` in the local parity stack, `env` only on localhost/tests. |
| `KMS_KEY_NAME` | GCP Cloud KMS key resource name when `KMS_PROVIDER=gcp`. |
| `KMS_KEY_ID` | AWS KMS key id or alias when `KMS_PROVIDER=aws`. |

Production startup refuses to boot when any of these checks fails:

- `DATABASE_URL` is missing.
- `APP_URL` is missing, malformed, includes a path/query/credentials, or is not HTTPS outside localhost.
- `COOKIE_SECURE=false` outside localhost.
- `TRUSTED_PROXY_HOPS` is missing outside localhost.
- `AUTH_SECRET` is not a valid 32-byte base64 value.
- `OIDC_CLIENT_ID` or `OIDC_CLIENT_SECRET` is missing.
- `OIDC_ISSUER` is not HTTPS outside localhost.
- `KMS_PROVIDER=env` outside localhost, or the selected KMS key setting is missing.
- `BEAMLING_FAKE_PROVIDERS=1` outside a localhost `APP_URL`.

### 3.2 Optional

| Variable | Default / behavior |
|---|---|
| `OIDC_ISSUER` | `https://accounts.google.com`; the local parity stack uses `http://auth.localhost:5556`. |
| `OIDC_REDIRECT_URI` | Defaults to `${APP_URL}/api/auth/callback/google`. Production requires the same origin as `APP_URL` and the fixed callback path. |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `KMS_ENDPOINT` | AWS KMS adapter; LocalStack uses test credentials and an internal endpoint. |
| `CREDENTIAL_MASTER_KEY_ID` | `k1`; env-KMS adapter only. |
| `CREDENTIAL_PREVIOUS_MASTER_KEYS` | Env-KMS adapter rotation list. |
| `DATABASE_SSL` | `false` unless exactly `true`. |
| `DATABASE_SSL_CA` | PEM CA; literal `\n` sequences are converted to newlines. |
| `DATABASE_SSL_CA_FILE` | Path to a PEM CA file, used by the parity stack and scripts. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true` unless exactly `false`. |
| `DATABASE_POOL_MAX` | `10` pg pool connections per process. |
| `PORT` | `3000` in Docker; Next.js default otherwise. |
| `TRUSTED_PROXY_HOPS` | `1`; number of trusted proxies that append to `X-Forwarded-For`. `0` ignores the header and puts all clients in one IP bucket. |
| `COOKIE_SECURE` | Forces Secure cookies on/off. Default: on in production unless `APP_URL` is localhost; on in development only for an HTTPS `APP_URL`. |
| `MAX_CONCURRENT_CHATS` | `50` active streams across the database. |
| `LOGINS_PER_IP_PER_HOUR` | `60` OIDC sign-in starts per hashed client IP per fixed hour. |
| `NEW_ACCOUNTS_PER_HOUR` | `200` new accounts across the deployment per fixed hour. Returning users are not counted. |
| `BRAVE_MIN_INTERVAL_MS` | `1,100` ms between Free-plan Brave requests for the same key across all instances. `0` disables spacing. |
| `BRAVE_PAID_MIN_INTERVAL_MS` | `0`; optional spacing for Paid-plan Brave keys. |
| `BEAMLING_FAKE_PROVIDERS` | `1` uses fixture providers. Honored only when not production, or when production `APP_URL` is localhost. |
| `BEAMLING_FAKE_DELAY_MS` | Overrides fixture delays (defaults vary by call). |

Production warnings (logged, not fatal):

- `DATABASE_SSL` is off for a remote database.
- Certificate verification is disabled.
- The database password is the default `beamling`.
- `TRUSTED_PROXY_HOPS=0`.

### 3.3 Fixture providers

With `BEAMLING_FAKE_PROVIDERS=1`:

- Any key starting with `test-` validates.
- Search returns a fixed set of example sources.
- Planner, gap, and answer calls return deterministic fixture content.
- Adding `[fixture:broken-plan]` to a Deep question forces planner fallback.
- `[fixture:bad-plan]` fails the first plan and exercises repair.
- `[fixture:partial-search]` makes one Deep search fail.
- A question containing `no sources` returns no results.

Fixtures exist for automated tests and a fast offline dev loop; no network calls are made to OpenRouter or Brave in this mode. The production-parity stack leaves them off.

---

## 4. Accounts, OIDC and sessions

There is no guest workspace. Every account starts from a successful Google OIDC sign-in. The local parity stack substitutes Dex for Google but uses the same OIDC client code.

```text
GET /api/auth/login
  → rate-limit by hashed IP
  → discovery(OIDC_ISSUER)
  → signed+encrypted transaction cookie: state, nonce, PKCE verifier, return path
  → redirect to provider

GET /api/auth/callback/google
  → verify transaction cookie and 10-minute expiry
  → exchange code with PKCE, verify state, nonce, ID-token signature, issuer, audience
  → require email_verified
  → upsert user by OIDC subject
  → ensure settings and workspace data key
  → create session, clear transaction cookie, redirect
```

Details:

- Users are keyed by the OIDC subject (`google_sub`), with verified email, optional name and avatar URL.
- There is no password, magic link, email OTP, other identity provider or account recovery inside Beamling. Recovery is Google's.
- The transaction cookie is a JWE (`dir` + `A256GCM`) encrypted with the `oidc-transaction` HKDF subkey of `AUTH_SECRET`; it expires after 10 minutes.
- A first sign-in counts against `NEW_ACCOUNTS_PER_HOUR` before the user row is created. Over the cap, the callback logs a warning and redirects to `/login?error=signups_paused`; other callback failures redirect to `/login?error=auth_failed`.
- Session token: 32 random bytes, base64url encoded.
- Stored value: SHA-256 hex of the token. The plaintext token never enters the database.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, 30-day `Max-Age`.
- Cookie name: `__Host-beamling_session` when Secure cookies are enabled; `beamling_session` otherwise.
- The session expiry slides forward while the account is used. `getCurrentUser` extends it when the new expiry is more than one day beyond the stored expiry, then resets the cookie.
- Missing or expired session on a protected route returns `UNAUTHENTICATED` with HTTP 401.
- `/chat` and `/onboarding` are server-guarded and redirect to `/login` when signed out.
- `POST /api/auth/logout` revokes the current session and clears the cookie. `POST /api/auth/logout?scope=all` revokes every session of the account (Settings → Account → Sign out everywhere).
- `DELETE /api/account` deletes the account, all rows and the wrapped workspace key, clears the cookie, and returns `{ "ok": true }`.
- Cleanup removes expired sessions and counters; it does not delete inactive accounts because Google sign-in can return to them.
- `POST /api/auth/test-login` exists only when `BEAMLING_TEST_AUTH=1`, `BEAMLING_FAKE_PROVIDERS=1` and `APP_URL` is localhost. It creates a unique test account for each new request context and is used by Playwright. Otherwise it returns `NOT_FOUND` (404).

IP handling:

- `clientIpKey()` selects the IP from `X-Forwarded-For` using `TRUSTED_PROXY_HOPS` and keyed-HMACs it with the `ip-hash` HKDF subkey of `AUTH_SECRET`, so stored rate-limit keys are not enumerable from a database dump.
- With one trusted proxy, it reads the last entry; earlier entries are treated as client-controlled.
- A request with fewer forwarded entries than trusted hops is treated as `unknown`.
- The hash is truncated to 32 characters and used in `rate_limits`.

---

## 5. Credentials

### 5.1 Accepted credentials

| Kind | Provider | Validation call |
|---|---|---|
| `llm` | `openrouter` | `GET https://openrouter.ai/api/v1/key`, 15-second timeout |
| `search` | `brave` | `GET https://api.search.brave.com/res/v1/web/search?q=Beamling%20connectivity%20test&count=1` |

The API schema only accepts these two combinations. A credential kind must match its provider (`llm` ↔ `openrouter`, `search` ↔ `brave`).

### 5.2 Envelope encryption

Each credential gets a fresh 32-byte data encryption key (DEK). The plaintext key is encrypted with AES-256-GCM under that DEK; the DEK is then wrapped by the configured KMS adapter.

Stored fields per credential:

```text
key_id, wrapped_dek, dek_nonce, dek_tag,
nonce, ciphertext, tag,
fingerprint, last4,
status, plan, expires_on, budget_usd, budget_period, budget_started_at,
last_validated_at
```

Additional authenticated data (AAD) for the credential ciphertext:

```text
beamling:v1:<userId>:<credentialId>:<kind>:<provider>
```

The KMS wrap uses a separate context:

```text
beamling:credential:v1:<userId>:<credentialId>:<kind>:<provider>
```

Both bind the ciphertext to the owner, credential id, kind and provider and are rebuilt on every decrypt. With the env adapter, `dek_nonce`/`dek_tag` hold the AES-GCM wrap; with AWS/GCP KMS they are empty because the KMS ciphertext blob carries its own integrity.

Display data:

- `fingerprint` = first 16 hex characters of SHA-256(plaintext).
- `last4` = last four characters of the plaintext key.
- The API returns only id, kind, provider, last4, status, plan/limit metadata and validation time. The plaintext key is never returned after creation.

### 5.3 Validation and status

Creating a credential validates it before saving. A validation failure maps to a stable provider error and no row is written.

A saved credential can be revalidated:

- Success sets `status = active`.
- A rejected or out-of-credit key sets `status = invalid`.
- A rate-limited key sets `status = rate_limited`.
- Network errors and provider outages leave the existing status unchanged.

Status values exposed to the UI: `active`, `invalid`, `rate_limited`, `unverified`.

Credential operations are rate-limited to 20 per user per fixed hour.

### 5.4 Replace, delete, rotation

- Saving a credential validates it before writing.
- Re-entering the same key (same fingerprint) preserves the credential id, declared plan, expiry, budget and usage period. The ciphertext is re-written under the same id.
- A different key deletes the old credential first (cascading its usage), then inserts a new row with a new id because the AAD is bound to the credential id.
- Deleting a credential hard-deletes the row and its daily usage. There is no recovery.
- Env-adapter master-key rotation:
  1. Deploy a new `CREDENTIAL_MASTER_KEY` with a new `CREDENTIAL_MASTER_KEY_ID`.
  2. Put the old key in `CREDENTIAL_PREVIOUS_MASTER_KEYS`.
  3. Run `node scripts/rewrap-credentials.mjs`.
  4. Remove the old key from the environment.

The re-wrap script updates only `key_id`, `wrapped_dek`, `dek_nonce` and `dek_tag`. It updates rows only while their old `wrapped_dek` still matches, so a credential replaced during rotation is skipped. KMS-backed keys are rotated at the KMS layer; this script is for the env adapter.

### 5.5 Current data-protection boundary

| Data | At rest |
|---|---|
| Provider API keys | AES-256-GCM envelope ciphertext; DEK wrapped by the configured KMS |
| Workspace data key | 32 random bytes, wrapped by the configured KMS |
| Session token | SHA-256 hash only |
| Conversation titles | AES-256-GCM ciphertext under the account's workspace key |
| User and assistant message content | AES-256-GCM ciphertext under the account's workspace key |
| Source URL/title/domain/snippet | AES-256-GCM ciphertext under the account's workspace key |
| Search trace and model reasoning | AES-256-GCM ciphertext under the account's workspace key |
| Stored provider error messages | AES-256-GCM ciphertext; the fixed `INTERRUPTED` message remains plaintext |
| Usage counters and costs | Plaintext metadata |
| Request logs | Structured JSON; no request bodies or credentials; database parameters are not logged |

Content envelopes are `enc:v1:<base64url JSON>` with nonce, ciphertext, tag and key version. The AAD is `beamling:content:v1:<userId>:<table>:<rowId>:<field>`. Plaintext rows from before this change are still readable: any value without the `enc:v1:` prefix is returned as-is. The workspace key is cached per process (up to 500 accounts) after its first KMS unwrap.

Every account gets a `user_data_keys` row on first sign-in. Deleting the account cascades the wrapped key and content rows. A database-only compromise still yields ciphertext, but the application process can decrypt content for the owning account; this is not end-to-end encryption.

### 5.6 Brave plan, expiry and budget

- Brave keys require a user-declared plan: `free` or `paid`.
- `free` uses `BRAVE_MIN_INTERVAL_MS` (default 1,100 ms) per key across instances.
- `paid` uses `BRAVE_PAID_MIN_INTERVAL_MS` (default 0).
- Optional `expires_on`, `budget_usd` and `budget_period` (`month` or `total`) are stored as user-declared metadata. The Brave API is not queried for them.
- `credential_usage` stores daily requests and estimated cost. `listCredentials` sums the current month or all time and exposes `spentUsd`, `requests` and a warning: `budget_100`, `budget_80`, `expiry_1`, `expiry_7` or `expiry_14`.
- A warning never blocks a search. Provider `402` remains authoritative.
- The UI labels the limits as set by the user, not as provider facts.

---

## 6. Conversation and message model

### 6.1 Tables

```text
users
  id, google_sub (unique), email, email_verified, name, avatar_url,
  created_at, updated_at

auth_sessions
  id, user_id → users, token_hash, expires_at, created_at

user_data_keys
  user_id → users (primary key), key_id, wrapped_key,
  wrap_nonce, wrap_tag, created_at, rotated_at

credentials
  id, user_id → users, kind, provider,
  key_id, wrapped_dek, dek_nonce, dek_tag,
  nonce, ciphertext, tag, fingerprint, last4,
  status, plan, expires_on, budget_usd, budget_period,
  budget_started_at, last_validated_at, created_at, updated_at

credential_usage
  credential_id → credentials, day, requests, estimated_cost_usd

settings
  user_id → users (primary key), llm_model, default_mode, updated_at

conversations
  id, user_id → users, title, mode, pinned, created_at, updated_at

messages
  id, conversation_id → conversations, user_id → users,
  role, content, status, mode,
  uncited, no_sources, truncated, degraded,
  searches (encrypted JSON trace), reasoning (encrypted),
  llm_model, resolved_model, upstream_provider,
  search_requests, search_failures,
  tokens_in, tokens_out, cost_usd, search_cost_usd,
  latency_ms, error_code, error_message, stop_requested,
  created_at

sources
  id, message_id → messages, position,
  url, title, domain, snippet, published_at

rate_limits
  key (primary key), window_start, count, expires_at

provider_slots
  key (primary key), next_at
```

Important indexes and constraints:

- `auth_sessions.token_hash` and `users.google_sub` are unique.
- `credentials(user_id, kind, provider)` is unique.
- `credential_usage(credential_id, day)` is the primary key.
- `conversations(user_id, pinned, updated_at, id)` orders pinned chats first and supports keyset pagination; `conversations(user_id, updated_at, id)` remains for the total count.
- `messages(conversation_id, created_at, id)` supports message pagination.
- A partial unique index allows at most one `messages.status = 'streaming'` row per conversation.
- `sources(message_id, position)` is unique.
- `rate_limits.expires_at` and `provider_slots.next_at` are indexed for cleanup.
- Users cascade to sessions, workspace keys, credentials, settings, conversations, messages and sources.

The migration also creates a `beamling_migrations(filename, applied_at)` ledger in the migration script.

### 6.2 Message lifecycle

```text
user question  → insert row with status complete
assistant      → insert row with status streaming
                 ↓
              complete | stopped | error
```

Assistant rows are inserted one millisecond after the question to keep deterministic thread order. `mode` is stored on both the user and assistant row.

Conversation titles and message content are encrypted before insert. The repository generates row ids in the application so the AAD can bind to them. The first question titles the conversation with the first 48 characters of the normalized question if the decrypted title is still `New conversation`.

### 6.3 Starting an exchange

`createExchange()` runs in one transaction:

1. Take a transaction-scoped PostgreSQL advisory lock (`7314002918`) so every instance checks concurrency in the same order.
2. Lock the conversation row with `SELECT … FOR UPDATE` and verify ownership.
3. Mark any streaming answer older than eight minutes as `error` / `INTERRUPTED`. The threshold covers Deeper's six-minute limit plus recovery grace; the previous three-minute value cut off healthy Deeper runs.
4. Count all non-stale streaming messages. If the count is at or above `MAX_CONCURRENT_CHATS`, return `SERVER_BUSY` (503).
5. For a retry, validate that the target is the latest assistant answer, is `error` or `stopped` (or stale-streaming), and that a preceding user question exists. Delete the old assistant row and reuse the original question. No duplicate user message is stored.
6. For a new question, insert the user message with control characters removed.
7. Insert the assistant placeholder with status `streaming`.
8. Update the conversation title (first question only), mode and `updated_at`.

The partial unique index turns a second concurrent answer in one conversation into `GENERATION_IN_PROGRESS` (409). A lock timeout (5 seconds) or an advisory-lock wait timeout maps to `SERVER_BUSY`.

### 6.4 Finishing an answer

`completeAssistant()` runs in one transaction:

1. Update the assistant row with final content, status, flags, usage, cost, resolved model/provider and error fields, scoped to the owner.
2. If the row no longer exists, return `false` (its conversation or account was deleted).
3. Delete any previous sources for the message.
4. Insert the final sources with their positions.

On retry, the old answer is deleted before a new placeholder is created, so its sources cascade with it.

### 6.5 Pagination and deletion

- Conversation summaries: 50 per page, newest first by `(updated_at, id)`.
- Conversation messages: 60 per page, returned oldest first, selected newest first by `(created_at, id)`.
- `GET /api/conversations/:id` returns the newest message page plus `hasMoreMessages`.
- `GET /api/conversations/:id/messages?before=<messageId>` returns the page before an anchor message.
- Cursors are base64url JSON tuples. Invalid cursors return `INVALID_CURSOR`.
- Deleting a conversation deletes its messages and sources through foreign-key cascades and aborts local active answers for that conversation.
- Deleting an account deletes sessions, per-user rate-limit keys and the user row; cascades remove the workspace key, credentials, usage, conversations, messages, sources and settings.

### 6.6 Cleanup

`startServer()` runs cleanup immediately and every 15 minutes:

- Delete expired sessions.
- Delete expired rate-limit rows.
- Delete provider slots whose `next_at` is more than one hour in the past.
- Mark stale streaming answers as `error` / `INTERRUPTED`.

Each step runs even if another fails; failures are logged. The process continues serving requests if cleanup fails.

---

## 7. Answer pipeline

### 7.1 Request preparation

`POST /api/chat` validates:

- `mode` is `quick` or `deep`.
- Exactly one of `question` or `retryOf` is present.
- A retry includes `conversationId`.
- A question is at most 4,000 characters after control characters are removed and whitespace is trimmed.

It then applies:

- 30 chat requests per user per fixed hour.
- 120 chat requests per hashed IP per fixed hour.
- A 64 KB request-body limit.

`prepareChat()`:

1. Loads settings, falling back to the default model if the stored model is no longer allowlisted.
2. Loads and decrypts the OpenRouter and Brave credentials in parallel.
3. Returns `CREDENTIAL_MISSING` when either is absent; returns `CREDENTIAL_UNREADABLE` when a stored row cannot be decrypted.
4. Reuses the requested conversation after an ownership check, or creates a new conversation.
5. Calls `createExchange()`.
6. Loads the six messages immediately before the current question. These are the prompt's conversation history; the current question is not repeated in that history.

Errors before the SSE response are normal JSON responses with the stable error envelope.

### 7.2 Quick mode

```text
normalized question
  → one Brave search (count 8)
  → rank/dedupe/cap by site
  → if zero usable sources: canned insufficient-sources answer
  → otherwise prompt + OpenRouter stream
  → sanitize citations and persist
```

Quick does not rewrite the question with an LLM. It uses the normalized question as the single search query.

### 7.3 Deep mode

```text
question
  → planner call (JSON, 3–5 sub-queries)
  → up to one repair call if JSON is unusable
  → if still unusable: degraded Deep, search the original question
  → search sub-queries with concurrency 2 (6 results each)
  → rank, cap at 20 sources
  → if fewer than 4 sources: gap review + up to 2 follow-up searches
  → final ranking and stable source numbering
  → synthesis prompt + OpenRouter stream
```

Planner behavior:

- Temperature 0.2, `max_tokens: 2000`, same selected model as the answer. The cap includes reasoning tokens.
- The reply is parsed by taking the first `{` through the last `}` and calling `JSON.parse`.
- Queries are whitespace-normalized to 180 characters, lower-case deduplicated, and capped at 5.
- Fewer than 3 queries triggers one repair attempt with the assistant reply and a fixed repair instruction.
- If the repair still yields fewer than 3 queries, or the planner call throws, the run is marked `degraded` and searches the original question as one query.

Evidence-gap behavior:

- Runs only in Deep and only when the current source count is below 4.
- Makes one `gap` model call with `max_tokens: 1500`. The cap includes reasoning tokens.
- Accepts at most 2 follow-up query strings.
- Runs the follow-up searches sequentially.
- Appends new sources after existing ones without renumbering; max 20 total.
- A failed gap call or failed follow-up search is ignored; the answer continues with existing evidence.

### 7.4 Deeper mode

Deeper is an agentic research loop, implemented with AI SDK `ToolLoopAgent` and the official OpenRouter provider. It runs only when the user selects Deeper; Quick and Deep keep their existing pipelines.

```text
question
  → ToolLoopAgent (same selected OpenRouter model)
      tool: search({ queries: string[1..4] })
      → Brave with concurrency 2, 6 results per query
      → rank/dedupe/append, stable positions, max 60 sources
      → compact tool result (8 source summaries + counts)
      ← model decides: search again or finish
  → stop when the model returns text, 60 searches, 60 sources, or 24 steps
  → synthesis prompt over all collected sources + OpenRouter stream
```

Loop controls:

- The first step forces `toolChoice: { type: "tool", toolName: "search" }`, so the model cannot answer without searching.
- Each step accepts 1–4 queries. Exact duplicate queries are filtered in the tool; the prompt also asks the model to avoid near-duplicates.
- `stopWhen` combines `isStepCount(24)` with a closure that stops at 60 searches or 60 sources.
- The tool refuses new searches once the budget is exhausted and tells the model to finish.
- Every search emits the normal `search` and `progress` SSE events. The final writer uses the existing citation and `truncated` contract.
- Agent output text is not shown as the answer; it only signals that research is complete. A separate synthesis call writes the cited report.
- Research-agent tokens and OpenRouter cost are read from each AI SDK step's `providerMetadata.openrouter` and added to the answer usage.
- Timeout is 360 seconds. A stop, timeout or shutdown keeps partial synthesis text exactly like Deep.

`[fixture:...]` behavior does not apply to Deeper. With `BEAMLING_FAKE_PROVIDERS=1`, Deeper uses three deterministic fixture searches and skips the AI SDK network path.

### 7.5 Retrieval and ranking

Brave request:

```http
GET https://api.search.brave.com/res/v1/web/search
Accept: application/json
X-Subscription-Token: <user key>
```

Query parameters:

- `q`: at most 75 words and 600 characters.
- `count`: 1–20; Quick uses 8, Deep and Deeper use 6 per query.
- `freshness`: omitted unless the question looks recent. Mapping: `pd` (1 day), `pw` (7 days), `pm` (30 days), `py` (365 days).

Freshness detection is lexical and multilingual. It recognizes today/tonight/oggi/stasera/hoy/aujourd'hui/heute (1 day), this week variants (7 days), and latest/recent/news/currently/ultime/notizie/últimas/dernières/aktuell/nachrichten variants (30 days). Ambiguous questions get no freshness filter.

Result filtering:

- Only `http:` and `https:` URLs.
- A result needs a non-empty description after tag stripping and entity decoding.
- The description becomes the snippet and is capped at 1,800 characters.
- The title falls back to the domain.
- `age` is accepted only when it starts with `YYYY-MM-DD` and parses as a date.
- `www.` is stripped from the displayed domain.
- Exact URLs and unsafe URLs are dropped.

Per-key spacing:

- Each Brave key reserves a future slot in `provider_slots` using the database clock.
- Default interval: 1,100 ms (`BRAVE_MIN_INTERVAL_MS`).
- Spacing holds across every app instance and survives restarts because the slot is in PostgreSQL.
- The key is stored in the slot key as a SHA-256 prefix, not as the raw key.

Retry behavior:

- A `429` is retried once if `Retry-After` or the per-second `X-RateLimit-Reset` asks for at most 5 seconds.
- Longer waits and repeated `429`s surface `PROVIDER_RATE_LIMITED`.
- A request timeout is 30 seconds and converts to `PROVIDER_UNAVAILABLE`.

Ranking:

- Canonical URL: lower-case host, strip `www.`, drop fragment, remove common tracking parameters, sort remaining query parameters, remove a trailing slash when there is no query.
- Exact canonical duplicates are dropped.
- Results are taken round-robin by provider rank across query batches.
- A site cap is applied: Quick 2 per registrable domain, Deep 3.
- If room remains after the cap, capped results fill it in rank order, so diversity is a preference rather than a hard filter.
- `siteOf` treats common two-level public suffixes (`co.uk`, `com.au`, etc.) as one site.
- Gap sources are appended with `exclude` set to the existing sources and numbering starting after the current count.

If every search fails, the run throws `SEARCH_FAILED` and no answer is written. If at least one search succeeds, failed searches increment `search_failures` and the answer proceeds with available sources.

### 7.6 No-source path

When ranking produces zero sources:

- The server emits `stage: no-sources`.
- It emits a `delta` containing the fixed cautious answer.
- It stores the message as `complete` with `no_sources = true`.
- It emits `usage` and `done`; no OpenRouter answer call is made.

The fixed answer is:

> I could not find reliable sources for this question, so I am not going to guess. Try rephrasing it, naming a specific entity, or widening the time window.

### 7.7 Prompt construction

Both modes use:

- A system message with Beamling's identity, current date and local timezone, and answer language.
- A user message containing optional conversation history, the question, and numbered `<source>` blocks.

Language:

- `detectLanguage()` uses stop-word lists for English, Italian, Spanish, French, German and Portuguese.
- A language is selected only with at least two hits and a strict lead over the second language.
- Otherwise the prompt says “Answer in the language of the user's question.”

Source blocks:

```text
<source id="1" url="https://example.org/page" domain="example.org" title="Page title" published="2026-08-01">
Snippet text, capped at 2,200 characters.
</source>
```

- `<source` and `</source` sequences inside the snippet are removed.
- Attribute values escape `&`, `"`, `<` and `>`.
- Only the provider snippet is sent; page text is never fetched.
- Source content is explicitly labeled untrusted data, not instructions.

History:

- The last six messages before the current question.
- The first 1,200 characters of each message.
- Citation markers are stripped, except inside code spans, code fences and URLs.
- Previous-turn citation numbers therefore cannot collide with the current source list.

Prompt families:

- Quick: direct answer first, 150–350 words, citations on source-derived claims, no separate sources section.
- Deep: direct opening, then 500–900 words (up to 1,200), 3–6 sections, uncertainty only for material gaps.
- Deeper: direct opening, then 1,200–2,000 words (up to 2,500), 5–9 sections, contradictions and material gaps.
- Planner: JSON only, 3–5 keyword queries, 12 words each.
- Gap: JSON only, sufficient flag plus at most two follow-ups.
- Research agent: tool-use instructions; it never writes the final answer.

The system prompts also instruct the model to ignore instructions inside sources, not to invent source numbers, not to quote more than 25 consecutive words, and not to add a references section.

### 7.8 Synthesis and citations

- Quick synthesis: `max_tokens: 8192`.
- Deep synthesis: `max_tokens: 16384`.
- Deeper synthesis: `max_tokens: 24576`.
- Deeper research agent steps: `max_tokens: 4000`.
- These caps include reasoning tokens when the model emits them, so they are deliberately larger than the answer length alone requires.
- OpenRouter is called with `stream: true` and temperature `0.2`.
- Deltas are forwarded to the SSE client and accumulated in memory.
- On a delta containing `]`, the server scans the accumulated content for new valid citation positions and emits one `citation` event per new position.
- On completion, `sanitizeCitations()` removes out-of-range markers while preserving markers inside code fences, inline code, URLs and Markdown link targets.
- `uncited` is true when the final answer has no valid in-range citation.
- `truncated` is true when OpenRouter reports `finish_reason: "length"`.
- `resolved_model` and `upstream_provider` are recorded from the synthesis stream when OpenRouter reports them.
- Usage from planner, repair, gap, Deeper research-agent steps and synthesis calls is summed into one answer record.

The client renders valid `[n]` markers as buttons; invalid markers stay as text. Clicking a citation highlights the matching source card or opens the mobile source sheet.

### 7.9 Stop, timeout, disconnect and shutdown

| Event | Server behavior | Stored status |
|---|---|---|
| User stops from the same instance | The in-memory controller aborts immediately | `stopped`, partial text kept |
| User stops from another instance | `POST /api/chat/stop` sets `stop_requested`; the running instance polls every 1.5 seconds | `stopped`, partial text kept |
| Quick exceeds 60 seconds | Timeout aborts the run | `stopped`, `GENERATION_TIMEOUT` |
| Deep exceeds 90 seconds | Timeout aborts the run | `stopped`, `GENERATION_TIMEOUT` |
| Deeper exceeds 360 seconds | Timeout aborts the run | `stopped`, `GENERATION_TIMEOUT` |
| Client disconnects | The request signal aborts the run | `stopped`, partial text kept |
| Conversation or account deleted | Local abort; other instances see the missing/non-streaming row on the next poll | Outcome storage becomes a no-op |
| Server shutdown | `SIGTERM`/`SIGINT` aborts active chats with `ShutdownError`; the server waits up to 8 seconds for outcomes, then marks leftovers interrupted | `error`, `INTERRUPTED` |

A user stop and a timeout end with `stage: stopped`. A shutdown or provider failure after streaming begins ends with an `error` event. Usage is persisted on stop/timeout/error, but the `usage` SSE event is emitted only on the successful path (including the no-source path).

---

## 8. Streaming protocol

`POST /api/chat` returns `text/event-stream; charset=utf-8` with:

```http
Cache-Control: private, no-store, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

A comment heartbeat (`: ping`) is written every 15 seconds.

### 8.1 Events

| Event | Data | When |
|---|---|---|
| `meta` | `{ conversationId, messageId, userMessageId }` | Before pipeline work |
| `stage` | `{ stage, detail? }` | State changes; details are display strings |
| `plan` | `{ queries: string[] }` | Deep only, after planning |
| `progress` | `{ completed, total }` | After each search completes (Quick, Deep and Deeper) |
| `sources` | `Source[]` | Once, before writing |
| `delta` | `{ text }` | Streamed answer text |
| `reasoning` | `{ text }` | Model-provided reasoning, when the provider emits it |
| `citation` | `{ position }` | First time a valid citation appears |
| `usage` | `{ tokensIn, tokensOut, costUsd, searchCostUsd, latencyMs, searchRequests, resolvedModel?, upstreamProvider? }` | Successful completion (including no sources) |
| `done` | `{ noSources, truncated?, degraded?, searchFailures? }` | Successful terminal event |
| `error` | `{ code, message, provider? }` | Terminal error after the stream started |

The client's `ChatStage` type includes `done`, `stopped`, `no-sources` and `error`. Over the wire, the server emits `stage` values `queued`, `searching`, `reading`, `writing`, `no-sources`, `stopped` and `error`; successful completion is the separate `done` event, not a `stage: done` event.

Normal order:

```text
meta
stage queued
[plan]                 (Deep)
stage searching
search searching × N
search done|failed × N
progress × N
stage reading
sources
stage writing
reasoning × N          (only when the model returns reasoning)
delta × N
citation × N
usage
done
```

No-source order:

```text
meta
stage queued
stage searching
search searching × N
search done|failed × N
progress × N
stage reading
sources (empty)
stage no-sources
delta (canned answer)
usage
done
```

Error/stop order ends with `error` or `stage stopped`; there is no `done` after those.

### 8.2 Client stream handling

- The client posts JSON to `/api/chat` with the session cookie.
- It parses SSE with `eventsource-parser`.
- `meta` supplies the stored ids used by stop and by the provisional UI.
- `search` updates the visible search trace; the panel is collapsed by default.
- `reasoning` accumulates separately from the answer and is rendered in its own collapsed panel.
- `delta` text accumulates in the live answer.
- `cited` positions increment a counter that pulses the mascot.
- `done`, `error`, or `stage stopped` settles the stream.
- If the stream closes without a terminal event, the client shows `STREAM_ENDED` unless a stop was requested.
- `onStopped` distinguishes a server-confirmed stop from a dropped connection.
- The client's stop flow first calls `/api/chat/stop` when a message id is known, waits up to 6 seconds for confirmation, then aborts the connection.
- A stream started in the chat shell survives client-side conversation switches because the stream manager owns it above the conversation view. A full page navigation disconnects it; the server stores a stopped answer.

---

## 9. HTTP API

All authenticated JSON responses use:

```http
Cache-Control: private, no-store
Vary: Cookie
Content-Type: application/json
```

Error envelope:

```json
{
  "error": {
    "code": "CREDENTIAL_MISSING",
    "message": "Add an OpenRouter key before asking a question.",
    "provider": "openrouter"
  }
}
```

### 9.1 Endpoints

| Method | Path | Auth | Body / query | Success |
|---|---|---|---|---|
| `GET` | `/api/auth/login` | None | `?next=` | 307 to the OIDC provider |
| `GET` | `/api/auth/callback/google` | OIDC transaction cookie | `code`, `state` | 307 to `/onboarding` or `/chat` |
| `POST` | `/api/auth/logout` | Optional | `?scope=all` signs out every session | `{ ok: true }` and cleared cookie |
| `GET` | `/api/state` | Required | — | `{ user, conversations, nextCursor, conversationCount, credentials, settings }` |
| `POST` | `/api/chat` | Required | `{ conversationId?, question?, retryOf?, mode }` | SSE stream |
| `POST` | `/api/chat/stop` | Required | `{ messageId }` | `{ stopped: boolean }` |
| `GET` | `/api/conversations` | Required | `?cursor=` | `{ conversations, nextCursor }` |
| `POST` | `/api/conversations` | Required | `{ mode?: "quick" \| "deep" \| "deeper" }` | `201 { conversation }` |
| `GET` | `/api/conversations/:id` | Required | UUID id | `{ conversation }` with newest 60 messages |
| `GET` | `/api/conversations/:id/messages` | Required | `?before=<messageId>` | `{ messages, hasMore }` |
| `PATCH` | `/api/conversations/:id` | Required | `{ mode?, pinned? }` (at least one) | `{ conversation }` |
| `DELETE` | `/api/conversations/:id` | Required | — | `{ ok: true }` |
| `POST` | `/api/credentials/:id/validate` | Required | — | `{ credential }` |
| `PATCH` | `/api/credentials/:id` | Required | `{ plan?, expiresOn?, budgetUsd?, budgetPeriod? }` | `{ credential }` |
| `DELETE` | `/api/credentials/:id` | Required | — | `{ ok: true }` |
| `PATCH` | `/api/settings` | Required | `{ llmModel?, defaultMode? }` | `{ settings }` |
| `DELETE` | `/api/account` | Optional | — | `{ ok: true }` and cleared cookie |
| `GET` | `/api/health` | None | — | `{ ok: true, database: "up", version, commit, builtAt }` or 503 `{ ok: false, database: "down", version, commit, builtAt }` |

### 9.2 Validation and limits

| Route group | Limit |
|---|---|
| `POST /api/chat` | 30 per user/hour; 120 per hashed IP/hour |
| `POST /api/conversations` | 120 per user/hour |
| `POST /api/credentials` and credential validation | 20 per user/hour |
| All authenticated `GET` routes | 600 per user/10 min; 3,000 per hashed IP/10 min |
| Login start | 60 per hashed IP/hour |
| New accounts | `NEW_ACCOUNTS_PER_HOUR` across the deployment, default 200/hour |
| Request body | 64 KB |
| Question | 4,000 characters after control-character cleanup |
| Global active streams | `MAX_CONCURRENT_CHATS`, default 50 |

All rate limits are fixed-window counters in PostgreSQL, updated atomically. A request over the limit gets `RATE_LIMITED` (429). They are not sliding windows and they do not use Redis.

### 9.3 Same-origin and CSRF behavior

- Any non-GET/HEAD request runs `assertSameOrigin`.
- If an `Origin` header is present, its full origin must equal `APP_URL`. Proxy and `Host` headers are never used as the expected origin.
- No `Origin` header means the check passes; the session cookie is `SameSite=Lax`, so a cross-site POST does not carry it.
- There is no CSRF token; session cookies are `SameSite=Lax` and mutations require a same-origin `Origin` when present.
- `/api/auth/login` does not require a session; the callback requires the 10-minute transaction cookie.

### 9.4 Representative request and response

```http
POST /api/chat
Content-Type: application/json
Cookie: __Host-beamling_session=...

{"conversationId":"...","question":"What changed in the EU AI Act in 2026?","mode":"quick"}
```

```json
{
  "conversationId": "f1c2...",
  "question": "What changed in the EU AI Act in 2026?",
  "mode": "deep"
}
```

A direct API call may omit `conversationId`; the server creates the conversation. The UI normally creates the conversation first so it can update the URL before streaming starts.

### 9.5 Settings and model allowlist

`PATCH /api/settings` accepts:

```json
{ "llmModel": "anthropic/claude-haiku-4.5", "defaultMode": "deep" }
```

`llmModel` must be one of:

- `deepseek/deepseek-v4.1-flash` (default)
- `anthropic/claude-sonnet-4.5`
- `anthropic/claude-haiku-4.5`
- `openai/gpt-5.2`
- `google/gemini-3.8-flash`

An unknown model returns `MODEL_NOT_ALLOWED`. `defaultMode` is `quick` or `deep`.

The selected model is used for planner, gap and answer calls in one run. It is stored on the assistant message. OpenRouter's resolved model and upstream provider are stored separately when reported.

---

## 10. Error model

Errors are stable strings; the UI maps them to copy and actions.

| Code | Typical source | HTTP |
|---|---|---|
| `UNAUTHENTICATED` | Missing/expired account session | 401 |
| `AUTH_STATE_INVALID` | Missing, expired or replayed OIDC transaction cookie | 400 |
| `AUTH_EMAIL_UNVERIFIED` | Provider did not return a verified email | 403 |
| `AUTH_FAILED` | OIDC discovery, token exchange or ID-token verification failed | 502 |
| `INVALID_JSON` | Unparseable body | 400 |
| `INVALID_INPUT` | Schema failure, empty/oversized question | 400 |
| `INVALID_ID` | Non-UUID route id | 400 |
| `INVALID_CURSOR` | Bad pagination cursor | 400 |
| `PAYLOAD_TOO_LARGE` | Body over 64 KB | 413 |
| `INVALID_ORIGIN` | Cross-origin mutation | 403 |
| `INVALID_PROVIDER` | Kind/provider mismatch | 400 |
| `MODEL_NOT_ALLOWED` | Model outside allowlist | 400 |
| `CREDENTIAL_MISSING` | No key for OpenRouter or Brave | 400 |
| `CREDENTIAL_INVALID` | Provider rejected key | 400 |
| `CREDENTIAL_UNREADABLE` | Stored key cannot be decrypted | 400 |
| `INSUFFICIENT_CREDITS` | OpenRouter `402` | 402 |
| `MODEL_NOT_FOUND` | OpenRouter `404` | 400 |
| `BRAVE_PLAN_MISSING_SEARCH` | Brave key has no Search plan | 400 |
| `PROVIDER_RATE_LIMITED` | OpenRouter or Brave `429` | 429 |
| `PROVIDER_UNAVAILABLE` | Timeout, network failure or provider `5xx` | 502 |
| `PROVIDER_ERROR` | Other provider rejection | 502 |
| `SEARCH_FAILED` | Every search failed | 502 |
| `CONTEXT_TOO_LARGE` | OpenRouter says context is too long | 400 |
| `GENERATION_IN_PROGRESS` | Another stream owns the conversation | 409 |
| `SERVER_BUSY` | Global stream cap or lock timeout | 503 |
| `RETRY_NOT_ALLOWED` | Retrying a non-latest or non-failed answer | 409 |
| `RATE_LIMITED` | Beamling rate limit | 429 |
| `SIGNUPS_PAUSED` | Hourly new-account cap reached (callback redirects to `/login?error=signups_paused`) | 429 |
| `NOT_FOUND` / `CONVERSATION_NOT_FOUND` / `MESSAGE_NOT_FOUND` | Missing or not owned | 404 |
| `INTERNAL` | Unhandled error | 500 |
| `INTERRUPTED` | Stored when a stream is abandoned | — |
| `GENERATION_TIMEOUT` | Stored when the time limit is reached | — |

The UI maps `CREDENTIAL_MISSING`, `CREDENTIAL_INVALID`, `CREDENTIAL_UNREADABLE`, `BRAVE_PLAN_MISSING_SEARCH` and `MODEL_NOT_FOUND` to Settings; `UNAUTHENTICATED` to sign-in; most provider failures to retry. `GENERATION_TIMEOUT` and `INTERRUPTED` appear on the stopped/error answer card.

`@/lib/api.ts` also synthesizes client-side codes: `NETWORK`, `TIMEOUT`, `STREAM_ENDED`, `REQUEST_FAILED` and `INVALID_RESPONSE`.

---

## 11. Provider behavior

### 11.1 OpenRouter

Validation:

```http
GET https://openrouter.ai/api/v1/key
Authorization: Bearer <key>
HTTP-Referer: <APP_URL>
X-Title: Beamling
```

Validation spends no generation tokens. It uses a 15-second timeout.

Chat:

```http
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <key>
Content-Type: application/json
HTTP-Referer: <APP_URL>
X-Title: Beamling
```

```json
{
  "model": "deepseek/deepseek-v4.1-flash",
  "messages": [{ "role": "system", "content": "..." }],
  "max_tokens": 8192,
  "temperature": 0.2,
  "stream": true
}
```

The SSE parser:

- Ignores `[DONE]` and empty data.
- Reads `choices[0].delta.content` as text.
- Reads `model`, `provider`, `choices[0].finish_reason` and `usage`.
- Treats a top-level `error` object as a terminal provider error.
- Treats a connection reset mid-stream as `PROVIDER_UNAVAILABLE`.
- Preserves a caller abort as an abort, not a provider failure.
- Cancels the response reader on a mid-stream error.

OpenRouter errors:

| Status/condition | Beamling code |
|---|---|
| `400` with context-length wording | `CONTEXT_TOO_LARGE` |
| `401`, `403` | `CREDENTIAL_INVALID` (HTTP 400 to the browser) |
| `402` | `INSUFFICIENT_CREDITS` |
| `404` | `MODEL_NOT_FOUND` |
| `429` | `PROVIDER_RATE_LIMITED` |
| `408`, `5xx` | `PROVIDER_UNAVAILABLE` |
| Other `4xx` | `PROVIDER_ERROR` |

Provider auth failures are deliberately returned as HTTP 400 by the Beamling API, so the browser's 401 always means “workspace session missing,” not “provider key rejected.”

### 11.2 Brave

Validation and retrieval use the base Web Search endpoint only. The adapter does not call Brave's LLM-context endpoint, request extra snippets, or fetch any result URL.

Plan-aware spacing:

- `free` keys use `BRAVE_MIN_INTERVAL_MS` (default 1,100 ms) per key across instances.
- `paid` keys use `BRAVE_PAID_MIN_INTERVAL_MS` (default 0).
- The plan comes from the saved credential, not from Brave. Validation and retrieval both use it.
- Every successful search records one request and the `$0.005` list-price estimate in `credential_usage` for that credential. Fixture searches record the same usage.

Response mapping:

```json
{
  "web": {
    "results": [
      {
        "title": "…",
        "url": "https://…",
        "description": "…",
        "age": "2026-10-01"
      }
    ]
  }
}
```

- Title and description are tag-stripped and entity-decoded.
- A result without a description is unusable and is dropped.
- `age` is used only when it has a `YYYY-MM-DD` prefix and is parseable.
- The first usable result gets position 1, then 2, and so on within that query batch.
- Final positions are assigned by the ranking step, not by the provider.

Error mapping:

| Status/condition | Beamling code |
|---|---|
| `401`, `403`, invalid subscription token | `CREDENTIAL_INVALID` |
| `402` | `INSUFFICIENT_CREDITS` |
| `422` / “not included in plan” | `BRAVE_PLAN_MISSING_SEARCH` |
| `429` | `PROVIDER_RATE_LIMITED` |
| `408`, `5xx` | `PROVIDER_UNAVAILABLE` |
| Other `4xx` | `PROVIDER_ERROR` |

### 11.3 Fixtures

`lib/server/providers/fake.ts` mirrors the `chat`, `search` and validation interfaces. It is selected by `isFakeProviders()` and is used by local tests and Playwright. Fixture content is deterministic, with marker-based failure modes for planner repair, plan failure, partial search and no-source behavior.

---

## 12. Browser application

### 12.1 Routes and pages

| Route | Current behavior |
|---|---|
| `/` | Public cinematic landing page with a scripted demo, feature cards, provider list, CTA to `/onboarding` or `/chat`, and a footer with Privacy and Terms |
| `/login` | Google-only sign-in page; redirects to `/onboarding` or `/chat` after the callback |
| `/onboarding` | Account setup form: OpenRouter key, default model, Brave key, Brave plan, optional expiry and budget; validates and saves, then routes to `/chat` |
| `/chat` | New-question view; loads workspace state, conversation list and threads |
| `/chat/[id]` | Conversation view; loads the newest 60 messages and supports earlier-message pagination |
| `/privacy` | Draft privacy page |
| `/terms` | Draft terms page |
| `/api/health` | Database liveness check |
| `/robots.txt` | Allows `/`, disallows `/chat`, `/onboarding`, `/api/` |

The Next.js metadata base is `https://beamling.ai`; the landing demo also prints `beamling.ai`.

### 12.2 Client state

`StoreProvider` owns the account:

- Loads `/api/state` on mount; a 401 redirects to `/login`.
- Keeps user, conversation summaries, conversation count, settings, credentials and per-conversation thread state.
- Loads a thread lazily when a conversation route mounts.
- Merges a refreshed newest page with earlier pages already loaded, dropping provisional copies and preserving local failures.
- Uses request sequence numbers so a slow older response cannot overwrite a newer one.
- Tracks conversations created or deleted during an in-flight refresh.
- Exposes methods for refresh, pagination, thread loading, conversation CRUD, pinning, settings, credential limits, sign-out and account deletion.

`AnswerStreamsProvider` owns live answers:

- One live answer per conversation.
- A stream keeps running when the user switches conversations through client-side navigation.
- A full page navigation aborts the connection; the server stores the outcome as stopped.
- `visibleMessages()` hides stored streaming rows while a live answer stands in for them.
- A stored `streaming` row from another tab or a previous page load is followed by polling the thread every 4 seconds.
- If the connection fails before a message id arrives, the UI reloads the thread to see whether the server stored the exchange. If not, it keeps a local failed question/answer pair that can be retried without duplicating the question.
- If a retry stream fails before `meta`, the existing stored answer gets the error and no duplicate card is added.

### 12.3 Onboarding

- Requires an OpenRouter key if none is stored.
- Requires a Brave key if none is stored.
- Brave requires a plan (`Free · 1 request/second` or `Paid / provider plan`) and accepts optional expiry and monthly budget. All three are user-declared.
- “Get a key” links open the provider dashboards in a new tab.
- Keys are masked inputs with show/hide toggles.
- Saving validates each key through the server; a failure keeps the form open with provider copy.
- The user can choose one of the five allowlisted models; the selection is saved only if it differs from the current default.
- If a key is already connected, the field can replace it.
- Once both keys exist, “Start asking” routes to `/chat`; the default model is preserved.

### 12.4 Chat view

- Header: conversation title, mode, selected model name, Brave label, source-count button, account avatar.
- Answer cards show **Searches** (query, status, result count) and **Model reasoning** as `<details>` panels, collapsed by default. The same panels appear live while the answer streams.
- Sidebar: title search over loaded pages, a Pinned section, Today/Yesterday/Previous groups in UTC, exact-title links, per-conversation pin/unpin and delete confirmation, “Show older conversations” pagination, Settings entry, signed-in email and sign-out.
- Thread: user bubbles, answer cards, a working answer card, earlier-message button, empty state, not-found state, load-error state.
- Composer: auto-growing textarea up to 190 px, Enter sends, Shift+Enter inserts a newline, Quick/Deep/Deeper segmented control, model badge, Stop button while busy.
- Source panel: desktop right-hand pane; mobile bottom sheet with focus trap; source count, Brave badge, title/domain/date/snippet/link.
- Tables render with a header, alignment and horizontal scrolling; the parser also handles headings, lists, quotes, code fences, links and citations.
- Answer card: streamed markdown, citation buttons, model/resolved-provider badges, usage line, copy button, sources button, stopped/error/uncited/no-sources/truncated/degraded/partial-search notices, retry button for the latest failed or stopped answer.
- Working answer: mascot, stage label, real detail string, skeleton or streaming body, Stop button.
- Stop: the composer switches to a stop control; the client asks the server to stop, waits for confirmation, and keeps the partial answer.

Markdown support is intentionally small:

- Headings `##`–`####`, paragraphs, unordered/ordered lists, blockquotes, horizontal rules and fenced code.
- GitHub-style tables: header row, delimiter row, left/center/right alignment, inline formatting in cells and horizontal scrolling.
- Inline code, bold, italics, and links. Raw HTML is not parsed.
- Links must be `http:` or `https:`; other schemes render as plain text.
- `[n]` renders as a citation button only when `n` is within the answer's source count; otherwise it stays as text.
- Citation clicks use event delegation to a `data-citation` attribute.

### 12.5 Settings and account

Settings is a modal with three keyboard-navigable tabs:

| Tab | Behavior |
|---|---|
| Keys | Add/replace/validate/delete OpenRouter and Brave credentials; masked last four, status, Brave plan, declared expiry/budget, estimated spend and warnings; edit limits |
| Defaults | Default mode (Quick/Deep/Deeper), OpenRouter model select, fixed Brave Search display |
| Account | Google name/email, conversation and credential counts, session explanation, sign out, sign out everywhere, delete account with typed `DELETE` |

Deleting the account hard-deletes server data and the wrapped workspace key, clears the client store and session cookie, and routes to `/`.

### 12.6 Landing page

The root page is a static marketing surface:

- Dark brand theme, Inter and JetBrains Mono.
- Hero and mascot.
- A scripted, replayable demo that cycles through queued/searching/reading/writing/done; it is not a live provider call.
- Stats, three-step explanation, three feature cards, provider pills.
- Footer with Privacy, Terms, “Keys encrypted at rest” and “No training on your data.”
- `prefers-reduced-motion` skips the demo animation.

### 12.7 Accessibility and responsive behavior

- The mobile sidebar is a focus-trapped dialog drawer.
- The mobile source panel is a focus-trapped bottom sheet.
- The settings modal uses tab roles, arrow-key tab navigation, `aria-selected`, and panels.
- The chat thread has a polite live region for stage announcements; tokens are not announced individually.
- The mascot is hidden from assistive technology; stage text carries the state.
- Focus-visible outlines are defined globally.
- Streaming animation respects reduced motion in the mascot and landing demo.
- Touch targets and 360 px layout are handled by the responsive CSS.
- The E2E suite runs axe-core on `/`, `/chat`, `/onboarding`, `/privacy` and `/terms` and fails on serious or critical violations.

---

## 13. Security controls

### 13.1 Browser and HTTP

A per-request CSP is generated in `proxy.ts` with a random nonce:

```text
default-src 'self'
script-src 'self' 'nonce-…' 'strict-dynamic'
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
font-src 'self'
connect-src 'self'
object-src 'none'
base-uri 'self'
form-action 'self'
frame-ancestors 'none'
```

- Development adds `'unsafe-eval'` and `ws: wss:` for hot reload.
- Pages are rendered dynamically so Next.js can attach the nonce to its scripts.
- API responses carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
- Global headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster: ?1`, `X-Permitted-Cross-Domain-Policies: none`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`, and HSTS. Production CSP adds `upgrade-insecure-requests`.
- `poweredByHeader` is disabled.
- Authenticated API responses are private and vary on Cookie.
- Mutations check Origin when present against the configured `APP_URL` origin, never a client-supplied host. The session cookie is HttpOnly and SameSite=Lax.
- OIDC login uses state, nonce and PKCE; the callback rejects replayed or expired transaction cookies.
- The session cookie uses the `__Host-` prefix when Secure is enabled, which requires host-only scope, path `/`, and Secure.

### 13.2 Input and output

- JSON bodies are streamed through a 64 KB cap, with a pre-check on `Content-Length`.
- Route ids must be UUIDs before reaching PostgreSQL.
- Control characters are stripped from questions and stored text; NUL is removed from provider output before writes.
- Drizzle parameterizes queries.
- Zod validates every JSON body.
- Markdown output is a custom React renderer; raw HTML is never parsed.
- Link schemes are restricted to `http:` and `https:`, and URLs with embedded credentials are rejected.
- Source URLs from Brave are checked before display and before prompt assembly.
- Source snippets are stripped of fake closing `<source>` tags and escaped when placed in attributes.
- Planner output is parsed as data and cannot change model, provider or system prompts.

### 13.3 Provider-key handling

- Keys are never logged, stored in browser state, or returned after creation.
- Only encrypted rows, a SHA-256 fingerprint and the last four characters are stored.
- Decryption is scoped to the authenticated user's row and AAD.
- The provider key is held in memory only for the request that needs it.
- The KMS adapter is selected by `KMS_PROVIDER`; production refuses to boot without the configured KMS key.
- The env adapter and re-wrap script are for local tests only.

### 13.4 Rate limiting and concurrency

- Fixed-window counters in `rate_limits` use one atomic insert-or-update.
- Login starts, chat, conversation creation, credentials and reads have separate keys and limits.
- IP keys are keyed-HMACed with a subkey derived from `AUTH_SECRET`; raw addresses are not stored and a database dump cannot enumerate them.
- The global stream cap is enforced inside a transaction-scoped advisory lock and counts committed streaming rows across all instances.
- A second stream in one conversation is blocked by a partial unique index, not by process memory.
- Brave request spacing uses a per-key database slot, so multiple instances cannot exceed the configured interval.
- DELETE conversation/account aborts local streams and leaves other instances to observe the missing/non-streaming row through their stop poll.

### 13.5 Logging and error handling

- Logs are one-line JSON with level, timestamp, message and optional fields.
- Error summaries keep the error name, Postgres code, message and failing SQL text; they strip SQL parameters.
- Provider error details are truncated, and request/response body text plus bearer/provider keys are redacted before logging.
- Request bodies, cookies, authorization headers and plaintext keys are not logged.
- Unknown errors return `INTERNAL` with a generic message; details stay in server logs.
- The API never returns stack traces.
- Provider responses that echo user content are encrypted in `messages.error_message`; the fixed `INTERRUPTED` message is plaintext.

### 13.7 Supply chain and release checks

- CI runs `pnpm audit --prod --audit-level high` and a Gitleaks history scan on every push and pull request.
- Dependabot checks npm, GitHub Actions and Docker weekly.
- The built image is scanned separately; the current image has no HIGH, CRITICAL or MEDIUM findings after removing the npm/corepack trees and applying Alpine security updates.
- `pnpm audit` still reports two development-only tooling advisories (`braces` via ESLint, `esbuild` via drizzle-kit). Neither is in the runtime image.

### 13.6 Data deletion

- Deleting a conversation cascades to messages and sources.
- Deleting an account cascades to sessions, the workspace data key, credentials, usage, settings, conversations, messages and sources, and removes the user's rate-limit keys.
- Local active chats are aborted; remote instances stop on the next poll.
- The cleanup job removes expired sessions and counters; accounts are retained for a future Google sign-in.
- There is no soft-delete or recovery path.

---

## 14. Local deployment and operations

### 14.1 Production-parity Docker Compose

`docker-compose.yml` defines the local stack:

| Service | Role |
|---|---|
| `certs` | Generates a local CA plus PostgreSQL server certificate, owned by the Postgres uid |
| `db` | `postgres:18-alpine` with TLS required, loopback port `127.0.0.1:5433` for host-run tests, named volume, `pg_isready` health check |
| `localstack` | LocalStack with KMS and a pre-created `alias/beamling-local` key |
| `dex` | Dex OIDC issuer at `http://auth.localhost:5556`, seeded `test@beamling.local` / `beamling` |
| `migrate` | One-shot production image invocation of `node scripts/migrate.mjs`; waits for the database |
| `app` | Production standalone image, `NODE_ENV=production`, secure `__Host-` cookie, KMS-backed crypto |
| `caddy` | HTTPS on `https://localhost`, internal CA, reverse proxy to `app:3000`; ports 80/443 bound to loopback only |

The stack runs the same OIDC callback, session, KMS, encryption, migration and SSE code as production. Dex replaces Google and LocalStack replaces GCP Cloud KMS; the protocols and application code paths are the same. The default stack does not use fixture providers.

Run:

```sh
pnpm local:up
# Browse https://localhost (accept the local CA), sign in with
# test@beamling.local / beamling, then add real OpenRouter and Brave keys.
pnpm local:down
```

PostgreSQL is exposed only on loopback `5433` for integration tests:
`DATABASE_URL=postgres://beamling:beamling@127.0.0.1:5433/beamling`.

`pnpm web:dev` remains available for a fast dev loop, but it is not the parity stack. Fixture providers are selected by `BEAMLING_FAKE_PROVIDERS=1`; Playwright uses them with the test-only `/api/auth/test-login` route.

### 14.2 Image contract

The Dockerfile is multi-stage:

1. `deps`: Node 24 Alpine, corepack, pnpm 10.33, install workspace dependencies with `--ignore-scripts`.
2. `build`: copy sources, build the mascot, run `next build` with standalone output.
3. `runner`: Node 24 Alpine with npm/corepack removed, non-root `beamling` user, standalone server, static assets, public assets, Drizzle migrations and both scripts.

Runtime environment includes:

```text
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
NEXT_TELEMETRY_DISABLED=1
NEXT_MANUAL_SIG_HANDLE=true
NODE_PATH=/app/node_modules/.pnpm/node_modules
```

The image applies Alpine security updates, removes npm/corepack from the runtime, exposes a `HEALTHCHECK` against `/api/health`, and runs as a non-root user.

### 14.3 Migrations

`scripts/migrate.mjs`:

- There is one starting migration, `0000_init.sql`, containing the complete current schema; the pre-launch incremental migrations were squashed into it.
- Requires `DATABASE_URL`.
- Takes a PostgreSQL advisory lock (`7314002917`) so concurrent deploys serialize.
- Creates `beamling_migrations` if absent.
- Reads `.sql` files from `drizzle/`, sorted by name.
- Applies each unapplied file in a transaction, splitting on `--> statement-breakpoint`.
- Records the filename only after a successful commit.
- Rolls back the failing file on error.
- Releases the advisory lock and closes the client.

Migrations are a release step, not an app-start side effect. The local compose `migrate` service runs them before the app starts.

### 14.4 Health and shutdown

- `/api/health` runs `select 1` against the pool.
- Healthy: 200 `{ "ok": true, "database": "up", "version": "0.1.0", "commit": "...", "builtAt": "..." }`.
- Unhealthy: 503 `{ "ok": false, "database": "down", "version": "0.1.0", "commit": "...", "builtAt": "..." }`.
- No authentication and no cache headers.
- On `SIGTERM` or `SIGINT`, if `NEXT_MANUAL_SIG_HANDLE` is set, the server aborts active chats with a shutdown error, waits up to 8 seconds for outcomes, marks leftovers interrupted, closes the pg pool and exits.
- The Docker Compose grace period is 15 seconds.

### 14.5 Versioning and releases

- The root `package.json` version is the single source of truth; the web and mascot packages are kept in sync.
- `pnpm version` prints it, `pnpm version:set 0.2.0` updates all three package files, and `pnpm version:check v0.2.0` rejects a mismatched tag.
- `next.config.ts` injects `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_GIT_COMMIT` and `NEXT_PUBLIC_BUILD_TIME` at build time. `/api/health`, the landing footer and the sidebar show the same identity.
- On a green push to `main`, CI creates the annotated tag `v<version>` if it does not exist, builds the production image, pushes `ghcr.io/<repo>:v<version>` and `:latest`, then creates a GitHub release with generated notes.
- A new release requires a version bump. Pushing another commit without one leaves the existing tag and image untouched.

### 14.6 Database pool

- One pool per process, reused across route handlers and instrumentation through `globalThis`.
- Default max 10 connections.
- Connection timeout 10 seconds.
- Statement timeout 15 seconds.
- Lock timeout 5 seconds.
- Idle-in-transaction timeout 30 seconds.
- TLS is enabled only when `DATABASE_SSL=true`; CA and certificate verification are configurable. `DATABASE_SSL_CA_FILE` lets the parity stack and scripts read a mounted CA.

---

## 15. Tests

The repository contains four layers.

| Suite | Count | Coverage |
|---|---|---|
| `packages/mascot/test/geometry.test.mjs` | 6 | Eye/beam geometry, expressions, state mapping |
| `packages/web/tests/unit.test.ts` | 28 | KMS-backed credential encryption/rotation, allowlist, Brave and OpenRouter mapping, 429 retry, network vs abort, citations, ranking, freshness, language, prompt injection, client IP HMAC, same-origin anchors, production config, body limits, provider-safe log redaction |
| `packages/web/tests/integration.test.ts` | 22 | Database-backed account persistence, content encryption, Quick/Deep/Deeper, the Deeper AI SDK tool loop, planner repair/degrade, partial search, missing keys, one stream per conversation, global concurrency, lock timeout, stop flag, mid-answer delete, timeout, NUL, retry, stale repair, pinned ordering, pagination, session cleanup, rate limits, Brave spacing, key replacement |
| `packages/web/e2e/*.spec.ts` | 24 | 8 API checks, 11 UI flows and 5 route variants for CSP and axe; Quick checks search details, reasoning and tables, Deeper checks the third mode, and sidebar checks pinning and title search |

Commands:

```sh
pnpm test
DATABASE_URL=postgres://... pnpm --filter @beamling/web test
pnpm --filter @beamling/web typecheck
pnpm --filter @beamling/web lint
pnpm web:build
E2E_DATABASE_URL=postgres://... pnpm --filter @beamling/web test:e2e
```

Integration tests skip with a message when `DATABASE_URL` is absent. Playwright starts a production server on `E2E_PORT` (default 3210) with fixture providers and a random master key; it requires a migrated disposable database.

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
- Onboarding preserves saved model and mode.
- Quick answers stream citations, costs and sources.
- Answers stay isolated per conversation when switching.
- Client-side navigation keeps a stream alive.
- Stop keeps partial text; “Ask again” replaces the answer without repeating the question.
- Reload mid-answer shows a stopped stored answer.
- Failures before storage can be retried as a new question.
- Deletion of an active conversation returns to a new question.
- Older conversations load on demand.
- Public routes have no CSP violations or serious/critical axe violations.

---

## 16. Current capability map

| Capability | Implementation |
|---|---|
| Accounts | Google-only OIDC, one account per Google subject |
| Session management | Opaque token, SHA-256 at rest, 30-day sliding expiry, renewal, sign-out |
| Provider credentials | OpenRouter + Brave, validated, KMS-encrypted, replaceable, deletable, revalidatable |
| Credential limits | Brave Free/Paid plan, declared expiry and budget, estimated spend and warnings |
| Key rotation | KMS key rotation; env adapter supports previous-key list + re-wrap script |
| Quick answers | One Brave search, cited streamed answer |
| Deep answers | Planner, 3–5 sub-queries, bounded concurrent search, optional gap pass, cited report |
| Deeper answers | AI SDK `ToolLoopAgent`, Brave search tool, adaptive rounds, 60-search/60-source cap, long cited report |
| Retrieval | Brave Web Search snippets, freshness filter, per-key spacing, 429 retry |
| Source quality | URL validation, snippet requirement, canonical dedupe, site diversity, stable numbering |
| Citations | Streamed `[n]` parsing, sanitization, click-to-source, uncited warning |
| Conversation history | Create, open, title, paginate, delete |
| Message history | 60-message pages, earlier pages, source attachment |
| Streaming | SSE stages, progress, sources, deltas, citations, usage, done/error; heartbeat |
| Cancellation | Local and cross-instance stop, partial text kept, timeout and shutdown handling |
| Models | Five allowlisted OpenRouter models, default DeepSeek V4.1 Flash |
| Costs | OpenRouter actual generation cost, Brave list-price estimate, tokens, latency, search count |
| Search transparency | Persisted per-answer search trace, collapsed by default |
| Reasoning transparency | Provider-supplied reasoning, persisted encrypted and collapsed by default |
| Markdown | Tables in addition to headings, lists, quotes, code and citations |
| Settings | Default model, default mode, keys and limits, account |
| Account deletion | Immediate hard delete of the account, workspace key, content and credentials |
| Rate limits | Login, chat, conversations, credentials, reads; per-account and per-IP |
| Encryption | KMS-wrapped workspace keys, AES-256-GCM content and credential encryption |
| Local parity | Caddy HTTPS, Dex OIDC, LocalStack KMS, TLS PostgreSQL, production image |
| Concurrency control | Global cap + one streaming answer per conversation, database-enforced |
| UI | Landing, login, onboarding, chat, source panel/sheet, settings modal, account panel |
| Accessibility | Focus traps, keyboard tabs, live regions, reduced motion, axe-checked routes |
| Security | CSP nonce, strict headers, `APP_URL`-anchored origin checks, body caps, prompt injection boundaries, redacted provider logs, safe markdown and URLs |
| Credential protection | AES-256-GCM envelope encryption, AAD binding, master-key rotation |
| Persistence | PostgreSQL 18, Drizzle schema, forward-only migration ledger |
| Local deployment | Docker Compose app + PostgreSQL, standalone image, build identity, health check, graceful shutdown |
| Observability | Structured JSON logs, versioned health endpoint, build identity in the UI |
| Testing | Unit, integration, E2E and mascot geometry suites |

# HTTP API

Authenticated JSON responses send:

```http
Cache-Control: private, no-store
Vary: Cookie
Content-Type: application/json
```

Errors use one envelope ([Error model](errors.md)):

```json
{
  "error": {
    "code": "CREDENTIAL_MISSING",
    "message": "Add your OpenRouter key before asking a question.",
    "provider": "openrouter"
  }
}
```

## Endpoints

| Method | Path | Auth | Body / query | Success |
|---|---|---|---|---|
| `GET` | `/api/auth/login` | None | `?next=` | 307 to the OIDC provider |
| `GET` | `/api/auth/callback/google` | OIDC transaction cookie | `code`, `state` | 307 to the stored return path (default `/`) |
| `POST` | `/api/auth/logout` | Optional, terms not required | `?scope=all` signs out every session | `{ ok: true }` and cleared cookie |
| `GET` | `/api/state` | Required | None | `{ user, conversations, nextCursor, conversationCount, credentials, settings }` |
| `POST` | `/api/chat` | Required | `{ conversationId?, question?, attachments?, context?, retryOf?, mode, searchProvider? }`; images are `{ id, mediaType, data }` (base64) | SSE stream |
| `POST` | `/api/chat/stop` | Required | `{ messageId }` | `{ stopped: boolean }` |
| `GET` | `/api/conversations` | Required | `?cursor=` | `{ conversations, nextCursor }` |
| `POST` | `/api/conversations/delete` | Required | `{ ids: uuid[] }` (1–100) | `{ deleted: uuid[] }` |
| `POST` | `/api/conversations` | Required | `{ mode?: "quick" \| "deep" \| "deeper" }` | `201 { conversation }`; the 100-conversation cap applies when its first question is stored ([Pagination and deletion](conversations.md#pagination-and-deletion)) |
| `GET` | `/api/conversations/:id` | Required | UUID id | `{ conversation }` with newest 60 messages |
| `GET` | `/api/conversations/:id/messages` | Required | `?before=<messageId>` | `{ messages, hasMore }` |
| `PATCH` | `/api/conversations/:id` | Required | `{ mode?, pinned? }` (at least one) | `{ conversation }` |
| `DELETE` | `/api/conversations/:id` | Required | None | `{ ok: true }` |
| `POST` | `/api/credentials` | Required | `{ provider, key, plan?, expiresOn?, budgetUsd?, validate? }` ([Accepted credentials](credentials.md#accepted-credentials)) | `201 { credential }` |
| `POST` | `/api/credentials/:id/validate` | Required | None | `{ credential }` |
| `PATCH` | `/api/credentials/:id` | Required | `{ plan?, expiresOn?, budgetUsd? }` | `{ credential }` |
| `DELETE` | `/api/credentials/:id` | Required | None | `{ ok: true }` |
| `PATCH` | `/api/settings` | Required | `{ llmModel?, defaultSearchProvider?, defaultMode?, analyticsOptOut? }` | `{ settings }` |
| `POST` | `/api/account/terms` | Required, terms not required | `{ version, confirmAge: true }` | `{ ok: true, version }` |
| `GET` | `/api/account/export` | Required, terms not required | None | JSON attachment `beamling-export-<date>.json` |
| `DELETE` | `/api/account` | Optional, terms not required | None | `{ ok: true }` and cleared cookie |
| `POST` | `/api/internal/kill` | Bearer `KILL_SWITCH_SECRET` | `{ acceptingNewStreams: boolean, reason? }` | `{ acceptingNewStreams }` |
| `GET` | `/api/internal/metrics` | Bearer `METRICS_SECRET` | None | Deployment flag, active streams and build identity |
| `GET` | `/api/internal/shutdown` | Bearer `KILL_SWITCH_SECRET` | None | `{ shutdown: { scheduledAt, reason, notify } \| null, mailConfigured, accounts, notified }` |
| `POST` | `/api/internal/shutdown` | Bearer `KILL_SWITCH_SECRET` | `{ action: "schedule", days?: 14–365 (default 14), reason?: ≤1,000 chars, notify?: boolean (default true) }` or `{ action: "cancel" }` | Same as `GET`; `MAIL_NOT_CONFIGURED` (409) if `notify` without SMTP ([Scheduled shutdown](conversations.md#scheduled-shutdown)) |
| `GET` | `/api/health` | None | None | Readiness `{ ok, database, schema, kms, version, commit, builtAt }`: 200 ready, 503 not; `Cache-Control: no-store` |
| `GET` | `/api/live` | None | None | Liveness, no database: `{ ok: true }`; `Cache-Control: no-store` |
| `POST` | `/api/auth/test-login` | None | `?terms=pending` | Test only: signs in a new fixture account. 404 unless `BEAMLING_TEST_AUTH=1`, fixture providers and a localhost `APP_URL` |
| `GET` | `/.well-known/security.txt` | None | None | RFC 9116 text: `Contact` (mailto `LEGAL_CONTACT_EMAIL` when set, and `/contact`), `Expires` 180 days ahead, `Policy` `/security`, `Canonical`, `Preferred-Languages: en`; `Cache-Control: public, max-age=86400` |

`apiRoute` wraps every session route. After the same-origin check and session load, it returns `TERMS_REQUIRED` (403) if the account's `terms_version` is not the current `LEGAL_VERSION`, unless the route sets `requireTerms: false` ([Terms acceptance](accounts.md#terms-acceptance)).

The export holds `format: "beamling-export"`, `version: 1`, `exportedAt` and:

- the account: id, Google subject, email, name, avatar URL, timestamps, `lastSeenAt`, accepted and current terms version;
- settings and credential metadata (as the Keys API returns it);
- sessions (creation and expiry only);
- every conversation with decrypted messages and sources, oldest first.

Provider keys, key ciphertext and session tokens are never included.

## Validation and limits

| Route group | Limit |
|---|---|
| `POST /api/chat` | 60 per user/hour; 500 per user/day; 120 per hashed IP/hour, all counted before the body is read. At most `MAX_CONCURRENT_CHATS_PER_USER` requests per account are read and prepared at once per instance (`SERVER_BUSY`, 429) |
| New questions | Refused when the database reaches `DATABASE_SIZE_LIMIT_MB` (`SERVICE_FULL`), at 10 MB stored per account (`STORAGE_FULL`) or 100 questions per conversation (`CONVERSATION_FULL`); retries exempt |
| `POST /api/conversations` | 120 per user/hour |
| `POST /api/credentials` and credential validation | 20 per user/hour |
| Provider key checks (validated create, revalidate) | 50 per user/day; 120 per hashed IP/hour |
| `GET /api/account/export` | 5 per user/hour |
| All authenticated mutations (non-GET/HEAD) | 300 per user/10 min, on top of route limits |
| All authenticated `GET` routes | 600 per user/10 min; 3,000 per hashed IP/10 min |
| Login start | `LOGINS_PER_IP_PER_HOUR` per hashed IP, default 60/hour |
| OIDC callback | `AUTH_CALLBACKS_PER_IP_PER_HOUR` per hashed IP, default 120/hour |
| New accounts | `NEW_ACCOUNTS_PER_HOUR` per deployment, default 200/hour; `SIGNUPS_PER_IP_PER_HOUR` per hashed IP, default 10/hour |
| Request body | 64 KB; `/api/chat` with images up to about 16.8 MB ([Images](answer-pipeline.md#images)) |
| Question | 4,000 characters after control-character cleanup |
| Global active streams | `MAX_CONCURRENT_CHATS`, default 50; at most half (at least 1) in Deeper |
| Active streams per account | `MAX_CONCURRENT_CHATS_PER_USER`, default 2 |

Rate limits are atomic fixed-window counters in PostgreSQL (no sliding windows, no Redis). Over the limit: `RATE_LIMITED` (429); the process then refuses that key from memory until its window ends, without another write.

## Same-origin and CSRF behavior

There is no CSRF token. Session cookies are `SameSite=Lax`, and every non-GET/HEAD request runs `assertSameOrigin`:

- `Sec-Fetch-Site` other than `same-origin` or `none` → `INVALID_ORIGIN` (403).
- A present `Origin` must equal `APP_URL` exactly. Proxy and `Host` headers are never used as the expected origin.
- Neither header (non-browser clients) passes; a cross-site POST does not carry the `Lax` cookie.
- `/api/auth/login` needs no session; the callback needs the 10-minute transaction cookie.

## Representative request and response

```http
POST /api/chat
Content-Type: application/json
Cookie: __Host-beamling_session=...

{"conversationId":"...","question":"What changed in the EU AI Act in 2026?","mode":"quick"}
```

The response is an SSE stream ([Streaming](streaming.md)). Without `conversationId` the server creates the conversation; the UI creates it first so it can update the URL before streaming.

## Settings and model allowlist

`PATCH /api/settings` accepts:

```json
{ "llmModel": "anthropic/claude-haiku-5.5", "defaultSearchProvider": "tavily", "defaultMode": "deep" }
```

`llmModel` must be one of:

- `nvidia/nemotron-3.5-super-vl:free` (default and free setup model; free on OpenRouter)
- `google/gemma-4-31b-it:free` (free on OpenRouter)
- `deepseek/deepseek-v4.1-flash`
- `google/gemini-3.5-flash-lite`
- `openai/gpt-6-luna`
- `anthropic/claude-haiku-5.5`
- `deepseek:deepseek-flash` (DeepSeek direct, needs a DeepSeek key)

Unknown model: `MODEL_NOT_ALLOWED`. A stored default that left the catalog moves to the first keyed model (or the default) when the app opens. Unknown search provider: `INVALID_INPUT`. `defaultMode` is `quick`, `deep` or `deeper`.

`analyticsOptOut` (boolean) goes through `setAnalyticsOptOut`:

- Opting out sets `settings.analytics_opt_out` and queues PostHog erasure of the account's distinct id in `analytics_erasures`, in one transaction; the route then tries a first erasure.
- Opting in clears the flag but keeps a pending erasure; capture resumes once it finishes.
- Both log an audit event (`analytics_opt_out` / `analytics_opt_in`).
- The whole patch is validated first, so a rejected request changes nothing.

See [Analytics privacy](security.md#analytics-privacy).

The selected model runs the planner, gap and answer calls of a run and is stored on the assistant message. The resolved model and upstream provider are stored separately when reported (OpenRouter reports them).

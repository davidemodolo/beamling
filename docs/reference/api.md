# HTTP API

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
    "message": "Add your OpenRouter key before asking a question.",
    "provider": "openrouter"
  }
}
```

## Endpoints

| Method | Path | Auth | Body / query | Success |
|---|---|---|---|---|
| `GET` | `/api/auth/login` | None | `?next=` | 307 to the OIDC provider |
| `GET` | `/api/auth/callback/google` | OIDC transaction cookie | `code`, `state` | 307 to the stored return path (default `/chat`) |
| `POST` | `/api/auth/logout` | Optional, terms not required | `?scope=all` signs out every session | `{ ok: true }` and cleared cookie |
| `GET` | `/api/state` | Required | — | `{ user, conversations, nextCursor, conversationCount, credentials, settings }` |
| `POST` | `/api/chat` | Required | `{ conversationId?, question?, retryOf?, mode, searchProvider? }` | SSE stream |
| `POST` | `/api/chat/stop` | Required | `{ messageId }` | `{ stopped: boolean }` |
| `GET` | `/api/conversations` | Required | `?cursor=` | `{ conversations, nextCursor }` |
| `POST` | `/api/conversations` | Required | `{ mode?: "quick" \| "deep" \| "deeper" }` | `201 { conversation }`; the 100-conversation cap is applied when its first question is stored ([Pagination and deletion](conversations.md#pagination-and-deletion)) |
| `GET` | `/api/conversations/:id` | Required | UUID id | `{ conversation }` with newest 60 messages |
| `GET` | `/api/conversations/:id/messages` | Required | `?before=<messageId>` | `{ messages, hasMore }` |
| `PATCH` | `/api/conversations/:id` | Required | `{ mode?, pinned? }` (at least one) | `{ conversation }` |
| `DELETE` | `/api/conversations/:id` | Required | — | `{ ok: true }` |
| `POST` | `/api/credentials` | Required | `{ provider, key, plan?, expiresOn?, budgetUsd?, validate? }` ([Accepted credentials](credentials.md#accepted-credentials)) | `201 { credential }` |
| `POST` | `/api/credentials/:id/validate` | Required | — | `{ credential }` |
| `PATCH` | `/api/credentials/:id` | Required | `{ plan?, expiresOn?, budgetUsd? }` | `{ credential }` |
| `DELETE` | `/api/credentials/:id` | Required | — | `{ ok: true }` |
| `PATCH` | `/api/settings` | Required | `{ llmModel?, defaultSearchProvider?, defaultMode?, analyticsOptOut? }` | `{ settings }` |
| `POST` | `/api/account/terms` | Required, terms not required | `{ version, confirmAge: true }` | `{ ok: true, version }` |
| `GET` | `/api/account/export` | Required, terms not required | — | JSON attachment `beamling-export-<date>.json` |
| `DELETE` | `/api/account` | Optional, terms not required | — | `{ ok: true }` and cleared cookie |
| `POST` | `/api/internal/kill` | Bearer `KILL_SWITCH_SECRET` | `{ acceptingNewStreams: boolean, reason? }` | `{ acceptingNewStreams }` |
| `GET` | `/api/internal/metrics` | Bearer `METRICS_SECRET` | — | Deployment flag, active streams and build identity |
| `GET` | `/api/internal/shutdown` | Bearer `KILL_SWITCH_SECRET` | — | `{ shutdown: { scheduledAt, reason, notify } \| null, mailConfigured, accounts, notified }` |
| `POST` | `/api/internal/shutdown` | Bearer `KILL_SWITCH_SECRET` | `{ action: "schedule", days?: 14–365 (default 14), reason?: ≤1,000 chars, notify?: boolean (default true) }` or `{ action: "cancel" }` | Same as `GET`; `MAIL_NOT_CONFIGURED` (409) when `notify` is true without SMTP. See [Scheduled shutdown](conversations.md#scheduled-shutdown) |
| `GET` | `/api/health` | None | — | Readiness: `{ ok, database, schema, kms, version, commit, builtAt }`, 200 when ready, 503 otherwise; `Cache-Control: no-store` |
| `GET` | `/api/live` | None | — | Liveness without database access: `{ ok: true }`; `Cache-Control: no-store` |
| `POST` | `/api/auth/test-login` | None | `?terms=pending` | Test only: signs in a new fixture account. Returns 404 unless `BEAMLING_TEST_AUTH=1`, fixture providers and a localhost `APP_URL` |
| `GET` | `/.well-known/security.txt` | None | — | RFC 9116 text: `Contact` (mailto `LEGAL_CONTACT_EMAIL` when set, and `/contact`), `Expires` 180 days ahead, `Policy` `/security`, `Canonical`, `Preferred-Languages: en`; `Cache-Control: public, max-age=86400` |

`apiRoute` wraps every session route. After the same-origin check and session load, it refuses an account whose `terms_version` is not the current `LEGAL_VERSION` with `TERMS_REQUIRED` (403), unless the route is declared `requireTerms: false` ([Terms acceptance](accounts.md#terms-acceptance)).

The export contains `format: "beamling-export"`, `version: 1`, `exportedAt`, the account (id, Google subject, email, name, avatar URL, timestamps, `lastSeenAt`, accepted and current terms version), settings, credential metadata as returned by the Keys API, sessions (creation and expiry only), and every conversation with its decrypted messages and sources, oldest first. Provider keys, key ciphertext and session tokens are never included.

## Validation and limits

| Route group | Limit |
|---|---|
| `POST /api/chat` | 30 per user/hour; 120 per hashed IP/hour |
| `POST /api/conversations` | 120 per user/hour |
| `POST /api/credentials` and credential validation | 20 per user/hour |
| Provider key checks (validated create, revalidate) | 50 per user/day; 120 per hashed IP/hour |
| `GET /api/account/export` | 5 per user/hour |
| All authenticated mutations (non-GET/HEAD) | 300 per user/10 min, in addition to route limits |
| All authenticated `GET` routes | 600 per user/10 min; 3,000 per hashed IP/10 min |
| Login start | `LOGINS_PER_IP_PER_HOUR` per hashed IP, default 60/hour |
| OIDC callback | `AUTH_CALLBACKS_PER_IP_PER_HOUR` per hashed IP, default 120/hour |
| New accounts | `NEW_ACCOUNTS_PER_HOUR` across the deployment, default 200/hour; `SIGNUPS_PER_IP_PER_HOUR` per hashed IP, default 10/hour |
| Request body | 64 KB |
| Question | 4,000 characters after control-character cleanup |
| Global active streams | `MAX_CONCURRENT_CHATS`, default 50; at most half of them (at least 1) in Deeper |
| Active streams per account | `MAX_CONCURRENT_CHATS_PER_USER`, default 2 |

All rate limits are fixed-window counters in PostgreSQL, updated atomically. A request over the limit gets `RATE_LIMITED` (429). They are not sliding windows and they do not use Redis.

## Same-origin and CSRF behavior

- Any non-GET/HEAD request runs `assertSameOrigin`.
- A `Sec-Fetch-Site` header with any value other than `same-origin` or `none` is rejected with `INVALID_ORIGIN` (403).
- If an `Origin` header is present, its full origin must equal `APP_URL`. Proxy and `Host` headers are never used as the expected origin.
- No `Origin` and no `Sec-Fetch-Site` header (non-browser clients) means the check passes; the session cookie is `SameSite=Lax`, so a cross-site POST does not carry it.
- There is no CSRF token; session cookies are `SameSite=Lax` and mutations require same-origin fetch metadata and `Origin` when present.
- `/api/auth/login` does not require a session; the callback requires the 10-minute transaction cookie.

## Representative request and response

```http
POST /api/chat
Content-Type: application/json
Cookie: __Host-beamling_session=...

{"conversationId":"...","question":"What changed in the EU AI Act in 2026?","mode":"quick"}
```

The response is a server-sent event stream ([Streaming](streaming.md)). A direct API call may omit `conversationId`; the server creates the conversation. The UI normally creates the conversation first so it can update the URL before streaming starts.

## Settings and model allowlist

`PATCH /api/settings` accepts:

```json
{ "llmModel": "anthropic/claude-haiku-4.5", "defaultSearchProvider": "tavily", "defaultMode": "deep" }
```

`llmModel` must be one of:

- `deepseek/deepseek-v4.1-flash` (default)
- `anthropic/claude-sonnet-4.5`
- `anthropic/claude-haiku-4.5`
- `openai/gpt-5.2`
- `google/gemini-3.8-flash`
- `google/gemma-4-31b-it:free` (free on OpenRouter, within its daily request limit)
- `deepseek:deepseek-flash` (DeepSeek direct, with a DeepSeek key)

An unknown model returns `MODEL_NOT_ALLOWED`; an unknown search provider returns `INVALID_INPUT`. `defaultMode` is `quick`, `deep` or `deeper`.

`analyticsOptOut` (boolean) records the account's objection to product analytics through its own path (`setAnalyticsOptOut`). Opting out, in one transaction, sets `settings.analytics_opt_out` and queues PostHog erasure of the account's distinct id in `analytics_erasures`; the route then makes a first erasure attempt. Opting back in clears the flag but leaves a pending erasure in place; capture resumes once it has finished. The whole patch is validated before anything is written, so a rejected request changes nothing. Both log an audit event (`analytics_opt_out` / `analytics_opt_in`). See [Analytics privacy](security.md#analytics-privacy).

The selected model is used for planner, gap and answer calls in one run. It is stored on the assistant message. The resolved model and upstream provider are stored separately when the provider reports them (OpenRouter does).

# API Design

## Conventions

- JSON over HTTPS, `Content-Type: application/json` except for SSE.
- Authentication through a database-backed session cookie. No API bearer tokens in Alpha 1.
- Errors use a stable shape:

```json
{
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "OpenRouter has insufficient credits for this key.",
    "provider": "openrouter"
  }
}
```

## Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/auth/login` | Start Google OIDC; sets the short-lived transaction cookie and redirects | None |
| GET | `/api/auth/callback/google` | Verify OIDC response, create/resume the account and session, redirect | Transaction cookie |
| POST | `/api/auth/logout` | Revoke the current session and clear the cookie; `?scope=all` revokes every session of the account | Session |
| GET | `/api/state` | Current account, settings, masked credentials, the conversation count and the first page of conversation summaries (no messages) | Session |
| POST | `/api/chat` | Ask a question (or retry the latest failed or stopped answer), returns SSE | Session |
| POST | `/api/chat/stop` | Stop an in-flight answer by message ID | Session |
| GET | `/api/conversations?cursor=` | Next page of conversation summaries, newest first (50 per page) | Session |
| POST | `/api/conversations` | Create an empty conversation; the 100-conversation cap is applied when its first question is stored, and the `meta` event lists removed ids | Session |
| GET | `/api/conversations/:id` | Get a conversation with its newest 60 messages and their sources, plus `hasMoreMessages` | Session |
| GET | `/api/conversations/:id/messages?before=` | The 60 messages before a message ID, with sources | Session |
| PATCH | `/api/conversations/:id` | Change the conversation mode or pin state | Session |
| DELETE | `/api/conversations/:id` | Delete conversation | Session |
| POST | `/api/credentials` | Create and validate a credential with plan/limit metadata; `validate: false` saves it unverified | Session |
| POST | `/api/credentials/:id/validate` | Re-validate the key | Session |
| PATCH | `/api/credentials/:id` | Update declared plan, expiry or budget without the key | Session |
| DELETE | `/api/credentials/:id` | Delete credential and its usage | Session |
| POST | `/api/account/terms` | Accept the current terms version with an age confirmation | Session (terms not required) |
| GET | `/api/account/export` | Download every stored record of the account as JSON | Session (terms not required) |
| DELETE | `/api/account` | Delete the account and data | Session (terms not required) |
| POST | `/api/internal/kill` | Open or close new streams | Bearer `KILL_SWITCH_SECRET` |
| GET | `/api/internal/metrics` | Deployment flag, active streams and build identity | Bearer `METRICS_SECRET` |
| GET, POST | `/api/internal/shutdown` | Show, schedule (`days` ≥ 14, `reason`, `notify`) or cancel a service shutdown; returns notification progress | Bearer `KILL_SWITCH_SECRET` |
| GET | `/api/health` | Liveness and database check | None |
| GET | `/.well-known/security.txt` | RFC 9116 security contact | None |

Every authenticated response carries `Cache-Control: private, no-store` and `Vary: Cookie`. Request bodies are limited to 64 KB (`PAYLOAD_TOO_LARGE`). GET routes share a per-user limit of 600 requests per 10 minutes and a per-IP limit of 3,000 requests per 10 minutes; mutations share a per-user limit of 300 per 10 minutes. An account that has not accepted the current terms gets `TERMS_REQUIRED` except on the routes marked above.

## Ask a question

Request:

```json
{
  "conversationId": "f1c2...",
  "question": "What changed in the EU AI Act in 2026?",
  "mode": "deeper",
  "searchProvider": "tavily"
}
```

`mode` is `quick`, `deep` or `deeper`; `searchProvider` is optional and defaults to the workspace setting. To retry the latest failed or stopped answer, send `{"conversationId":"f1c2...","retryOf":"<assistant message id>","mode":"quick"}` instead of a question. The server reuses the stored question and replaces that answer, so the question is never stored twice.

Response: `text/event-stream` with these events. The per-answer provider is returned in `usage.searchProvider` and persisted on the message.

```text
event: meta
data: {"conversationId":"f1c2...","messageId":"9a3b...","userMessageId":"77d0...","removed":[]}

event: stage
data: {"stage":"queued","detail":"Understanding the question"}

event: stage
data: {"stage":"searching","detail":"Searching the web"}

event: search
data: {"query":"What changed in the EU AI Act in 2026?","status":"searching"}

event: search
data: {"query":"What changed in the EU AI Act in 2026?","status":"done","results":8}

event: progress
data: {"completed":1,"total":1}

event: stage
data: {"stage":"reading","detail":"Reading 8 sources"}

event: sources
data: [{"id":"...","position":1,"title":"EU AI Act timeline","url":"https://example.org/ai-act","domain":"example.org","snippet":"...","publishedAt":"2026-08-01"}]

event: stage
data: {"stage":"writing","detail":"Writing with deepseek/deepseek-v4.1-flash"}

event: reasoning
data: {"text":"The sources agree on the entry-into-force date, but differ on enforcement. "}

event: delta
data: {"text":"The Act entered into force in August 2026 "}

event: citation
data: {"position":1}

event: usage
data: {"tokensIn":4210,"tokensOut":612,"costUsd":0.0232,"searchCostUsd":0.008,"latencyMs":18400,"searchRequests":1,"searchProvider":"tavily","resolvedModel":"deepseek/deepseek-v4.1-flash","upstreamProvider":"DeepInfra"}

event: done
data: {"noSources":false,"truncated":false,"degraded":false,"searchFailures":0}
```

`usage.costUsd` is the generation cost reported by OpenRouter (actual); `usage.searchCostUsd` is the selected provider's cost at its configured list price (estimated); `usage.searchProvider` identifies Brave, Tavily or Exa; `usage.resolvedModel` and `usage.upstreamProvider` are what OpenRouter actually used when it reports them. `done.searchFailures` greater than zero is the partial-search warning and `degraded` marks a Deep run whose planner failed twice.

Deep adds `plan` and repeated `progress` events:

```text
event: plan
data: {"queries":["EU AI Act timeline","EU AI Act obligations","EU AI Act enforcement"]}

event: search
data: {"query":"EU AI Act timeline","status":"searching"}

event: search
data: {"query":"EU AI Act timeline","status":"done","results":6}

event: progress
data: {"completed":1,"total":3}

event: progress
data: {"completed":2,"total":3}

event: progress
data: {"completed":3,"total":3}
```

Stream rules:

- OpenRouter errors before the stream starts are plain JSON. After headers are sent, a mid-stream error arrives as an SSE `error` event; the server ends the message with status `error`.
- OpenRouter usage arrives once in the final chunk before `[DONE]`. The server must not emit `usage` before it has either that chunk or a documented fallback estimate.
- `stage` transitions are monotonic for a run: `queued → searching → reading → writing`, followed by `stopped`, `no-sources` or `error` on an abnormal end. Successful completion is the separate `done` event. Deep may emit multiple `progress` events inside `searching`.
- `sources` is emitted once, before `writing`, with final positions. The client never renumbers sources after the first `delta`.
- A client disconnect aborts OpenRouter and pending search requests. Do not continue generating and billing in the background.

## Error codes

| Code | Meaning | HTTP |
|---|---|---|
| `UNAUTHENTICATED` | No valid signed-in session | 401 |
| `AUTH_STATE_INVALID` | Missing, expired or replayed OIDC transaction | 400 |
| `AUTH_EMAIL_UNVERIFIED` | Google did not return a verified email | 403 |
| `AUTH_FAILED` | OIDC discovery, exchange or ID-token verification failed | 502 |
| `CREDENTIAL_MISSING` | No credential for the required provider | 400 |
| `CREDENTIAL_INVALID` | Provider rejected the key | 400 |
| `INSUFFICIENT_CREDITS` | OpenRouter returned `402` | 402 |
| `MODEL_NOT_FOUND` | Model unavailable on OpenRouter | 400 |
| `PROVIDER_RATE_LIMITED` | OpenRouter or the search provider rate limit was hit | 429 |
| `BRAVE_PLAN_MISSING_SEARCH` | Brave key is not attached to a Search plan | 400 |
| `PROVIDER_UNAVAILABLE` | Provider outage, timeout or `5xx` | 502 |
| `SERVICE_BUSY` | Operator killswitch stopped new streams | 503 |
| `SEARCH_FAILED` | The search provider failed for every query | 502 |
| `CONTEXT_TOO_LARGE` | Query or context exceeds model limits | 400 |
| `GENERATION_IN_PROGRESS` | A generation is already active in this conversation | 409 |
| `RATE_LIMITED` | Beamling rate limit hit | 429 |
| `INTERNAL` | Unhandled error | 500 |

Additional codes:

| Code | Meaning | HTTP |
|---|---|---|
| `INVALID_JSON`, `INVALID_INPUT`, `INVALID_ID`, `INVALID_CURSOR` | Malformed request | 400 |
| `PAYLOAD_TOO_LARGE` | Request body over 64 KB | 413 |
| `INVALID_ORIGIN` | Cross-origin mutation rejected | 403 |
| `TERMS_REQUIRED` | The account has not accepted the current terms | 403 |
| `TERMS_OUTDATED` | Acceptance sent for a terms version that is no longer current | 409 |
| `SERVICE_CLOSING` | A new account was refused because a shutdown is scheduled | 403 |
| `SERVICE_CLOSED` | Sign-in refused after the shutdown date | 403 |
| `MAIL_NOT_CONFIGURED` | Shutdown scheduled with email notice but SMTP is not configured | 409 |
| `NOT_FOUND`, `CONVERSATION_NOT_FOUND`, `MESSAGE_NOT_FOUND` | Missing, or owned by another user (IDs are not probeable) | 404 |
| `RETRY_NOT_ALLOWED` | Only the latest failed or stopped answer can be retried | 409 |
| `CREDENTIAL_UNREADABLE` | A stored key cannot be decrypted; replace it | 400 |
| `INVALID_PROVIDER`, `MODEL_NOT_ALLOWED` | Provider or model outside the allowlist | 400 |
| `PROVIDER_ERROR` | Provider rejected the request for another reason | 502 |
| `SERVER_BUSY` | The global, Deeper (half of the global slots) or per-account concurrency cap is reached | 503 |
| `INTERRUPTED` | The server restarted or crashed while the answer was written (stored on the message) | — |
| `GENERATION_TIMEOUT` | Quick exceeded 60 s, Deep 90 s or Deeper 360 s (stored on the message) | — |

Warnings are not error codes:

- No usable sources: `stage: no-sources`, `done.noSources = true`, and a stored `no_sources` flag. The request still returns 200.
- Partial Deep retrieval: `done.searchFailures > 0` and a stored `search_failures` count. The answer still completes.
- Uncited answer: `uncited` is stored and the UI shows a warning; the request still completes.
- `GENERATION_TIMEOUT` is stored on a message with status `stopped` and the partial text kept ([Latency budget](pipeline.md#latency-budget)); the SSE stream ends with `stage: stopped`. There is no 504 response after a stream has started.
- `FORBIDDEN`, `SEARCH_PLAN_MISSING`, `SEARCH_PARTIAL`, `NO_SOURCES` and `QUOTA_EXCEEDED` are not emitted by the current implementation.

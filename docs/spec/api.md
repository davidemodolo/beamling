# API Design

## Conventions

- JSON over HTTPS, except SSE.
- Database-backed session cookie; no bearer tokens in Alpha 1.
- Error shape:

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
| GET | `/api/auth/login` | Start Google OIDC (transaction cookie, redirect) | None |
| GET | `/api/auth/callback/google` | Verify OIDC, create/resume account and session | Transaction cookie |
| POST | `/api/auth/logout` | Revoke the session; `?scope=all` revokes all | Session |
| GET | `/api/state` | Account, settings, masked credentials, conversation count, first page of summaries | Session |
| POST | `/api/chat` | Ask or retry; returns SSE | Session |
| POST | `/api/chat/stop` | Stop an answer by message ID | Session |
| GET | `/api/conversations?cursor=` | Next page of summaries, newest first (50) | Session |
| POST | `/api/conversations` | Create an empty conversation; the 100 cap applies on its first question (`meta.removed` lists deleted ids) | Session |
| GET | `/api/conversations/:id` | Newest 60 messages with sources, plus `hasMoreMessages` | Session |
| GET | `/api/conversations/:id/messages?before=` | 60 messages before a message ID | Session |
| PATCH | `/api/conversations/:id` | Change mode or pin state | Session |
| DELETE | `/api/conversations/:id` | Delete | Session |
| POST | `/api/credentials` | Create and validate a credential with plan/limits; `validate: false` skips validation | Session |
| POST | `/api/credentials/:id/validate` | Re-validate | Session |
| PATCH | `/api/credentials/:id` | Update plan, expiry or budget | Session |
| DELETE | `/api/credentials/:id` | Delete credential and usage | Session |
| POST | `/api/account/terms` | Accept current terms and confirm age | Session (terms not required) |
| GET | `/api/account/export` | Export all account data as JSON | Session (terms not required) |
| DELETE | `/api/account` | Delete account and data | Session (terms not required) |
| POST | `/api/internal/kill` | Open or close new streams | Bearer `KILL_SWITCH_SECRET` |
| GET | `/api/internal/metrics` | Deployment flag, active streams and build identity | Bearer `METRICS_SECRET` |
| GET, POST | `/api/internal/shutdown` | Show, schedule (`days` ≥ 14, `reason`, `notify`) or cancel shutdown; returns notice progress | Bearer `KILL_SWITCH_SECRET` |
| GET | `/api/health` | Liveness and database check | None |
| GET | `/.well-known/security.txt` | RFC 9116 security contact | None |

- Authenticated responses: `Cache-Control: private, no-store`, `Vary: Cookie`.
- Body limit 64 KB (`PAYLOAD_TOO_LARGE`).
- Rate limits per 10 minutes: GET 600/user and 3,000/IP; mutations 300/user.
- Terms not accepted: `TERMS_REQUIRED`, except on routes marked above.

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

`mode`: `quick`, `deep` or `deeper`. `searchProvider` defaults to the workspace setting. Retry the latest failed or stopped answer with `{"conversationId":"f1c2...","retryOf":"<assistant message id>","mode":"quick"}`; the stored question is reused and the answer replaced.

Response: `text/event-stream`:

```text
event: meta
data: {"conversationId":"f1c2...","messageId":"9a3b...","userMessageId":"77d0...","removed":[]}

event: stage
data: {"stage":"queued","detail":"Understanding the question"}

event: stage
data: {"stage":"searching","detail":"Searching the web"}

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

- `usage.costUsd`: actual generation cost from OpenRouter.
- `usage.searchCostUsd`: estimated at the provider's list price.
- `usage.searchProvider`: Brave, Tavily or Exa; persisted on the message.
- `usage.resolvedModel`, `usage.upstreamProvider`: what OpenRouter used, when reported.
- `done.searchFailures > 0`: partial-search warning. `degraded`: Deep planner failed twice.

Deep adds `plan` and one `progress` per search:

```text
event: plan
data: {"queries":["EU AI Act timeline","EU AI Act obligations","EU AI Act enforcement"]}

event: search
data: {"query":"EU AI Act timeline","status":"searching"}

event: search
data: {"query":"EU AI Act timeline","status":"done","results":6}

event: progress
data: {"completed":1,"total":3}
```

Stream rules:

- Errors before the stream starts are plain JSON; after headers, an SSE `error` event, and the message ends with status `error`.
- OpenRouter usage arrives in the final chunk before `[DONE]`; emit `usage` only after it or a documented fallback estimate.
- `stage` is monotonic: `queued → searching → reading → writing`, then `stopped`, `no-sources` or `error` on abnormal end. Success is the `done` event.
- `sources` is emitted once, before `writing`, with final positions; never renumbered.
- Client disconnect aborts OpenRouter and pending searches; nothing continues in the background.

## Error codes

| Code | Meaning | HTTP |
|---|---|---|
| `UNAUTHENTICATED` | No valid session | 401 |
| `AUTH_STATE_INVALID` | Missing, expired or replayed OIDC transaction | 400 |
| `AUTH_EMAIL_UNVERIFIED` | Google did not return a verified email | 403 |
| `AUTH_FAILED` | OIDC discovery, exchange or token verification failed | 502 |
| `CREDENTIAL_MISSING` | No credential for the required provider | 400 |
| `CREDENTIAL_INVALID` | Provider rejected the key | 400 |
| `INSUFFICIENT_CREDITS` | OpenRouter returned `402` | 402 |
| `MODEL_NOT_FOUND` | Model unavailable on OpenRouter | 400 |
| `PROVIDER_RATE_LIMITED` | Model or search provider rate limit | 429 |
| `BRAVE_PLAN_MISSING_SEARCH` | Brave key has no Search plan | 400 |
| `PROVIDER_UNAVAILABLE` | Provider outage, timeout or `5xx` | 502 |
| `SERVICE_BUSY` | Killswitch stopped new streams | 503 |
| `SEARCH_FAILED` | Every search failed | 502 |
| `CONTEXT_TOO_LARGE` | Query or context exceeds model limits | 400 |
| `GENERATION_IN_PROGRESS` | A generation is already active here | 409 |
| `RATE_LIMITED` | Beamling rate limit hit | 429 |
| `INTERNAL` | Unhandled error | 500 |
| `INVALID_JSON`, `INVALID_INPUT`, `INVALID_ID`, `INVALID_CURSOR` | Malformed request | 400 |
| `PAYLOAD_TOO_LARGE` | Request body over 64 KB | 413 |
| `INVALID_ORIGIN` | Cross-origin mutation rejected | 403 |
| `TERMS_REQUIRED` | Current terms not accepted | 403 |
| `TERMS_OUTDATED` | Terms version no longer current | 409 |
| `SERVICE_CLOSING` | New account refused; shutdown scheduled | 403 |
| `SERVICE_CLOSED` | Sign-in refused after the shutdown date | 403 |
| `MAIL_NOT_CONFIGURED` | Email notice requested without SMTP | 409 |
| `NOT_FOUND`, `CONVERSATION_NOT_FOUND`, `MESSAGE_NOT_FOUND` | Missing or not owned (not probeable) | 404 |
| `RETRY_NOT_ALLOWED` | Only the latest failed or stopped answer is retryable | 409 |
| `CREDENTIAL_UNREADABLE` | Stored key cannot be decrypted | 400 |
| `INVALID_PROVIDER`, `MODEL_NOT_ALLOWED` | Provider or model outside the allowlist | 400 |
| `PROVIDER_ERROR` | Other provider rejection | 502 |
| `SERVER_BUSY` | Global, Deeper (half the global slots) or per-account concurrency cap | 503 |
| `INTERRUPTED` | Server restarted mid-answer (stored) | Not returned |
| `GENERATION_TIMEOUT` | Quick > 60 s, Deep > 180 s, Deeper > 360 s (stored) | Not returned |

Warnings (not error codes):

- No sources: `stage: no-sources`, `done.noSources = true`, stored `no_sources`; still 200.
- Partial Deep retrieval: `done.searchFailures > 0`, stored `search_failures`.
- Uncited: stored `uncited`, UI warning.
- `GENERATION_TIMEOUT`: message `stopped`, partial text kept ([Latency budget](pipeline.md#latency-budget)), stream ends with `stage: stopped`; no 504 after streaming starts.
- Not emitted by current code: `FORBIDDEN`, `SEARCH_PLAN_MISSING`, `SEARCH_PARTIAL`, `NO_SOURCES`, `QUOTA_EXCEEDED`.

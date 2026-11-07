# Error model

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
| `INVALID_ORIGIN` | Cross-origin mutation (`Origin` or `Sec-Fetch-Site`) | 403 |
| `TERMS_REQUIRED` | Account has not accepted the current `LEGAL_VERSION` | 403 |
| `TERMS_OUTDATED` | `POST /api/account/terms` with a version other than the current one | 409 |
| `INVALID_PROVIDER` | Plan or limits sent for a key whose provider has none; revalidating a key whose provider was removed from the catalog | 400 |
| `MODEL_NOT_ALLOWED` | Model outside allowlist | 400 |
| `CREDENTIAL_MISSING` | No key for the selected model's provider or search provider | 400 |
| `CREDENTIAL_INVALID` | Provider rejected key | 400 |
| `CREDENTIAL_UNREADABLE` | Stored key cannot be decrypted | 400 |
| `INSUFFICIENT_CREDITS` | Model or search provider `402`; a DeepSeek key without balance at validation | 402 |
| `MODEL_NOT_FOUND` | Model provider `404` | 400 |
| `BRAVE_PLAN_MISSING_SEARCH` | Brave key has no Search plan | 400 |
| `SEARCH_PLAN_MISSING` | Tavily key has no Search access (`432`) | 400 |
| `QUOTA_EXCEEDED` | Tavily plan limit reached (`433`) | 402 |
| `PROVIDER_RATE_LIMITED` | Model or search provider `429` | 429 |
| `PROVIDER_UNAVAILABLE` | Timeout, network failure or provider `5xx` (502); KMS or transport failure while reading a key for revalidation (503) | 502 / 503 |
| `SERVICE_BUSY` | The operator kill switch stopped new streams, or the process is shutting down (`Retry-After: 15`) | 503 |
| `PROVIDER_ERROR` | Other provider rejection | 502 |
| `EMPTY_RESPONSE` | The model returned an empty answer | 502 |
| `SEARCH_FAILED` | Every search failed | 502 |
| `CONTEXT_TOO_LARGE` | The model provider says the context is too long | 400 |
| `GENERATION_IN_PROGRESS` | Another stream owns the conversation | 409 |
| `SERVER_BUSY` | Global, Deeper or per-account stream cap, or lock timeout | 503 |
| `RETRY_NOT_ALLOWED` | Retrying a non-latest or non-failed answer | 409 |
| `RATE_LIMITED` | Beamling rate limit | 429 |
| `SIGNUPS_PAUSED` | Hourly new-account cap reached, or `SIGNUP_MODE=paused` (callback redirects to `/login?error=signups_paused`) | 429 |
| `SIGNUP_NOT_INVITED` | New account not on the allowlist when `SIGNUP_MODE=allowlist` | 403 |
| `SERVICE_CLOSING` | New account while a shutdown is scheduled (callback redirects to `/login?error=service_closing`) | 403 |
| `SERVICE_CLOSED` | Sign-in after the shutdown date (callback redirects to `/login?error=service_closed`) | 403 |
| `MAIL_NOT_CONFIGURED` | Shutdown scheduled with `notify: true` but `SMTP_URL`/`MAIL_FROM` are unset | 409 |
| `NOT_FOUND` / `CONVERSATION_NOT_FOUND` / `MESSAGE_NOT_FOUND` | Missing or not owned; also an internal endpoint whose secret is not configured | 404 |
| `UNAUTHORIZED` | Internal endpoint called with a wrong bearer secret | 401 |
| `INTERNAL` | Unhandled error | 500 |
| `INTERRUPTED` | Stored when a stream is abandoned | — |
| `GENERATION_TIMEOUT` | Stored when the time limit is reached | — |
| `CLIENT_DISCONNECT` | Stored on an answer stopped because the browser disconnected | — |

The UI maps `CREDENTIAL_MISSING`, `CREDENTIAL_INVALID`, `CREDENTIAL_UNREADABLE`, `BRAVE_PLAN_MISSING_SEARCH`, `SEARCH_PLAN_MISSING` and `MODEL_NOT_FOUND` to Settings; `UNAUTHENTICATED` to a page reload (which leads to sign-in); `TERMS_REQUIRED` to `/welcome`; most provider failures to retry. `GENERATION_TIMEOUT` and `INTERRUPTED` appear on the stopped/error answer card.

`@/lib/api.ts` also synthesizes client-side codes: `NETWORK`, `TIMEOUT`, `STREAM_ENDED`, `REQUEST_FAILED` and `INVALID_RESPONSE`.

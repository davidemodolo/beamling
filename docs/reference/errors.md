# Error model

Error codes are stable strings. The UI maps each to a title, message and action.

| Code | Cause | HTTP |
|---|---|---|
| `UNAUTHENTICATED` | No or expired session | 401 |
| `AUTH_STATE_INVALID` | Missing, expired or replayed OIDC transaction cookie | 400 |
| `AUTH_EMAIL_UNVERIFIED` | No verified email from the provider | 403 |
| `AUTH_FAILED` | OIDC discovery, token exchange or ID-token check failed | 502 |
| `INVALID_JSON` | Unparseable body | 400 |
| `INVALID_INPUT` | Schema failure, empty or oversized question | 400 |
| `INVALID_ID` | Non-UUID route id | 400 |
| `INVALID_CURSOR` | Bad pagination cursor | 400 |
| `PAYLOAD_TOO_LARGE` | Body over 64 KB | 413 |
| `INVALID_ORIGIN` | Cross-origin mutation (`Origin` or `Sec-Fetch-Site`) | 403 |
| `TERMS_REQUIRED` | Current `LEGAL_VERSION` not accepted | 403 |
| `TERMS_OUTDATED` | `POST /api/account/terms` with a non-current version | 409 |
| `INVALID_PROVIDER` | Plan or limits for a provider without them; revalidating a key whose provider left the catalog | 400 |
| `MODEL_NOT_ALLOWED` | Model outside the allowlist | 400 |
| `CREDENTIAL_MISSING` | No key for the selected model or search provider | 400 |
| `CREDENTIAL_INVALID` | Provider rejected the key | 400 |
| `CREDENTIAL_UNREADABLE` | Stored key cannot be decrypted | 400 |
| `INSUFFICIENT_CREDITS` | Provider `402`; DeepSeek key without balance at validation | 402 |
| `MODEL_NOT_FOUND` | Model provider `404` | 400 |
| `MODEL_NO_VISION` | Images sent to a model without `vision` | 400 |
| `MODEL_PRIVACY_SETTING` | OpenRouter `404` naming the data policy (free models blocked) | 400 |
| `FREE_LIMIT_REACHED` | OpenRouter `429` `free-models-per-day` | 429 |
| `BRAVE_PLAN_MISSING_SEARCH` | Brave key without the Search plan | 400 |
| `SEARCH_PLAN_MISSING` | Tavily key without Search access (`432`) | 400 |
| `QUOTA_EXCEEDED` | Tavily plan limit (`433`) | 402 |
| `MODEL_BUSY` | Provider `429` saying the model is rate-limited upstream (shared capacity, not the key) | 429 |
| `PROVIDER_RATE_LIMITED` | Provider `429` | 429 |
| `PROVIDER_UNAVAILABLE` | Timeout, network or provider `5xx` (502); KMS or transport failure reading a key for revalidation (503) | 502 / 503 |
| `SERVICE_BUSY` | Kill switch on, or process shutting down (`Retry-After: 15`) | 503 |
| `PROVIDER_ERROR` | Other provider rejection | 502 |
| `EMPTY_RESPONSE` | Model returned an empty answer | 502 |
| `SEARCH_FAILED` | Every search failed | 502 |
| `CONTEXT_TOO_LARGE` | Provider says the context is too long | 400 |
| `GENERATION_IN_PROGRESS` | Another stream owns the conversation | 409 |
| `SERVER_BUSY` | Global, Deeper or per-account stream cap, or lock timeout (503); the account already has its allowed chat requests being read or prepared (429) | 503, 429 |
| `RETRY_NOT_ALLOWED` | `retryOf` names an answer that is not the latest, or is still being written | 409 |
| `RATE_LIMITED` | Beamling rate limit | 429 |
| `SERVICE_FULL` | Database at `DATABASE_SIZE_LIMIT_MB`; new questions paused for everyone; the answer card links to `/limits` | 503 |
| `STORAGE_FULL` | Account storage at its limit; the answer card links to `/limits` | 403 |
| `CONVERSATION_FULL` | Conversation at its question cap; the answer card links to `/limits` | 409 |
| `SIGNUPS_PAUSED` | Hourly new-account cap or `SIGNUP_MODE=paused`; callback redirects to `/login?error=signups_paused` | 429 |
| `SIGNUP_NOT_INVITED` | Not on the allowlist with `SIGNUP_MODE=allowlist` | 403 |
| `SERVICE_CLOSING` | New account during a scheduled shutdown; redirects to `/login?error=service_closing` | 403 |
| `SERVICE_CLOSED` | Sign-in after the shutdown date; redirects to `/login?error=service_closed` | 403 |
| `MAIL_NOT_CONFIGURED` | Shutdown with `notify: true` but no `SMTP_URL`/`MAIL_FROM` | 409 |
| `NOT_FOUND` / `CONVERSATION_NOT_FOUND` / `MESSAGE_NOT_FOUND` | Missing or not owned; internal endpoint without its secret configured | 404 |
| `UNAUTHORIZED` | Internal endpoint with a wrong bearer secret | 401 |
| `INTERNAL` | Unhandled error | 500 |
| `INTERRUPTED` | Stored on an abandoned stream | Not returned |
| `GENERATION_TIMEOUT` | Stored when the time limit is hit | Not returned |
| `CLIENT_DISCONNECT` | Stored when the browser disconnected | Not returned |

UI actions (`describeAnswerError` in `lib/api.ts`):

- **Settings**: `CREDENTIAL_MISSING`, `CREDENTIAL_INVALID`, `CREDENTIAL_UNREADABLE`, `BRAVE_PLAN_MISSING_SEARCH`, `SEARCH_PLAN_MISSING`, `MODEL_NOT_FOUND`, `MODEL_NO_VISION`, `MODEL_PRIVACY_SETTING`, `FREE_LIMIT_REACHED`.
- **Reload** (leads to sign-in): `UNAUTHENTICATED`.
- **`/welcome`**: `TERMS_REQUIRED`.
- **See limits** (`/limits`, no retry): `SERVICE_FULL`, `STORAGE_FULL`, `CONVERSATION_FULL`.
- **Retry**: most provider and capacity failures, including `MODEL_BUSY` (which, unlike `PROVIDER_RATE_LIMITED`, does not mark the key as rate-limited).

`GENERATION_TIMEOUT` and `INTERRUPTED` show on the stopped or failed answer card. The client also creates its own codes: `NETWORK`, `TIMEOUT`, `STREAM_ENDED`, `REQUEST_FAILED`, `INVALID_RESPONSE`.

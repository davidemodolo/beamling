# Security controls

## Browser and HTTP

A per-request CSP is generated in `proxy.ts` with a random nonce:

```text
default-src 'self'
script-src 'self' 'nonce-…' 'strict-dynamic'
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob: https://*.googleusercontent.com
font-src 'self'
connect-src 'self'
object-src 'none'
base-uri 'self'
form-action 'self'
frame-ancestors 'none'
```

- Development adds `'unsafe-eval'` and `ws: wss:` for hot reload; production adds `upgrade-insecure-requests`.
- Pages render dynamically so Next.js can attach the nonce.
- The proxy skips `/api`, `/_next/static`, `/_next/image` and the static icons in `public/`.
- API responses: `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
- Global headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster: ?1`, `X-Permitted-Cross-Domain-Policies: none`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`, HSTS. `poweredByHeader` off.
- Authenticated API responses are private and vary on Cookie.
- Mutations reject cross-site `Sec-Fetch-Site` and check Origin (when present) against `APP_URL`, never a client-supplied host.
- Session cookie: HttpOnly, SameSite=Lax, `__Host-` prefix when Secure. 30-day idle, 90-day absolute; OIDC uses state, nonce and PKCE ([Accounts](accounts.md)).

## Input and output

- JSON bodies: 64 KB cap (streamed, plus `Content-Length` pre-check), Zod-validated.
- Route ids must be UUIDs; Drizzle parameterizes queries.
- Control characters stripped from questions and stored text; NUL removed from provider output.
- Markdown uses a custom React renderer; raw HTML is never parsed.
- Links: `http:`/`https:` only, no embedded credentials. Source URLs are checked before display and prompting.
- Snippets are sanitized for the prompt ([Prompt construction](answer-pipeline.md#prompt-construction)); planner output is data only.

## Provider-key handling

- Never logged, kept in browser state or returned after creation.
- Stored as encrypted rows, a keyed fingerprint and last four characters (keys of 20+ characters only).
- Provider checks are rate-limited ([Validation and status](credentials.md#validation-and-status)).
- Decryption is bound to the user's row and AAD; plaintext lives only for the request.
- `KMS_PROVIDER` picks the adapter; the env adapter and re-wrap script are for local tests only.

## Rate limiting and concurrency

- Fixed-window counters in `rate_limits`, one atomic upsert, PostgreSQL clock.
- Separate limits for login starts, chat, conversation creation, credentials, key validation, exports, reads and writes, plus a global 300 authenticated mutations per user per 10 minutes.
- IP keys are HMACed with an `AUTH_SECRET` subkey; raw addresses are never stored.
- Stream caps (global, per account, Deeper half) are checked across instances under an advisory lock ([Starting an exchange](conversations.md#starting-an-exchange)); one stream per conversation via a partial unique index.
- Signup modes `open`, `allowlist` (production default) or `paused`; open mode has per-IP and global buckets.
- Brave spacing uses a per-key database slot.

## Logging and error handling

- One-line JSON logs. Each API request logs request id, method, path, status, duration and a keyed user hash; `x-request-id` is returned.
- Error summaries keep name, Postgres code, message and SQL text, without parameters. Provider adapters log only provider and HTTP status; bodies and keys are redacted.
- Never logged: request bodies, cookies, authorization headers, plaintext keys.
- Unknown errors return `INTERNAL` with a generic message; no stack traces.
- `messages.error_message` is encrypted (except the fixed `INTERRUPTED` text).
- `lib/server/audit.ts` writes `audit` lines with the event, keyed user and IP hashes and a few scalar fields; never content, keys or emails:

| Event | Logged by | Fields |
|---|---|---|
| `sign_in` | OIDC callback | `newAccount` |
| `sign_out_all` | `POST /api/auth/logout?scope=all` | None |
| `terms_accepted` | `POST /api/account/terms` | `version` |
| `credential_saved` | `POST /api/credentials` | `credentialId`, `provider`, `replaced` |
| `credential_deleted` | `DELETE /api/credentials/:id` | `credentialId` |
| `data_exported` | `GET /api/account/export` | None |
| `analytics_opt_out` / `analytics_opt_in` | `PATCH /api/settings` | None |
| `account_deleted` | `DELETE /api/account` | None |
| `inactive_account_deleted` | [Cleanup](conversations.md#cleanup) | None |
| `shutdown_scheduled` | `POST /api/internal/shutdown` | `scheduledAt` |
| `shutdown_cancelled` | `POST /api/internal/shutdown` | None |
| `shutdown_account_deleted` | [Shutdown](conversations.md#scheduled-shutdown) after the date | None |
| `internal_auth_failed` | Internal endpoint, bad bearer | `endpoint` |

## Supply chain and release checks

- CI on every push and PR: `pnpm audit --audit-level moderate`, Gitleaks history scan, `pnpm check:unused` (knip) and `pnpm check:dupes` (jscpd, 0% threshold, 8+ lines).
- Actions pinned to commit SHAs; CI Postgres and runtime base images pinned to digests. `actions/checkout` uses `persist-credentials: false` in test and deploy jobs. Installs use `--ignore-scripts`.
- Release records the GHCR digest; deploy uses it and checks `/api/health`.
- Dependabot: npm, Actions and Docker, weekly. The image is scanned separately (Trivy: no known vulnerabilities).
- `pnpm-workspace.yaml` overrides dev-only `minimatch` (ESLint) and drizzle-kit's `esbuild` to patched versions, and accepts ESLint 10 as a peer for `eslint-config-next` plugins.

## Data deletion

- Conversation and account deletes cascade ([Tables](conversations.md#tables)); account deletion also removes rate-limit keys. Local chats abort; other instances stop on the next poll.
- Automatic deletion: [Cleanup](conversations.md#cleanup), the [100-conversation cap](conversations.md#pagination-and-deletion) and [Scheduled shutdown](conversations.md#scheduled-shutdown).
- `GET /api/account/export` returns all stored data as JSON (GDPR Art. 15/20), without keys or session tokens.
- No soft delete or recovery.
- PostHog erasure (when deletion is configured, independent of `ANALYTICS_ENABLED`):
  - An `analytics_erasures` row (HMAC distinct id only) commits with the account deletion.
  - First attempt in the request, then by cleanup; rows claimed with `FOR UPDATE SKIP LOCKED`, hidden 5 minutes.
  - Retries back off from 5 minutes to 24 hours, never dropped; from the fifth failure, logged as `PostHog erasure keeps failing` with an 8-character id prefix.
  - After a success, one confirming pass an hour later; then the row is deleted.

## Analytics privacy

Off unless `ANALYTICS_ENABLED=true` with full PostHog config. Server-side only: no browser SDK, autocapture, replay, heatmaps, surveys or flags.

- `lib/server/analytics.ts` owns events, property allowlist, identity, timeout and deletion; `lib/server/analytics-erasure.ts` runs the queue. The client lives on `globalThis` so the shutdown hook flushes it.
- `distinctId = HMAC-SHA256(userId, ANALYTICS_SALT)`, 32 hex chars. No raw ids, emails, tokens or IPs. Keep the salt stable: rotating it orphans events.
- Payloads are rebuilt from the allowlist (scalars only). `$geoip_disable` true, `$ip` `0.0.0.0`.
- Best-effort: max 8 in flight, 2 s timeout, failures dropped and logged without payload.
- Erasure calls `bulk_delete` with `delete_events` and `delete_recordings`; non-2xx or `deletion_errors` is a failure.
- Opt-out: `capture` drops events when `settings.analytics_opt_out` is set, an erasure is pending, or the check fails. Cached per process for 60 s (max 10,000 accounts), so other instances may capture briefly; the confirming erasure pass removes those. Opting out queues erasure of past events ([Settings](api.md#settings-and-model-allowlist)).

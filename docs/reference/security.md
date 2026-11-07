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

- Development adds `'unsafe-eval'` and `ws: wss:` for hot reload.
- Pages are rendered dynamically so Next.js can attach the nonce to its scripts.
- The proxy skips `/api`, `/_next/static`, `/_next/image` and the static icons in `public/` (`favicon.ico` with 16/32/48 px, `icon.svg`, `apple-touch-icon.png`; light eyes with their beams).
- API responses carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
- Global headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster: ?1`, `X-Permitted-Cross-Domain-Policies: none`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`, and HSTS. Production CSP adds `upgrade-insecure-requests`.
- `poweredByHeader` is disabled.
- Authenticated API responses are private and vary on Cookie.
- Mutations reject a cross-site `Sec-Fetch-Site` and check Origin when present against the configured `APP_URL` origin, never a client-supplied host. The session cookie is HttpOnly and SameSite=Lax.
- OIDC login uses state, nonce and PKCE; the callback rejects replayed or expired transaction cookies.
- The session cookie uses the `__Host-` prefix when Secure is enabled, which requires host-only scope, path `/`, and Secure.
- Sessions have a 30-day idle expiry and a 90-day absolute lifetime; signing in revokes the browser's previous session ([Accounts, OIDC and sessions](accounts.md)).

## Input and output

- JSON bodies are streamed through a 64 KB cap, with a pre-check on `Content-Length`.
- Route ids must be UUIDs before reaching PostgreSQL.
- Control characters are stripped from questions and stored text; NUL is removed from provider output before writes.
- Drizzle parameterizes queries.
- Zod validates every JSON body.
- Markdown output is a custom React renderer; raw HTML is never parsed.
- Link schemes are restricted to `http:` and `https:`, and URLs with embedded credentials are rejected.
- Source URLs from the selected search provider are checked before display and before prompt assembly.
- Source snippets are stripped of fake closing `<source>` tags and escaped when placed in attributes.
- Planner output is parsed as data and cannot change model, provider or system prompts.

## Provider-key handling

- Keys are never logged, stored in browser state, or returned after creation.
- Only encrypted rows, a keyed fingerprint and the last four characters (only for keys of at least 20 characters) are stored.
- Key checks against providers are capped per account per day and per IP per hour ([Validation and status](credentials.md#validation-and-status)).
- Decryption is scoped to the authenticated user's row and AAD.
- The provider key is held in memory only for the request that needs it.
- The KMS adapter is selected by `KMS_PROVIDER`; production refuses to boot without the configured KMS key.
- The env adapter and re-wrap script are for local tests only.

## Rate limiting and concurrency

- Fixed-window counters in `rate_limits` use one atomic insert-or-update.
- Login starts, chat, conversation creation, credentials, key validation, exports, reads and writes have separate keys and limits. Every authenticated mutation counts against a global 300 per user per 10 minutes.
- IP keys are keyed-HMACed with a subkey derived from `AUTH_SECRET`; raw addresses are not stored and a database dump cannot enumerate them.
- The global stream cap is enforced inside a transaction-scoped advisory lock and counts committed streaming rows across all instances. A per-account cap (`MAX_CONCURRENT_CHATS_PER_USER`, default 2) prevents one account from occupying every slot, and Deeper answers may hold at most half of the global slots.
- Signup enforcement is `open`, `allowlist` or `paused`; production defaults to allowlist, and open mode also has per-IP and global buckets.
- Rate-limit windows, stale-stream detection and cleanup use PostgreSQL time where the decision is shared across instances.
- A second stream in one conversation is blocked by a partial unique index, not by process memory.
- Brave request spacing uses a per-key database slot, so multiple instances cannot exceed the configured interval.
- DELETE conversation/account aborts local streams and leaves other instances to observe the missing/non-streaming row through their stop poll.

## Logging and error handling

- Logs are one-line JSON with level, timestamp, message and optional fields.
- API routes log one structured completion line with request id, method, path, status, duration and a keyed user hash; `x-request-id` is also returned to the client.
- Error summaries keep the error name, Postgres code, message and failing SQL text; they strip SQL parameters.
- Provider error payload text is not logged; adapters log provider and HTTP status only. Request/response body text plus bearer/provider keys are redacted from other error summaries.
- Request bodies, cookies, authorization headers and plaintext keys are not logged.
- Unknown errors return `INTERNAL` with a generic message; details stay in server logs.
- The API never returns stack traces.
- Provider responses that echo user content are encrypted in `messages.error_message`; the fixed `INTERRUPTED` message is plaintext.
- `lib/server/audit.ts` writes security audit events to the structured log as `audit` lines with the event name, a keyed hash of the user id (`hmacToken`), the keyed client-IP hash and a few scalar fields. Content, keys and email addresses are never passed. Events:

| Event | Logged by | Fields |
|---|---|---|
| `sign_in` | OIDC callback | `newAccount` |
| `sign_out_all` | `POST /api/auth/logout?scope=all` | — |
| `terms_accepted` | `POST /api/account/terms` | `version` |
| `credential_saved` | `POST /api/credentials` | `credentialId`, `provider`, `replaced` |
| `credential_deleted` | `DELETE /api/credentials/:id` | `credentialId` |
| `data_exported` | `GET /api/account/export` | — |
| `analytics_opt_out` / `analytics_opt_in` | `PATCH /api/settings` | — |
| `account_deleted` | `DELETE /api/account` | — |
| `inactive_account_deleted` | Cleanup ([Cleanup](conversations.md#cleanup)) | — |
| `shutdown_scheduled` | `POST /api/internal/shutdown` | `scheduledAt` |
| `shutdown_cancelled` | `POST /api/internal/shutdown` | — |
| `shutdown_account_deleted` | Shutdown run after the closing date ([Scheduled shutdown](conversations.md#scheduled-shutdown)) | — |
| `internal_auth_failed` | Kill, metrics or shutdown endpoint with a wrong or missing bearer | `endpoint` |

## Supply chain and release checks

- CI runs `pnpm audit --audit-level moderate` over production and development dependencies, and a Gitleaks history scan, on every push and pull request.
- GitHub Actions are pinned to full commit SHAs, the CI PostgreSQL service image is pinned to a digest, and the runtime base image is pinned to a multi-arch digest. `actions/checkout` runs with `persist-credentials: false` in the test and deploy jobs, so the token is not left in `.git/config` while tests, the build and Playwright run third-party code. Dependency install uses `--ignore-scripts`; the mascot package build is explicit.
- The release job records the pushed GHCR digest; deploy uses that digest and verifies `/api/health` afterward.
- CI fails on unused files, exports or dependencies (`pnpm check:unused`, knip) and on any duplicated block of 8+ lines (`pnpm check:dupes`, jscpd with a 0% threshold).
- Dependabot checks npm, GitHub Actions and Docker weekly.
- The built image is scanned separately; the current image has no HIGH, CRITICAL or MEDIUM findings after removing the npm tree and applying Alpine security updates.
- `pnpm audit` reports no known vulnerabilities. `pnpm-workspace.yaml` overrides two development-only packages to their patched versions, `minimatch` (ESLint) and the `esbuild` used by drizzle-kit's `@esbuild-kit` loader; drop each override once its parent ships the fix.
- `pnpm peers check` is clean. `pnpm-workspace.yaml` accepts ESLint 10 for `eslint-config-next`'s react, jsx-a11y and import plugins, whose latest releases have not yet widened their peer range; their rules were verified to run under ESLint 10.
- Two deprecation notices remain, both from current upstream releases with no advisories: `node-domexception` via Google's `@google-cloud/kms` client (`node-fetch`), and `@esbuild-kit/*` via drizzle-kit (development only).
- A Trivy scan of the production image (Node 26.13.0, Alpine 3.24.4) reports no known vulnerabilities at any severity.

## Data deletion

- Deleting a conversation cascades to messages and sources.
- Deleting an account cascades to sessions, the workspace data key, credentials, usage, settings, conversations, messages and sources, and removes the user's rate-limit keys.
- Local active chats are aborted; remote instances stop on the next poll.
- The cleanup job removes expired sessions, counters, stale provider slots, empty conversations older than one hour and conversations inactive for 60 days, and deletes accounts unused for 24 months or never accepted after 7 days ([Cleanup](conversations.md#cleanup)).
- Storing the first question of a conversation beyond 100 deletes the least recently active unpinned ones ([Pagination and deletion](conversations.md#pagination-and-deletion)).
- After a scheduled shutdown date every account is deleted through the same path as a user deletion ([Scheduled shutdown](conversations.md#scheduled-shutdown)).
- `GET /api/account/export` gives the user a full JSON copy of their stored data (Art. 15 and 20 GDPR) without provider keys or session tokens ([Endpoints](api.md#endpoints)).
- There is no soft-delete or recovery path.
- When PostHog deletion is configured, account deletion also erases the PostHog person through a durable queue in `analytics_erasures`, which holds only the HMAC distinct id. Deletion settings do not depend on `ANALYTICS_ENABLED` or the ingestion token; a partial deletion configuration is a production boot error.
  - The row and the account deletion commit in one transaction, so a failed deletion does not erase a live account's analytics and a successful deletion cannot lose the erasure.
  - The first attempt runs in the deletion request; the cleanup job runs the rest. Rows are claimed with `FOR UPDATE SKIP LOCKED` and hidden for 5 minutes, so instances never run the same row at once.
  - A failure retries with exponential backoff from 5 minutes, capped at 24 hours, and is never dropped. From the fifth failed attempt each failure is logged as an error (`PostHog erasure keeps failing`) with only an 8-character prefix of the distinct id.
  - A success schedules one confirming pass an hour later, which catches events that were still in flight when the account was deleted. The row is deleted after the second success.
  - Deletion uses its own configuration, so it keeps running behind the `ANALYTICS_ENABLED=false` kill switch as long as the PostHog variables stay set.

## Analytics privacy

Analytics is disabled unless `ANALYTICS_ENABLED=true` and the full PostHog configuration is present. It is server-side only: the browser loads no PostHog SDK and there is no autocapture, session replay, heatmap, survey or feature flag.

- `lib/server/analytics.ts` owns the event map, property allowlist, HMAC identity, timeout, in-flight cap and deletion call. The client is kept on `globalThis`, so the shutdown hook (bundled separately from the route handlers) flushes the same in-flight set the routes fill. `lib/server/analytics-erasure.ts` runs the erasure queue.
- `distinctId = HMAC-SHA256(userId, ANALYTICS_SALT)` truncated to 32 hex characters. Raw user ids, email addresses, session tokens and IP addresses are never sent. Keep the salt stable for the life of the PostHog project; rotating it orphans existing events and makes deletion by the new hash incomplete.
- Every payload is rebuilt from the allowlist, so unknown keys and non-scalar values are dropped even if a caller passes them accidentally.
- `$geoip_disable` is true and `$ip` is `0.0.0.0`.
- Events are best-effort: at most eight requests are in flight, each has a 2-second timeout, failures are dropped and logged without payloads, and there are no retries that block a request.
- Erasure calls PostHog's `bulk_delete` endpoint with `delete_events` and `delete_recordings`; a non-2xx response or any `deletion_errors` counts as a failure. The personal key and project id never enter the browser.
- Local and test environments remain silent because the flag is opt-in. Production refuses to start with an incomplete enabled configuration.
- Per-account objection: before sending, `capture` asks `analyticsExcluded`, which is true when `settings.analytics_opt_out` is set or an `analytics_erasures` row is pending for the account's distinct id, and drops the event. A failing check also drops the event. The answer is cached per process for 60 seconds (at most 10,000 accounts) so analytics adds no query per event; the instance that records a change drops its cached answer at once, other instances may capture for up to 60 seconds, and the erasure's confirming pass an hour later removes those events. Opting out queues erasure of events already linked to the account ([Settings and model allowlist](api.md#settings-and-model-allowlist)).

# Beamling — Current Technical Reference

**Status:** describes the code in this checkout, not a roadmap.
**Last verified against the code:** 2026-10-22.
**Scope:** the web application, API, database schema, answer pipeline, browser UI, security controls, tests and local deployment.

Beamling is a hosted, bring-your-own-key answer engine. A visitor signs in with Google, connects an OpenRouter key and a Brave, Tavily or Exa search key, and asks questions in Quick, Deep or Deeper mode. The server searches the web, builds a grounded prompt from the retrieved snippets, streams an OpenRouter answer over SSE, and persists the conversation, sources and usage data.

The application is a single Next.js service plus a small workspace package for the mascot. There is no separate backend, queue, worker or client-side orchestration.

---

## 1. System at a glance

```text
Browser
  │  HTML/CSS/JS from Next.js
  │  JSON + SSE with the account session cookie
  ▼
Next.js 16 application (Node.js runtime)
  ├─ App Router pages: landing, login, welcome (terms acceptance), onboarding, chat, legal pages
  ├─ Google OIDC sign-in and database sessions
  ├─ Route handlers under /api
  ├─ Answer pipeline (Quick / Deep / Deeper)
  ├─ KMS-backed envelope encryption for credentials and content
  └─ PostgreSQL access through pg + Drizzle
       │
       ├─ Google OIDC  discovery + code exchange
       ├─ KMS         wrap/unwrap workspace and credential keys
       ├─ SMTP        service-shutdown notice only (optional)
       ├─ OpenRouter  GET /api/v1/key
       │              POST /api/v1/chat/completions (SSE)
       ├─ Brave       GET /res/v1/web/search
       ├─ Tavily      POST /search
       └─ Exa         POST /search
```

Current external dependencies:

| Dependency | Use |
|---|---|
| PostgreSQL 18 | Accounts, sessions, workspace keys, credentials, usage, conversations, messages, sources, rate limits, provider slots |
| Google OIDC | Account sign-in and verified identity |
| KMS | Wrapping workspace keys and credential data keys; LocalStack locally, GCP Cloud KMS in production |
| OpenRouter | Model validation and streamed chat completions |
| Brave Search API | Web Search validation and retrieval |
| Tavily Search API | Retrieval; key validation through the free usage endpoint |
| Exa Search API | Search validation and retrieval |
| PostHog Cloud EU | Optional server-side, metadata-only product events |
| SMTP relay | Optional; sends only the one-off service-shutdown notice (§14.10) |
| Browser | Session cookie, SSE consumption, UI state |

The server does not fetch result pages, crawl the web or load remote media in answers. Provider traffic goes directly from the Next.js process to OpenRouter and the selected search provider using the user's key. When analytics is explicitly enabled, the server also sends the allowlisted metadata events described in §13.8.

---

## 2. Repository and build

```text
.
├─ packages/web/                  Next.js application
│  ├─ app/                        Pages and route handlers
│  ├─ components/                 React UI
│  ├─ lib/                        Client state, API client, shared types
│  │  ├─ provider-catalog.ts       Client/server-safe provider catalog
│  │  ├─ contracts.ts              Domain enums shared by routes and types
│  │  ├─ stream-events.ts          Shared SSE event union and parser
│  ├─ lib/server/                 Server-only code
│  │  ├─ providers/               OpenRouter, Brave, Tavily, Exa, fixtures
│  │  ├─ repo/                    Database access
│  │  ├─ answer-pipeline.ts       Answer pipeline
│  │  ├─ auth.ts                  Google OIDC flow and account upsert
│  │  ├─ kms.ts                   Env/AWS/GCP KMS adapters
│  │  ├─ workspace-key.ts          Per-account content encryption
│  │  ├─ crypto.ts                 Credential envelope encryption
│  │  ├─ prompts.ts                Prompt assembly
│  │  ├─ shutdown.ts               Scheduled service shutdown: notices and account deletion
│  │  ├─ mail.ts                   SMTP transport for service notices
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
| Email | Nodemailer 10.2.0 (shutdown notice only) |
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
| `AUTH_SECRET` | Exactly 32 bytes, base64 encoded. Root secret for purpose-separated HKDF-SHA256 subkeys: OIDC transaction encryption, IP hashes, credential fingerprints and provider-slot keys. |
| `OIDC_CLIENT_ID` | Google OAuth client id. |
| `OIDC_CLIENT_SECRET` | Google OAuth client secret. |
| `KMS_PROVIDER` | `gcp` in production, `aws` in the local parity stack, `env` only on localhost/tests. |
| `KMS_KEY_NAME` | GCP Cloud KMS key resource name when `KMS_PROVIDER=gcp`. |
| `GCP_KMS_CREDENTIALS` | Optional service-account JSON for hosts without a credentials file. Otherwise the GCP client uses Application Default Credentials. |
| `KMS_KEY_ID` | AWS KMS key id or alias when `KMS_PROVIDER=aws`. |
| `LEGAL_ENTITY` | Controller/operator name shown in the privacy policy, terms and contact page. Required outside localhost. |
| `LEGAL_CONTACT_EMAIL` | Monitored privacy/security/abuse address, also published in `/.well-known/security.txt`. Required outside localhost and must look like an email address. |
| `LEGAL_ADDRESS` | Postal address of the operator shown on the privacy notice, terms and contact page. Required outside localhost. |

Production startup refuses to boot when any of these checks fails:

- `DATABASE_URL` is missing.
- `APP_URL` is missing, malformed, includes a path/query/credentials, or is not HTTPS outside localhost.
- `COOKIE_SECURE=false` outside localhost.
- `TRUSTED_PROXY_HOPS` is missing outside localhost.
- `AUTH_SECRET` is not a valid 32-byte base64 value.
- `OIDC_CLIENT_ID` or `OIDC_CLIENT_SECRET` is missing.
- `OIDC_ISSUER` is not HTTPS outside localhost, or is not `https://accounts.google.com` outside localhost (Google-only alpha).
- `LEGAL_ENTITY`, `LEGAL_ADDRESS` or a valid `LEGAL_CONTACT_EMAIL` is missing outside localhost.
- `LEGAL_LOG_RETENTION_DAYS` or `LEGAL_BACKUP_RETENTION_DAYS` is set outside localhost but is not a positive whole number.
- `SMTP_URL` is set outside localhost but is not a valid `smtp://` or `smtps://` URL, or `MAIL_FROM` or `LEGAL_MAIL_PROVIDER` is missing.
- `SIGNUP_MODE` is set to anything other than `open`, `allowlist` or `paused`.
- `KMS_PROVIDER=env` outside localhost, or the selected KMS key setting is missing.
- `GCP_KMS_CREDENTIALS` is present but is not valid service-account JSON with `client_email` and `private_key`.
- `BEAMLING_FAKE_PROVIDERS=1` outside a localhost `APP_URL`.
- `ANALYTICS_ENABLED` is set to anything other than `true` or `false`.
- Analytics is enabled without `POSTHOG_API_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` or at least 32 bytes of `ANALYTICS_SALT`.
- Any PostHog deletion setting is present but the deletion configuration is incomplete (salt, personal key, project id, hosts).
- The PostHog ingestion or app host is not an HTTPS origin outside localhost, or `POSTHOG_PROJECT_ID` is not numeric. Outside production, plain-HTTP localhost is accepted for a local fake.

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
| `MAX_CONCURRENT_CHATS` | `50` active streams across the database. `fly.toml` sets `30` to leave connection headroom. |
| `MAX_CONCURRENT_CHATS_PER_USER` | `2` active streams for one account, so one user cannot occupy every global slot. |
| `PLATFORM_CONNECTION_LIMIT` | Optional platform connection ceiling (Fly uses `50`); startup warns when `MAX_CONCURRENT_CHATS` is not below it. |
| `LOGINS_PER_IP_PER_HOUR` | `60` OIDC sign-in starts per hashed client IP per fixed hour. |
| `AUTH_CALLBACKS_PER_IP_PER_HOUR` | `120` OIDC callback requests per hashed client IP per fixed hour. |
| `NEW_ACCOUNTS_PER_HOUR` | `200` new accounts across the deployment per fixed hour. Returning users are not counted. |
| `SIGNUPS_PER_IP_PER_HOUR` | `10` new accounts per hashed client IP per fixed hour, as a backstop when registration is open. |
| `SIGNUP_MODE` | `open`, `allowlist` or `paused`; defaults to `open` outside production and `allowlist` in production. |
| `SIGNUP_ALLOWED_EMAILS` | Comma-separated exact addresses for allowlist mode. |
| `SIGNUP_ALLOWED_EMAIL_DOMAINS` | Comma-separated domain suffixes for allowlist mode; an empty allowlist admits nobody. |
| `LEGAL_VAT_ID` | Optional VAT number or company registration, shown next to the operator on the privacy notice, terms and contact page. |
| `LEGAL_LOG_RETENTION_DAYS` | `30`; log retention stated in the privacy notice. Must match the hosting provider's configuration. |
| `LEGAL_BACKUP_RETENTION_DAYS` | `7`; backup and point-in-time-recovery retention stated in the privacy notice. Must match the database provider's configuration. |
| `LEGAL_GOVERNING_LAW` | Governing-law text for the terms; defaults to `Italian law`. |
| `SMTP_URL` | SMTP relay for the shutdown notice: `smtps://user:pass@host:465` (TLS from the first byte) or `smtp://user:pass@host:587` (STARTTLS required; the message is not sent without it). Port defaults to 465/587; 15-second connection timeout. Unset: no email is sent. |
| `MAIL_FROM` | Sender address of the notice. Mail is configured only when both `SMTP_URL` and `MAIL_FROM` are set. |
| `LEGAL_MAIL_PROVIDER` | Name and location of the SMTP provider, e.g. `Brevo (France)`; adds an email row to `/subprocessors`. Required outside localhost when `SMTP_URL` is set. |
| `BRAVE_MIN_INTERVAL_MS` | `1,100` ms between Free-plan Brave requests for the same key across all instances. `0` disables spacing. |
| `BRAVE_PAID_MIN_INTERVAL_MS` | `0`; optional spacing for Paid-plan Brave keys. |
| `BEAMLING_FAKE_PROVIDERS` | `1` uses fixture providers. Honored only when not production, or when production `APP_URL` is localhost. |
| `BEAMLING_FAKE_DELAY_MS` | Overrides fixture delays (defaults vary by call). |
| `ANALYTICS_ENABLED` | Off unless exactly `true`. Set `false` as the kill switch. |
| `POSTHOG_HOST` | Ingestion origin, default `https://eu.i.posthog.com`. |
| `POSTHOG_APP_HOST` | Personal API origin; derived from the EU/US ingestion host or set explicitly for self-hosted PostHog. |
| `POSTHOG_API_KEY` | Project token; required when analytics is enabled. |
| `POSTHOG_PERSONAL_API_KEY` | Personal key with `person:write`, used to delete a person and events on account deletion; required when analytics is enabled. Keep it, with the project id, salt and hosts, after setting the kill switch: deletions keep running while capture is off. |
| `POSTHOG_PROJECT_ID` | Numeric PostHog project id; required when analytics is enabled. |
| `ANALYTICS_SALT` | HMAC-SHA256 salt for the distinct id; at least 32 bytes and required when analytics is enabled. |

Production warnings (logged, not fatal):

- `DATABASE_SSL` is off for a remote database.
- Certificate verification is disabled.
- The database password is the default `beamling`.
- `TRUSTED_PROXY_HOPS=0`.
- `MAX_CONCURRENT_CHATS` is not below `PLATFORM_CONNECTION_LIMIT`.
- `SIGNUP_MODE=allowlist` has no allowed emails or domains; all new sign-ups are paused.
- `SMTP_URL`/`MAIL_FROM` are not set; a service shutdown cannot email its notice.

### 3.3 Fixture providers

With `BEAMLING_FAKE_PROVIDERS=1`:

- Any key starting with `test-` validates.
- Search returns a fixed set of example sources.
- Planner, gap, and answer calls return deterministic fixture content.
- Adding `[fixture:broken-plan]` to a Deep question forces planner fallback.
- `[fixture:bad-plan]` fails the first plan and exercises repair.
- `[fixture:partial-search]` makes one Deep search fail.
- A question containing `no sources` returns no results.

Fixtures exist for automated tests and a fast offline dev loop; no network calls are made to OpenRouter or any search provider in this mode. The production-parity stack leaves them off.

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
  → refuse sign-in after a scheduled shutdown date (SERVICE_CLOSED)
  → upsert user by OIDC subject (new accounts refused while a shutdown is scheduled: SERVICE_CLOSING)
  → ensure settings and workspace data key
  → revoke this browser's previous session, create session, record last_seen_at
  → audit sign_in, clear transaction cookie, redirect
```

Details:

- Users are keyed by the OIDC subject (`google_sub`), with verified email, optional name and avatar URL. The avatar is rendered only from a validated `https://*.googleusercontent.com` URL, with an initial fallback.
- There is no password, magic link, email OTP, other identity provider or account recovery inside Beamling. Recovery is Google's.
- The transaction cookie is a JWE (`dir` + `A256GCM`) encrypted with the `oidc-transaction` HKDF subkey of `AUTH_SECRET`; it expires after 10 minutes.
- The callback is rate-limited by hashed IP (`AUTH_CALLBACKS_PER_IP_PER_HOUR`). The transaction cookie is consumed before the token exchange, so a failed attempt cannot be replayed.
- A first sign-in is checked against `SIGNUP_MODE` and the allowlist/domain lists before the user row is created, then counts against global and per-IP signup buckets. Over the cap, the callback logs a warning and redirects to `/login?error=signups_paused`; an uninvited address gets `signup_not_invited`; a new account during a scheduled shutdown gets `service_closing`; any sign-in after the shutdown date gets `service_closed`; other callback failures redirect to `/login?error=auth_failed`.
- Production requires `OIDC_ISSUER=https://accounts.google.com`; Dex is a local-parity substitute only.
- Session token: 32 random bytes, base64url encoded.
- Stored value: SHA-256 hex of the token. The plaintext token never enters the database.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`; `Max-Age` is the time left until the stored expiry.
- Cookie name: `__Host-beamling_session` when Secure cookies are enabled; `beamling_session` otherwise.
- The session expiry slides forward while the account is used, 30 days (`SESSION_TTL_DAYS`) from the last renewal, but never past 90 days (`SESSION_MAX_AGE_DAYS`) after the session was created. `getCurrentUser` extends it when the new expiry is more than one day beyond the stored expiry, updates `users.last_seen_at` and resets the cookie. A session older than 90 days is rejected even if its stored expiry is later.
- Signing in deletes the session the browser's cookie pointed to before creating the new one, so a sign-in never leaves the previous token valid.
- Missing or expired session on a protected route returns `UNAUTHENTICATED` with HTTP 401.
- `/chat` and `/onboarding` are server-guarded and redirect to `/login` when signed out, and to `/welcome?next=…` when the account has not accepted the current terms (§4.1).
- `POST /api/auth/logout` revokes the current session and clears the cookie. `POST /api/auth/logout?scope=all` revokes every session of the account (Settings → Account → Sign out everywhere).
- `DELETE /api/account` deletes the account, all rows and the wrapped workspace key while queueing the PostHog erasure of the hashed analytics identity in the same transaction, makes a first erasure attempt, clears the cookie, and returns `{ "ok": true }`. See §13.7.
- `GET /api/account/export` returns every stored record of the account as a JSON download (§9.1, §13.7).
- Cleanup removes expired sessions and counters, and deletes accounts with no sign-in or session renewal for 24 months and accounts that never accepted the terms 7 days after creation (§6.6). After a scheduled shutdown date it deletes every account (§6.7).
- `POST /api/auth/test-login` exists only when `BEAMLING_TEST_AUTH=1`, `BEAMLING_FAKE_PROVIDERS=1` and `APP_URL` is localhost. It creates a unique test account for each new request context and is used by Playwright; the account has accepted the current terms unless the request sets `?terms=pending`. Otherwise it returns `NOT_FOUND` (404).

### 4.1 Terms acceptance

- `lib/legal.ts` defines `LEGAL_VERSION` (currently `2026-10-22`), the version of the terms and privacy notice an account must accept, plus `MINIMUM_AGE = 18`, `INACTIVE_ACCOUNT_MONTHS = 24`, `UNACCEPTED_ACCOUNT_DAYS = 7`, `CONVERSATION_RETENTION_DAYS = 60`, `MAX_CONVERSATIONS = 100`, `CONVERSATION_WARNING_THRESHOLD = 90` and `SHUTDOWN_NOTICE_DAYS = 14`.
- `users.terms_version` and `users.terms_accepted_at` record the accepted version. A new account has none.
- App pages call `requirePageUser`, which redirects to `/welcome?next=<path>` when `terms_version` differs from `LEGAL_VERSION`. `/welcome` accepts only `/chat`, `/chat/<uuid>` or `/onboarding` as `next`, and redirects there once the version matches.
- `apiRoute` refuses every API call from such an account with `TERMS_REQUIRED` (403), except routes declared with `requireTerms: false`: `POST /api/account/terms`, `GET /api/account/export`, `POST /api/auth/logout` and `DELETE /api/account`. The browser API client redirects to `/welcome` on `TERMS_REQUIRED`, so a version change while the app is open sends the user to accept it.
- `POST /api/account/terms` requires `{ version, confirmAge: true }`. A version other than `LEGAL_VERSION` returns `TERMS_OUTDATED` (409). Success stores the version and time and logs a `terms_accepted` audit event.
- Changing `LEGAL_VERSION` asks every account to accept again on its next request.

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
| `search` | `tavily` | `GET https://api.tavily.com/usage`; spends no credit and rejects a key whose usage has reached its limit |
| `search` | `exa` | `POST https://api.exa.ai/search` with one highlight result |

Brave and Exa have no free key check, so their validation spends one search request. `POST /api/credentials` accepts `validate: false` for Brave and Exa only (any other provider returns `INVALID_INPUT`) to skip the call: the key is encrypted and saved with `status = unverified` and no `last_validated_at`. The Keys panel and onboarding offer this as a "Validate the key now" checkbox (on by default) for Brave and Exa, and an unverified key shows a Validate button that calls the revalidation endpoint. An unverified key is used for answers like any other; a wrong one fails at the first search.

The API schema accepts OpenRouter as the only LLM provider and Brave, Tavily or Exa as search providers. A credential kind must match its provider (`llm` ↔ `openrouter`, `search` ↔ one launch search provider).

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

- `fingerprint` = first 16 hex characters of HMAC-SHA256(plaintext) keyed with the `credential-fingerprint` HKDF subkey of `AUTH_SECRET`.
- `last4` = last four characters of the plaintext key when the key is at least 20 characters long; shorter keys store `••••` so the hint does not reveal a large part of the key.
- The API returns only id, kind, provider, last4, status, plan/limit metadata and validation time. The plaintext key is never returned after creation.

### 5.3 Validation and status

Creating a credential validates it before saving unless the request sets `validate: false` (§5.1). A validation failure maps to a stable provider error and no row is written.

A saved credential can be revalidated with `POST /api/credentials/:id/validate`:

- The stored key is read with `readCredentialKey` (§5.4). A decryption failure caused by KMS, network or configuration returns `PROVIDER_UNAVAILABLE` (503) and leaves the status unchanged. Only an integrity failure (`isDecryptIntegrityError`: AES-GCM authentication failure, AWS `InvalidCiphertextException` or GCP gRPC `INVALID_ARGUMENT`) sets `status = invalid` and returns `CREDENTIAL_UNREADABLE`.
- Success sets `status = active`.
- A rejected or out-of-credit key sets `status = invalid`.
- A rate-limited key sets `status = rate_limited`.
- Network errors and provider outages leave the existing status unchanged.

Status values exposed to the UI: `active`, `invalid`, `rate_limited`, `unverified`.

Credential operations are rate-limited to 20 per user per fixed hour. Every call that checks a key against its provider (create with validation, revalidate) also consumes the validation budget: 50 per account per fixed day and 120 per hashed client IP per fixed hour. The budget keeps the server from being used to test lists of leaked keys.

### 5.4 Replace, delete, rotation

- Saving a credential validates it before writing.
- The route encrypts the new key first, then updates the existing `(user, kind, provider)` row in place. A KMS or database failure leaves the working credential and its usage history intact.
- Replacing a key keeps the credential id and daily usage. Concurrent replacements cannot rewrite the primary key; a losing different-id insert returns the row the first insert created.
- Fingerprints and Brave provider-slot keys are keyed HMACs, not bare SHA-256, so a database reader cannot test candidate keys offline. Unkeyed legacy fingerprints are no longer recognized.
- Saving and deleting a credential log `credential_saved` / `credential_deleted` audit events (§13.5).
- Deleting a credential hard-deletes the row and its daily usage, and releases the matching Brave slot when the key can be decrypted. There is no recovery.
- Env-adapter master-key rotation:
  1. Deploy a new `CREDENTIAL_MASTER_KEY` with a new `CREDENTIAL_MASTER_KEY_ID`.
  2. Put the old key in `CREDENTIAL_PREVIOUS_MASTER_KEYS`.
  3. Run `node scripts/rewrap-credentials.mjs`.
  4. Remove the old key from the environment only after the script reports that no row still uses it.

The re-wrap script re-wraps both credential data keys (`key_id`, `wrapped_dek`, `dek_nonce`, `dek_tag`) and workspace keys in `user_data_keys` (`key_id`, `wrapped_key`, `wrap_nonce`, `wrap_tag`, `rotated_at`); provider-key ciphertext and content are untouched. It updates a row only while its old wrapped key still matches, so a row replaced or re-wrapped by the application during rotation is skipped. It then counts credentials and workspace keys still under an old master key; if any remain it prints the counts, tells the operator not to remove the old key, and exits with code 1.

For AWS/GCP, unwrap uses the stored `key_id` resource, so a new `KMS_KEY_NAME`/`KMS_KEY_ID` applies to new writes while old rows remain readable. Rows move to the new key lazily:

- Workspace keys are re-wrapped on the next read when the configured KMS key id changes.
- Provider keys are read through `readCredentialKey` (answers and revalidation). When the row's `key_id` differs from `currentKmsKeyId()`, it re-encrypts the key under the current KMS key with the same row id, so usage history stays. The update matches the old `wrapped_dek`, skipping a row replaced in the meantime; a failed re-wrap is ignored and retried on the next read.
- `currentKmsKeyId()` is async. With AWS it resolves `KMS_KEY_ID` to the key ARN once per process with `DescribeKey` (the AWS principal needs `kms:DescribeKey`), so an alias does not cause a re-wrap on every read or after a restart. If the lookup fails, rows are left as they are.

The script itself remains env-adapter only.

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

Content reads fail closed: a non-empty value without the `enc:v1:` envelope is rejected instead of being served as trusted plaintext. The only plaintext values tolerated are the empty string and the fixed synchronous `INTERRUPTED` message.
| Stored provider error messages | AES-256-GCM ciphertext; the fixed `INTERRUPTED` message remains plaintext |
| Usage counters and costs | Plaintext metadata |
| Request logs | Structured JSON; no request bodies or credentials; database parameters are not logged |

Content envelopes are `enc:v1:<base64url JSON>` with nonce, ciphertext, tag and key version. The AAD is `beamling:content:v1:<userId>:<table>:<rowId>:<field>`. Plaintext rows from before this change are still readable: any value without the `enc:v1:` prefix is returned as-is. The workspace key is cached per process (up to 500 accounts) after its first KMS unwrap.

Every account gets a `user_data_keys` row on first sign-in. Deleting the account cascades the wrapped key and content rows. A database-only compromise still yields ciphertext, but the application process can decrypt content for the owning account; this is not end-to-end encryption.

### 5.6 Search-provider limits

- Brave keys require a user-declared plan: `free` or `paid`.
- `free` uses `BRAVE_MIN_INTERVAL_MS` (default 1,100 ms) per key across instances.
- `paid` uses `BRAVE_PAID_MIN_INTERVAL_MS` (default 0).
- Optional `expires_on`, `budget_usd` and `budget_period` (`month` or `total`) are stored as user-declared metadata. The Brave API is not queried for them. Tavily and Exa currently store only the credential and daily request/cost usage; provider-plan metadata is Brave-only.
- `credential_usage` stores daily requests and estimated cost. `listCredentials` sums the current month or all time and exposes `spentUsd`, `requests` and a warning: `budget_100`, `budget_80`, `expiry_1`, `expiry_7` or `expiry_14`.
- A warning never blocks a search. Provider `402` remains authoritative.
- The UI labels the limits as set by the user, not as provider facts.

---

## 6. Conversation and message model

### 6.1 Tables

```text
users
  id, google_sub (unique), email, email_verified, name, avatar_url,
  terms_version, terms_accepted_at, last_seen_at, shutdown_notified_at,
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
  user_id → users (primary key), llm_model, default_search_provider, default_mode,
  analytics_opt_out, updated_at

conversations
  id, user_id → users, title, mode, pinned, created_at, updated_at

messages
  id, conversation_id → conversations, user_id → users,
  role, content, status, mode,
  uncited, no_sources, truncated, degraded,
  searches (encrypted JSON trace), reasoning (encrypted),
  llm_model, resolved_model, upstream_provider,
  search_requests, search_failures,
  search_provider, tokens_in, tokens_out, cost_usd, search_cost_usd,
  latency_ms, error_code, error_message, stop_requested,
  created_at

sources
  id, message_id → messages, position,
  url, title, domain, snippet, published_at

rate_limits
  key (primary key), window_start, count, expires_at

system_flags
  key (primary key), enabled, reason, scheduled_at, updated_at

provider_slots
  key (primary key), next_at

analytics_erasures
  distinct_id (primary key), passes_left, attempts, next_attempt_at, created_at
```

Important indexes and constraints:

- `auth_sessions.token_hash` and `users.google_sub` are unique.
- `credentials(user_id, kind, provider)` is unique.
- `credential_usage(credential_id, day)` is the primary key.
- `conversations(user_id, pinned, updated_at, id)` orders pinned chats first and supports keyset pagination; `conversations(user_id, updated_at, id)` remains for the total count.
- `messages(conversation_id, created_at, id)` supports message pagination.
- A partial unique index allows at most one `messages.status = 'streaming'` row per conversation.
- `sources(message_id, position)` is unique.
- `rate_limits.expires_at`, `provider_slots.next_at`, `analytics_erasures.next_attempt_at` and `users.last_seen_at` are indexed for cleanup.
- `users.terms_version` is the accepted `LEGAL_VERSION` (null until first acceptance); `users.last_seen_at` is set on sign-in and on the daily session renewal; `settings.analytics_opt_out` defaults to `false`; `users.shutdown_notified_at` records when the shutdown notice reached the mail server (null until sent, reset when a shutdown is scheduled).
- `system_flags` holds the database killswitch (§14.8) and the `shutdown` row, whose `scheduled_at` is the closing date (§6.7).
- `conversations.updated_at` is the last activity: it is set by a new exchange and by a mode change, and drives sidebar order, the 100-conversation cap and 60-day expiry (§6.5, §6.6).
- Users cascade to sessions, workspace keys, credentials, settings, conversations, messages and sources.

The migration also creates a `beamling_migrations(filename, checksum, applied_at)` ledger in the migration script. Applied files are checksummed; editing one fails the next migration run. Existing rows without a checksum are baselined on the next run.

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
5. For a Deeper request, count non-stale streaming Deeper messages. If the count is at or above half of `MAX_CONCURRENT_CHATS` (rounded down, at least 1), return `SERVER_BUSY` (503) with copy suggesting Deep.
6. Count the account's non-stale streaming messages against `MAX_CONCURRENT_CHATS_PER_USER`.
7. For a retry, validate that the target is the latest assistant answer, is `error` or `stopped` (or stale-streaming), and that a preceding user question exists. Delete the old assistant row and reuse the original question. No duplicate user message is stored.
8. For a new question, insert the user message with control characters removed.
9. Insert the assistant placeholder with status `streaming`.
10. Update the conversation title (first question only), mode and `updated_at`.

The partial unique index turns a second concurrent answer in one conversation into `GENERATION_IN_PROGRESS` (409). A lock timeout (5 seconds) or an advisory-lock wait timeout maps to `SERVER_BUSY`.

### 6.4 Finishing an answer

`completeAssistant()` runs in one transaction:

1. Update the assistant row with final content, status, flags, usage, cost, resolved model/provider and error fields, scoped to the owner and `status = streaming`. A late completion after a reaper/shutdown marked the row `INTERRUPTED` updates zero rows and is not announced as success.
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
- An account keeps at most 100 conversations (`MAX_CONVERSATIONS`). After `/api/chat` stores a question (so a request that fails earlier, or an empty conversation, never costs an older one), `trimConversations` deletes every other conversation beyond the first 99 in sidebar order (pinned first, then most recently active), so the least recently active unpinned ones go first and pinned ones only when more than 99 are pinned. The asked conversation is never removed. The `meta` event lists the deleted ids in `removed`; the client store drops them from the list, the count and loaded threads. A trim failure is logged and does not block the answer.
- Deleting an account deletes sessions, per-user rate-limit keys and the user row; cascades remove the workspace key, credentials, usage, conversations, messages, sources and settings.

### 6.6 Cleanup

`startServer()` runs cleanup immediately and every 15 minutes:

- Delete retired accounts, at most 50 per run, through the same path as a user deletion (including the queued PostHog erasure), logging an `inactive_account_deleted` audit event for each:
  - accounts whose `last_seen_at` (last sign-in or daily session renewal) is more than 24 months old;
  - accounts created more than 7 days ago that never accepted the terms (`terms_accepted_at` is null).
- Delete conversations whose `updated_at` is more than 60 days old (`CONVERSATION_RETENTION_DAYS`), pinned or not, at most 1,000 per run; messages and sources cascade.
- Delete expired sessions.
- Delete expired rate-limit rows.
- Delete provider slots whose `next_at` is more than one hour in the past.
- Delete empty conversations older than one hour.
- Mark stale streaming answers as `error` / `INTERRUPTED`.
- Run due PostHog erasures (§13.7), up to 20 per run.
- Advance a scheduled shutdown (§6.7).

Each step runs even if another fails; failures are logged. The process continues serving requests if cleanup fails.

### 6.7 Scheduled shutdown

The operator can close the whole service with `POST /api/internal/shutdown` (§9.1, runbook §14.10). State lives in the `system_flags` row `shutdown` (`enabled = true`, `scheduled_at`, optional `reason`, `notify`); deleting the row cancels.

- Scheduling sets `scheduled_at` to now plus `days` (at least `SHUTDOWN_NOTICE_DAYS = 14`, at most 365, default 14) and, in the same transaction, clears every `users.shutdown_notified_at`, so a rescheduled date is announced again.
- While a shutdown is scheduled: new accounts are refused with `SERVICE_CLOSING`; existing users can sign in and export their data; `/chat` shows a banner with the date (Europe/Rome time) and a "Download my data" button that opens Settings → Account; `/login` and `/status` show the date.
- `processShutdown()` runs right after scheduling (when `notify` is true) and from every cleanup tick. It holds a session-scoped Postgres advisory lock on a dedicated connection, so only one instance works at a time (others skip the tick); both steps are idempotent.
  - Before the date it emails the notice to accounts with a null `shutdown_notified_at`, oldest first in batches of 50, 250 ms between messages, marking each account after the SMTP server accepts it. A send failure stops the run; the next tick retries the rest. Nothing is sent when the shutdown was scheduled with `notify: false` (stored in `system_flags.notify`) or without `SMTP_URL`/`MAIL_FROM`.
  - From the date on it deletes every account in batches of 50 through `deleteAccount` (same path as a user deletion, including the queued PostHog erasure), logging a `shutdown_account_deleted` audit event for each.
- After the date every sign-in is refused with `SERVICE_CLOSED`, and `/login` hides the sign-in button.
- The notice is one English plain-text message: closing date (Europe/Rome, with CET/CEST), what is deleted, that provider accounts are unaffected and keys may be revoked, how to download data, the optional operator reason, and the contact address. Beamling sends no other email.

---

## 7. Answer pipeline

### 7.1 Request preparation

`POST /api/chat` validates:

- `mode` is `quick`, `deep` or `deeper`. `searchProvider` is optional and must be `brave`, `tavily` or `exa`; it defaults to the workspace default.
- Exactly one of `question` or `retryOf` is present.
- A retry includes `conversationId`.
- A question is at most 4,000 characters after control characters are removed and whitespace is trimmed.

It then applies:

- 30 chat requests per user per fixed hour.
- 120 chat requests per hashed IP per fixed hour.
- A 64 KB request-body limit.

`prepareChat()`:

1. Loads settings, falling back to the default model if the stored model is no longer allowlisted.
2. Resolves the selected search provider (`searchProvider`, else the workspace default) and loads the OpenRouter and selected search credentials in parallel.
3. Returns `CREDENTIAL_MISSING` for the missing provider; returns `CREDENTIAL_UNREADABLE` when a stored row cannot be decrypted.
4. Reuses the requested conversation after an ownership check, or creates a new conversation.
5. Calls `createExchange()`.
6. Loads the six messages immediately before the current question. These are the prompt's conversation history; the current question is not repeated in that history.

Errors before the SSE response are normal JSON responses with the stable error envelope.

### 7.2 Quick mode

```text
normalized question
  → one search on the selected provider (count 8)
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
- A failed planner/gap model call is ignored; a terminal credential/plan/quota search error is propagated.

### 7.4 Deeper mode

Deeper is an agentic research loop, implemented with AI SDK `ToolLoopAgent` and the official OpenRouter provider. It runs only when the user selects Deeper; Quick and Deep keep their existing pipelines.

```text
question
  → ToolLoopAgent (same selected OpenRouter model)
      tool: search({ queries: string[1..4] })
      → selected provider with concurrency 2, 6 results per query
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
- Search budget is reserved synchronously before launching each query, so parallel tool calls cannot exceed 60. The tool refuses new searches once the budget is exhausted and tells the model to finish.
- A terminal credential/plan/quota error is retained and rethrown instead of being replaced by a generic `SEARCH_FAILED`.
- Every search emits the normal `search` and `progress` SSE events. The final writer uses the existing citation and `truncated` contract.
- Agent output text is not shown as the answer; it only signals that research is complete. A separate synthesis call writes the cited report.
- Research-agent tokens and OpenRouter cost are read from each AI SDK step's `providerMetadata.openrouter` and added to the answer usage.
- Timeout is 360 seconds. A stop, timeout or shutdown keeps partial synthesis text exactly like Deep.

`[fixture:...]` behavior does not apply to Deeper. With `BEAMLING_FAKE_PROVIDERS=1`, Deeper uses three deterministic fixture searches and skips the AI SDK network path.

### 7.5 Retrieval and ranking

The selected adapter receives the normalized query, result count, optional freshness window and caller abort signal. Brave uses its Web Search endpoint; Tavily uses `POST /search` with `search_depth=basic`; Exa uses `POST /search` with `type=auto` and `contents.highlights=true`. None fetches the result pages.

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
- Deltas are forwarded to the SSE client and accumulated in memory. The browser batches React updates to one animation frame instead of re-parsing Markdown per token.
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

Server and client share `lib/stream-events.ts`; the client validates each payload and ignores unknown or malformed events.

| Event | Data | When |
|---|---|---|
| `meta` | `{ conversationId, messageId, userMessageId, removed }` | Before pipeline work; `removed` lists conversations deleted by the 100-conversation cap (§6.5) |
| `stage` | `{ stage, detail? }` | State changes; details are display strings |
| `plan` | `{ queries: string[] }` | Deep only, after planning |
| `progress` | `{ completed, total }` | After each search completes (Quick, Deep and Deeper) |
| `sources` | `Source[]` | Once, before writing |
| `delta` | `{ text }` | Streamed answer text |
| `reasoning` | `{ text }` | Model-provided reasoning, when the provider emits it |
| `citation` | `{ position }` | First time a valid citation appears |
| `usage` | `{ tokensIn, tokensOut, costUsd, searchCostUsd, latencyMs, searchRequests, searchProvider?, resolvedModel?, upstreamProvider? }` | Successful completion (including no sources) |
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
| `POST` | `/api/auth/logout` | Optional, terms not required | `?scope=all` signs out every session | `{ ok: true }` and cleared cookie |
| `GET` | `/api/state` | Required | — | `{ user, conversations, nextCursor, conversationCount, credentials, settings }` |
| `POST` | `/api/chat` | Required | `{ conversationId?, question?, retryOf?, mode, searchProvider? }` | SSE stream |
| `POST` | `/api/chat/stop` | Required | `{ messageId }` | `{ stopped: boolean }` |
| `GET` | `/api/conversations` | Required | `?cursor=` | `{ conversations, nextCursor }` |
| `POST` | `/api/conversations` | Required | `{ mode?: "quick" \| "deep" \| "deeper" }` | `201 { conversation }`; the 100-conversation cap is applied when its first question is stored (§6.5) |
| `GET` | `/api/conversations/:id` | Required | UUID id | `{ conversation }` with newest 60 messages |
| `GET` | `/api/conversations/:id/messages` | Required | `?before=<messageId>` | `{ messages, hasMore }` |
| `PATCH` | `/api/conversations/:id` | Required | `{ mode?, pinned? }` (at least one) | `{ conversation }` |
| `DELETE` | `/api/conversations/:id` | Required | — | `{ ok: true }` |
| `POST` | `/api/credentials/:id/validate` | Required | — | `{ credential }` |
| `PATCH` | `/api/credentials/:id` | Required | `{ plan?, expiresOn?, budgetUsd?, budgetPeriod? }` | `{ credential }` |
| `DELETE` | `/api/credentials/:id` | Required | — | `{ ok: true }` |
| `PATCH` | `/api/settings` | Required | `{ llmModel?, defaultSearchProvider?, defaultMode?, analyticsOptOut? }` | `{ settings }` |
| `POST` | `/api/account/terms` | Required, terms not required | `{ version, confirmAge: true }` | `{ ok: true, version }` |
| `GET` | `/api/account/export` | Required, terms not required | — | JSON attachment `beamling-export-<date>.json` |
| `DELETE` | `/api/account` | Optional, terms not required | — | `{ ok: true }` and cleared cookie |
| `POST` | `/api/internal/kill` | Bearer `KILL_SWITCH_SECRET` | `{ acceptingNewStreams: boolean, reason? }` | `{ acceptingNewStreams }` |
| `GET` | `/api/internal/metrics` | Bearer `METRICS_SECRET` | — | Deployment flag, active streams and build identity |
| `GET` | `/api/internal/shutdown` | Bearer `KILL_SWITCH_SECRET` | — | `{ shutdown: { scheduledAt, reason } \| null, mailConfigured, accounts, notified }` |
| `POST` | `/api/internal/shutdown` | Bearer `KILL_SWITCH_SECRET` | `{ action: "schedule", days?: 14–365 (default 14), reason?: ≤1,000 chars, notify?: boolean (default true) }` or `{ action: "cancel" }` | Same as `GET`; `MAIL_NOT_CONFIGURED` (409) when `notify` is true without SMTP. See §6.7 |
| `GET` | `/api/health` | None | — | `{ ok: true, database: "up", version, commit, builtAt }` or 503 `{ ok: false, database: "down", version, commit, builtAt }` |
| `GET` | `/.well-known/security.txt` | None | — | RFC 9116 text: `Contact` (mailto `LEGAL_CONTACT_EMAIL` when set, and `/contact`), `Expires` 180 days ahead, `Policy` `/security`, `Canonical`, `Preferred-Languages: en`; `Cache-Control: public, max-age=86400` |

`apiRoute` wraps every session route. After the same-origin check and session load, it refuses an account whose `terms_version` is not the current `LEGAL_VERSION` with `TERMS_REQUIRED` (403), unless the route is declared `requireTerms: false` (§4.1).

The export contains `format: "beamling-export"`, `version: 1`, `exportedAt`, the account (id, Google subject, email, name, avatar URL, timestamps, `lastSeenAt`, accepted and current terms version), settings, credential metadata as returned by the Keys API, sessions (creation and expiry only), and every conversation with its decrypted messages and sources, oldest first. Provider keys, key ciphertext and session tokens are never included.

### 9.2 Validation and limits

| Route group | Limit |
|---|---|
| `POST /api/chat` | 30 per user/hour; 120 per hashed IP/hour |
| `POST /api/conversations` | 120 per user/hour |
| `POST /api/credentials` and credential validation | 20 per user/hour |
| Provider key checks (validated create, revalidate) | 50 per user/day; 120 per hashed IP/hour |
| `GET /api/account/export` | 5 per user/hour |
| All authenticated mutations (non-GET/HEAD) | 300 per user/10 min, in addition to route limits |
| All authenticated `GET` routes | 600 per user/10 min; 3,000 per hashed IP/10 min |
| Login start | 60 per hashed IP/hour |
| New accounts | `NEW_ACCOUNTS_PER_HOUR` across the deployment, default 200/hour |
| Request body | 64 KB |
| Question | 4,000 characters after control-character cleanup |
| Global active streams | `MAX_CONCURRENT_CHATS`, default 50 |

All rate limits are fixed-window counters in PostgreSQL, updated atomically. A request over the limit gets `RATE_LIMITED` (429). They are not sliding windows and they do not use Redis.

### 9.3 Same-origin and CSRF behavior

- Any non-GET/HEAD request runs `assertSameOrigin`.
- A `Sec-Fetch-Site` header with any value other than `same-origin` or `none` is rejected with `INVALID_ORIGIN` (403).
- If an `Origin` header is present, its full origin must equal `APP_URL`. Proxy and `Host` headers are never used as the expected origin.
- No `Origin` and no `Sec-Fetch-Site` header (non-browser clients) means the check passes; the session cookie is `SameSite=Lax`, so a cross-site POST does not carry it.
- There is no CSRF token; session cookies are `SameSite=Lax` and mutations require same-origin fetch metadata and `Origin` when present.
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
{ "llmModel": "anthropic/claude-haiku-4.5", "defaultSearchProvider": "tavily", "defaultMode": "deep" }
```

`llmModel` must be one of:

- `deepseek/deepseek-v4.1-flash` (default)
- `anthropic/claude-sonnet-4.5`
- `anthropic/claude-haiku-4.5`
- `openai/gpt-5.2`
- `google/gemini-3.8-flash`

An unknown model returns `MODEL_NOT_ALLOWED`; an unknown search provider returns `INVALID_INPUT`. `defaultMode` is `quick`, `deep` or `deeper`.

`analyticsOptOut` (boolean) records the account's objection to product analytics through its own path (`setAnalyticsOptOut`). Opting out, in one transaction, sets `settings.analytics_opt_out` and queues PostHog erasure of the account's distinct id in `analytics_erasures`; the route then makes a first erasure attempt. Opting back in clears the flag but leaves a pending erasure in place; capture resumes once it has finished. The whole patch is validated before anything is written, so a rejected request changes nothing. Both log an audit event (`analytics_opt_out` / `analytics_opt_in`). See §13.8.

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
| `INVALID_ORIGIN` | Cross-origin mutation (`Origin` or `Sec-Fetch-Site`) | 403 |
| `TERMS_REQUIRED` | Account has not accepted the current `LEGAL_VERSION` | 403 |
| `TERMS_OUTDATED` | `POST /api/account/terms` with a version other than the current one | 409 |
| `INVALID_PROVIDER` | Kind/provider mismatch | 400 |
| `MODEL_NOT_ALLOWED` | Model outside allowlist | 400 |
| `CREDENTIAL_MISSING` | No key for OpenRouter or the selected search provider | 400 |
| `CREDENTIAL_INVALID` | Provider rejected key | 400 |
| `CREDENTIAL_UNREADABLE` | Stored key cannot be decrypted | 400 |
| `INSUFFICIENT_CREDITS` | OpenRouter or search provider `402` | 402 |
| `MODEL_NOT_FOUND` | OpenRouter `404` | 400 |
| `BRAVE_PLAN_MISSING_SEARCH` | Brave key has no Search plan | 400 |
| `SEARCH_PLAN_MISSING` | Tavily key has no Search access (`432`) | 400 |
| `QUOTA_EXCEEDED` | Tavily plan limit reached (`433`) | 402 |
| `PROVIDER_RATE_LIMITED` | OpenRouter or the selected search provider `429` | 429 |
| `PROVIDER_UNAVAILABLE` | Timeout, network failure or provider `5xx` (502); KMS or transport failure while reading a key for revalidation (503) | 502 / 503 |
| `SERVICE_BUSY` | The operator killswitch stopped new streams | 503 |
| `PROVIDER_ERROR` | Other provider rejection | 502 |
| `SEARCH_FAILED` | Every search failed | 502 |
| `CONTEXT_TOO_LARGE` | OpenRouter says context is too long | 400 |
| `GENERATION_IN_PROGRESS` | Another stream owns the conversation | 409 |
| `SERVER_BUSY` | Global, Deeper or per-account stream cap, or lock timeout | 503 |
| `RETRY_NOT_ALLOWED` | Retrying a non-latest or non-failed answer | 409 |
| `RATE_LIMITED` | Beamling rate limit | 429 |
| `SIGNUPS_PAUSED` | Hourly new-account cap reached (callback redirects to `/login?error=signups_paused`) | 429 |
| `SERVICE_CLOSING` | New account while a shutdown is scheduled (callback redirects to `/login?error=service_closing`) | 403 |
| `SERVICE_CLOSED` | Sign-in after the shutdown date (callback redirects to `/login?error=service_closed`) | 403 |
| `MAIL_NOT_CONFIGURED` | Shutdown scheduled with `notify: true` but `SMTP_URL`/`MAIL_FROM` are unset | 409 |
| `NOT_FOUND` / `CONVERSATION_NOT_FOUND` / `MESSAGE_NOT_FOUND` | Missing or not owned | 404 |
| `INTERNAL` | Unhandled error | 500 |
| `INTERRUPTED` | Stored when a stream is abandoned | — |
| `GENERATION_TIMEOUT` | Stored when the time limit is reached | — |

The UI maps `CREDENTIAL_MISSING`, `CREDENTIAL_INVALID`, `CREDENTIAL_UNREADABLE`, `BRAVE_PLAN_MISSING_SEARCH` and `MODEL_NOT_FOUND` to Settings; `UNAUTHENTICATED` to sign-in; `TERMS_REQUIRED` to `/welcome`; most provider failures to retry. `GENERATION_TIMEOUT` and `INTERRUPTED` appear on the stopped/error answer card.

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

### 11.3 Tavily

Retrieval uses `POST https://api.tavily.com/search` with `Authorization: Bearer <key>`. The adapter never requests raw page content, images or a generated answer.

- Validation calls `GET https://api.tavily.com/usage` with the same header, which reports credits without spending one. `401` maps to `CREDENTIAL_INVALID`; a `key.usage` at or above a non-null `key.limit` maps to `QUOTA_EXCEEDED`.
- Retrieval uses `search_depth=basic`, `max_results=1–20`, `include_published_date=true`, `safe_search=true`, and `topic=news` only for a recent-information question.
- A freshness window maps to `time_range`: `day`, `week`, `month` or `year`.
- Results map `title`, `url`, `content` and `published_date`; `content` is tag-stripped and capped at 1,800 characters. Results without a usable snippet are dropped.
- Every successful request records one request and the `$0.008` list-price estimate in `credential_usage`.

| Status | Beamling code |
|---|---|
| `401`, `403` | `CREDENTIAL_INVALID` |
| `432` | `SEARCH_PLAN_MISSING` |
| `433` | `QUOTA_EXCEEDED` |
| `402` | `INSUFFICIENT_CREDITS` |
| `429` | `PROVIDER_RATE_LIMITED` |
| `408`, `5xx` | `PROVIDER_UNAVAILABLE` |
| Other `4xx` | `PROVIDER_ERROR` |

A `429` is retried once with the same short-wait policy as Brave.

### 11.4 Exa

Validation and retrieval use `POST https://api.exa.ai/search` with `x-api-key: <key>`.

- Validation sends a short probe with `numResults=1`, `type="auto"` and `contents={"highlights":true}`.
- Retrieval uses `type="auto"`, `numResults=1–100`, `moderation=true` and `contents.highlights=true`.
- A freshness window maps to `startPublishedDate`; the adapter never requests full page text or a summary.
- Results map `title`, `url`, `publishedDate` and the joined `highlights` array. Highlights are tag-stripped and capped at 1,800 characters. Results without a usable highlight are dropped.
- Every successful request records one request and the `$0.005` list-price estimate in `credential_usage`.

| Status | Beamling code |
|---|---|
| `401`, `403` | `CREDENTIAL_INVALID` |
| `402` | `INSUFFICIENT_CREDITS` |
| `429` | `PROVIDER_RATE_LIMITED` |
| `408`, `5xx` | `PROVIDER_UNAVAILABLE` |
| Other `4xx` | `PROVIDER_ERROR` |

A `429` is retried once with the same short-wait policy as Brave.

### 11.5 Fixtures

`lib/server/providers/fake.ts` mirrors the `chat`, `search` and validation interfaces. It is selected by `isFakeProviders()` and is used by local tests and Playwright. Fixture content is deterministic, with marker-based failure modes for planner repair, plan failure, partial search and no-source behavior.

---

## 12. Browser application

### 12.1 Routes and pages

| Route | Current behavior |
|---|---|
| `/` | Public cinematic landing page with a scripted demo, feature cards, provider list, CTA to `/onboarding` or `/chat`, and the full legal footer |
| `/login` | Google-only sign-in page; redirects to `/onboarding` or `/chat` after the callback. Sign-in start failures redirect back with `auth_unavailable` or `login_rate_limited` instead of returning JSON. Copy says the Terms and Privacy notice are accepted after sign-in and that Beamling is for people aged 18 and over. While a shutdown is scheduled it shows the closing date and that new accounts are no longer accepted; after the date it says Beamling has shut down and hides the sign-in button. `service_closing` and `service_closed` errors have their own copy. |
| `/welcome` | Terms acceptance step (§4.1), not indexed. Signed-out visitors go to `/login`; accounts already on the current version go to `next`. Shows "Before you start" for a new account or "Updated terms" after a version change, three short points (AI-generated answers, the user's responsibility for provider keys and costs, encryption/export/deletion), an "I am at least 18" checkbox and an "I accept the Terms and have read the Privacy notice" checkbox, Accept and Sign out buttons, and a note that accounts that never accept are deleted after seven days. |
| `/onboarding` | Account setup form: OpenRouter key, default model, search-provider picker and provider key, plus Brave plan/expiry/budget when Brave is selected; validates and saves, then routes to `/chat` |
| `/chat` | New-question view; loads workspace state, conversation list and threads. While a shutdown is scheduled, the layout shows an alert banner above the app with the closing date and a "Download my data" button that opens Settings → Account |
| `/chat/[id]` | Conversation view; loads the newest 60 messages and supports earlier-message pagination |
| `/privacy` | Privacy notice (Art. 13/14 GDPR): controller with address and optional VAT id, no DPO; data categories with legal basis (account, acceptance record, session, content, credentials, usage, hashed-IP security metadata, logs, optional analytics with opt-out); Google account used to email essential service notices (no newsletters or marketing); Google account required; no solely automated decisions; not for under-18s; provider traffic under the user's own accounts; essential cookies only; retention list (conversations 60 days after their last question, pinned or not, at most 100 per account with the least recently used unpinned ones deleted first; account data until deletion; inactive accounts after 24 months, unaccepted accounts after 7 days, sessions 30 days idle / 90 days max, hashed IPs and counters up to one hour, logs `LEGAL_LOG_RETENTION_DAYS`, backups `LEGAL_BACKUP_RETENTION_DAYS`, analytics until opt-out or deletion; everything on the closing date if the service closes, announced at least 14 days ahead by email and in the interface); recipients and transfers (Frankfurt hosting, EU-US Data Privacy Framework or SCCs); rights under Art. 15–21 with the self-service Settings controls, one-month answer and the Garante complaint route; re-acceptance on material changes |
| `/terms` | Alpha terms: operator identity, free service, 18+ (or local age of majority), acceptance on first use and on material change, user responsibility for provider keys and costs, data loss and export, storage limits (60-day conversation expiry, 100 conversations per account, warning near the cap), acceptable use (illegal content, harassment, IP and privacy infringement, malware, EU AI Act Art. 5 practices, professional advice, foreign keys, scraping, resale), AI-generated answers, content ownership and MIT-licensed source (name and logo not licensed), as-is availability without affecting consumer rights, liability limits that never exclude wilful misconduct or gross negligence (Art. 1229 Italian Civil Code) or Consumer Code liability, suspension with notice and a chance to export, 24-month inactive deletion, closure of the service with at least 14 days' notice by email and in the interface (no new accounts meanwhile, export still possible, every account deleted on the date), email only for essential service notices, DSA reports and contact point, `LEGAL_GOVERNING_LAW` with consumer forum (Art. 66-bis Consumer Code) |
| `/cookies` | Essential-cookie table (session: 30 days without use, at most 90 days after sign-in); no analytics or advertising cookies |
| `/subprocessors` | "Data processors" page in two tables with purpose, location and privacy-policy link: processors that run Beamling under a DPA (Fly.io, Neon, Google Cloud KMS, optional PostHog Cloud, and an email row named by `LEGAL_MAIL_PROVIDER` when set) and providers the user chooses with their own account (Google sign-in, OpenRouter, Brave, Tavily, Exa) |
| `/security` | Security controls, session lifetime, audit events, `security.txt` link and a vulnerability-disclosure policy with a good-faith safe harbor |
| `/contact` | Operator identity, address and optional VAT id; monitored privacy/security/abuse contact; DSA single point of contact (Art. 11–12, English) and how to report illegal content |
| `/status` | Human-readable readiness for the app, database, schema and KMS; a scheduled shutdown date (or that the service has shut down) above it |
| `/licenses` | States that Beamling is open source under the MIT License with a link to the source repository, then the generated third-party inventory from `packages/web/lib/generated/licenses.json`, with notices, license texts and the shared legal footer |
| `/.well-known/security.txt` | RFC 9116 security contact (§9.1) |
| `/api/health` | Cached readiness: database, schema and KMS |
| `/api/live` | DB-free liveness probe |
| `/robots.txt` | Allows `/`, disallows `/chat`, `/onboarding`, `/api/` |

The Next.js metadata base and the landing demo host are derived from `APP_URL`, so metadata, canonical URLs and the visible demo follow the deployed origin.

Legal pages read the operator details from `legalDetails()` and the dates from `LEGAL_LAST_UPDATED`. The source repository URL is `SOURCE_URL` in `lib/legal.ts`.

### 12.2 Client state

`StoreProvider` owns the account:

- Loads `/api/state` on mount; a 401 redirects to `/login`. Any API response with `TERMS_REQUIRED` replaces the page with `/welcome?next=<current path>`.
- Keeps user, conversation summaries, conversation count, settings, credentials and per-conversation thread state.
- Loads a thread lazily when a conversation route mounts.
- Merges a refreshed newest page with earlier pages already loaded, dropping provisional copies and preserving local failures.
- Uses request sequence numbers so a slow older response cannot overwrite a newer one.
- Tracks conversations created or deleted during an in-flight refresh.
- The sidebar renders a skeleton until the first `/api/state` resolves and shows an inline retry when a later refresh fails, instead of briefly claiming there are no conversations.
- The topbar and Account panel use the same initial/avatar component. Google profile pictures are rendered only from a validated `https://*.googleusercontent.com` URL.
- Streaming deltas are batched per animation frame before updating the live answer.
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
- Requires a key for the selected search provider if none is stored.
- The user can switch the selected provider before adding its key.
- Brave requires a plan (`Free · 1 request/second` or `Paid / provider plan`) and accepts optional expiry and monthly budget. All three are user-declared.
- “Get a key” links open the provider dashboards in a new tab.
- Keys are masked inputs with show/hide toggles.
- Saving validates each key through the server; a failure keeps the form open with provider copy.
- The user can choose one of the five allowlisted models; the selection is saved only if it differs from the current default.
- If a key is already connected, the field can replace it.
- Once both keys exist, “Start asking” routes to `/chat`; the default model and search provider are preserved.

### 12.4 Chat view

- Header: conversation title, mode, selected model name, selected search-provider label, source-count button, account avatar.
- Answer cards show **Searches** (query, status, result count) and **Model reasoning** as `<details>` panels, collapsed by default. The same panels appear live while the answer streams.
- Sidebar: title search over loaded pages, a Pinned section, Today/Yesterday/Previous groups in UTC, exact-title links, per-conversation pin/unpin and delete confirmation, “Show older conversations” pagination, a retention note ("Chats are deleted 60 days after their last message"), which from 90 conversations also shows "N of 100 chats. New chats replace the oldest unpinned ones." as a highlighted status, Settings entry, signed-in email and sign-out.
- Thread: user bubbles, answer cards, a working answer card, earlier-message button, empty state, not-found state, load-error state.
- Composer: auto-growing textarea up to 190 px, Enter sends, Shift+Enter inserts a newline, Quick/Deep/Deeper segmented control, model badge, search-provider selector and Stop button while busy. Providers without a saved key are listed as "· no key". The hint under the composer reads "Answers are AI-generated with your keys and can be wrong — check the sources." Sending is not blocked on the client, whose credential list can be stale; the server's `CREDENTIAL_MISSING` shows the "Key needed" card.
- Source panel: desktop right-hand pane; mobile bottom sheet with focus trap; source count, provider badge, title/domain/date/snippet/link. The badge comes from the answer’s stored provider.
- Tables render with a header, alignment and horizontal scrolling; the parser also handles headings, lists, quotes, code fences, links and citations.
- Answer card: streamed markdown, citation buttons, an "AI-generated" badge, model/search-provider/resolved-provider badges, usage line, copy button, sources button, stopped/error/uncited/no-sources/truncated/degraded/partial-search notices, retry button for the latest failed or stopped answer.
- Working answer: mascot, stage label, real detail string, skeleton or streaming body, Stop button.
- Stop: the composer switches to a stop control; the client asks the server to stop, waits for confirmation, and keeps the partial answer.

Markdown support is intentionally small:

- Headings `##`–`####`, paragraphs, unordered/ordered lists, blockquotes, horizontal rules and fenced code.
- GitHub-style tables: header row, delimiter row, left/center/right alignment, inline formatting in cells and horizontal scrolling.
- Inline code, bold, italics, and links. Raw HTML is not parsed.
- Links must be `http:` or `https:` **and** exactly match a URL in the answer's retrieved sources; model-chosen links render as plain label text. This blocks model-authored phishing links while keeping cited sources clickable.
- `[n]` renders as a citation button only when `n` is within the answer's source count; otherwise it stays as text.
- Citation clicks use event delegation to a `data-citation` attribute.

### 12.5 Settings and account

Settings is a modal with three keyboard-navigable tabs:

| Tab | Behavior |
|---|---|
| Keys | Add/replace/validate/delete OpenRouter, Brave, Tavily and Exa credentials; optional save without validation for Brave and Exa; masked last four, status, Brave plan, declared expiry/budget, estimated spend and warnings; edit Brave limits |
| Defaults | Default mode (Quick/Deep/Deeper), OpenRouter model select, default search provider (Brave/Tavily/Exa) |
| Account | Google name/email, conversation and credential counts, session explanation (30 days without use, 90 days after sign-in), sign out, sign out everywhere; "Your data" card with **Download my data** (`GET /api/account/export`) and an **Exclude me from product analytics** checkbox (`PATCH /api/settings { analyticsOptOut }`); delete account with typed `DELETE`; link to the accepted terms and privacy notice |

Deleting the account hard-deletes server data and the wrapped workspace key, clears the client store and session cookie, and routes to `/`.

### 12.6 Landing page

The root page is static marketing content rendered per request so the CSP nonce can be injected:

- Dark brand theme, Inter and JetBrains Mono.
- Hero and mascot.
- A scripted, replayable demo that cycles through queued/searching/reading/writing/done; it is not a live provider call.
- Stats, three-step explanation, three feature cards, provider pills.
- Footer with Privacy, Terms, Cookies, Data processors, Security, Status, Contact and Licenses, “Keys encrypted at rest” and “No training by Beamling.”
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
- The E2E suite runs axe-core on `/`, `/chat`, `/onboarding`, `/welcome`, `/privacy`, `/terms`, `/licenses`, `/cookies`, `/subprocessors`, `/security`, `/status` and `/contact` and fails on serious or critical violations.

---

## 13. Security controls

### 13.1 Browser and HTTP

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
- API responses carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
- Global headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster: ?1`, `X-Permitted-Cross-Domain-Policies: none`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`, and HSTS. Production CSP adds `upgrade-insecure-requests`.
- `poweredByHeader` is disabled.
- Authenticated API responses are private and vary on Cookie.
- Mutations reject a cross-site `Sec-Fetch-Site` and check Origin when present against the configured `APP_URL` origin, never a client-supplied host. The session cookie is HttpOnly and SameSite=Lax.
- OIDC login uses state, nonce and PKCE; the callback rejects replayed or expired transaction cookies.
- The session cookie uses the `__Host-` prefix when Secure is enabled, which requires host-only scope, path `/`, and Secure.
- Sessions have a 30-day idle expiry and a 90-day absolute lifetime; signing in revokes the browser's previous session (§4).

### 13.2 Input and output

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

### 13.3 Provider-key handling

- Keys are never logged, stored in browser state, or returned after creation.
- Only encrypted rows, a keyed fingerprint and the last four characters (only for keys of at least 20 characters) are stored.
- Key checks against providers are capped per account per day and per IP per hour (§5.3).
- Decryption is scoped to the authenticated user's row and AAD.
- The provider key is held in memory only for the request that needs it.
- The KMS adapter is selected by `KMS_PROVIDER`; production refuses to boot without the configured KMS key.
- The env adapter and re-wrap script are for local tests only.

### 13.4 Rate limiting and concurrency

- Fixed-window counters in `rate_limits` use one atomic insert-or-update.
- Login starts, chat, conversation creation, credentials, key validation, exports, reads and writes have separate keys and limits. Every authenticated mutation counts against a global 300 per user per 10 minutes.
- IP keys are keyed-HMACed with a subkey derived from `AUTH_SECRET`; raw addresses are not stored and a database dump cannot enumerate them.
- The global stream cap is enforced inside a transaction-scoped advisory lock and counts committed streaming rows across all instances. A per-account cap (`MAX_CONCURRENT_CHATS_PER_USER`, default 2) prevents one account from occupying every slot, and Deeper answers may hold at most half of the global slots.
- Signup enforcement is `open`, `allowlist` or `paused`; production defaults to allowlist, and open mode also has per-IP and global buckets.
- Rate-limit windows, stale-stream detection and cleanup use PostgreSQL time where the decision is shared across instances.
- A second stream in one conversation is blocked by a partial unique index, not by process memory.
- Brave request spacing uses a per-key database slot, so multiple instances cannot exceed the configured interval.
- DELETE conversation/account aborts local streams and leaves other instances to observe the missing/non-streaming row through their stop poll.

### 13.5 Logging and error handling

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
| `inactive_account_deleted` | Cleanup (§6.6) | — |
| `shutdown_scheduled` | `POST /api/internal/shutdown` | `scheduledAt` |
| `shutdown_cancelled` | `POST /api/internal/shutdown` | — |
| `shutdown_account_deleted` | Shutdown run after the closing date (§6.7) | — |
| `internal_auth_failed` | Kill, metrics or shutdown endpoint with a wrong or missing bearer | `endpoint` |

### 13.6 Supply chain and release checks

- CI runs `pnpm audit --prod --audit-level high` and a Gitleaks history scan on every push and pull request.
- GitHub Actions are pinned to full commit SHAs, the CI PostgreSQL service image is pinned to a digest, and the runtime base image is pinned to a multi-arch digest. `actions/checkout` runs with `persist-credentials: false` in the test and deploy jobs, so the token is not left in `.git/config` while tests, the build and Playwright run third-party code. Dependency install uses `--ignore-scripts`; the mascot package build is explicit.
- The release job records the pushed GHCR digest; deploy uses that digest and verifies `/api/health` afterward.
- Dependabot checks npm, GitHub Actions and Docker weekly.
- The built image is scanned separately; the current image has no HIGH, CRITICAL or MEDIUM findings after removing the npm/corepack trees and applying Alpine security updates.
- `pnpm audit` still reports two development-only tooling advisories (`braces` via ESLint, `esbuild` via drizzle-kit). Neither is in the runtime image.

### 13.7 Data deletion

- Deleting a conversation cascades to messages and sources.
- Deleting an account cascades to sessions, the workspace data key, credentials, usage, settings, conversations, messages and sources, and removes the user's rate-limit keys.
- Local active chats are aborted; remote instances stop on the next poll.
- The cleanup job removes expired sessions, counters, stale provider slots, empty conversations older than one hour and conversations inactive for 60 days, and deletes accounts unused for 24 months or never accepted after 7 days (§6.6).
- Creating a conversation beyond 100 deletes the least recently active unpinned ones (§6.5).
- After a scheduled shutdown date every account is deleted through the same path as a user deletion (§6.7).
- `GET /api/account/export` gives the user a full JSON copy of their stored data (Art. 15 and 20 GDPR) without provider keys or session tokens (§9.1).
- There is no soft-delete or recovery path.
- When PostHog deletion is configured, account deletion also erases the PostHog person through a durable queue in `analytics_erasures`, which holds only the HMAC distinct id. Deletion settings do not depend on `ANALYTICS_ENABLED` or the ingestion token; a partial deletion configuration is a production boot error.
  - The row and the account deletion commit in one transaction, so a failed deletion does not erase a live account's analytics and a successful deletion cannot lose the erasure.
  - The first attempt runs in the deletion request; the cleanup job runs the rest. Rows are claimed with `FOR UPDATE SKIP LOCKED` and hidden for 5 minutes, so instances never run the same row at once.
  - A failure retries with exponential backoff from 5 minutes, capped at 24 hours, and is never dropped. From the fifth failed attempt each failure is logged as an error (`PostHog erasure keeps failing`) with only an 8-character prefix of the distinct id.
  - A success schedules one confirming pass an hour later, which catches events that were still in flight when the account was deleted. The row is deleted after the second success.
  - Deletion uses its own configuration, so it keeps running behind the `ANALYTICS_ENABLED=false` kill switch as long as the PostHog variables stay set.

### 13.8 Analytics privacy

Analytics is disabled unless `ANALYTICS_ENABLED=true` and the full PostHog configuration is present. It is server-side only: the browser loads no PostHog SDK and there is no autocapture, session replay, heatmap, survey or feature flag.

- `lib/server/analytics.ts` owns the event map, property allowlist, HMAC identity, timeout, in-flight cap and deletion call. The client is kept on `globalThis`, so the shutdown hook (bundled separately from the route handlers) flushes the same in-flight set the routes fill. `lib/server/analytics-erasure.ts` runs the erasure queue.
- `distinctId = HMAC-SHA256(userId, ANALYTICS_SALT)` truncated to 32 hex characters. Raw user ids, email addresses, session tokens and IP addresses are never sent. Keep the salt stable for the life of the PostHog project; rotating it orphans existing events and makes deletion by the new hash incomplete.
- Every payload is rebuilt from the allowlist, so unknown keys and non-scalar values are dropped even if a caller passes them accidentally.
- `$geoip_disable` is true and `$ip` is `0.0.0.0`.
- Events are best-effort: at most eight requests are in flight, each has a 2-second timeout, failures are dropped and logged without payloads, and there are no retries that block a request.
- Erasure calls PostHog's `bulk_delete` endpoint with `delete_events` and `delete_recordings`; a non-2xx response or any `deletion_errors` counts as a failure. The personal key and project id never enter the browser.
- Local and test environments remain silent because the flag is opt-in. Production refuses to start with an incomplete enabled configuration.
- Per-account objection: before sending, `capture` asks `analyticsExcluded`, which is true when `settings.analytics_opt_out` is set or an `analytics_erasures` row is pending for the account's distinct id, and drops the event. A failing check also drops the event. The answer is cached per process for 60 seconds (at most 10,000 accounts) so analytics adds no query per event; the instance that records a change drops its cached answer at once, other instances may capture for up to 60 seconds, and the erasure's confirming pass an hour later removes those events. Opting out queues erasure of events already linked to the account (§9.5).

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
# test@beamling.local / beamling, then add real OpenRouter and Brave/Tavily/Exa keys.
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

- `0000_init.sql` contains the complete pre-launch schema. There is no deployed database yet, so schema changes regenerate it instead of adding migrations.
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

- `/api/live` is a DB-free liveness probe returning `{ "ok": true }`.
- `/api/health` is cached readiness for five seconds: database `select 1`, the `beamling_migrations` table, and a KMS wrap/unwrap probe.
- Healthy: 200 `{ "ok": true, "database": "up", "schema": "up", "kms": "up", "version": "0.2.0", "commit": "...", "builtAt": "..." }`.
- Unhealthy: 503 with the failing component marked `down`; no error details are exposed.
- No authentication and no cache headers. `/status` renders the same readiness state for people.
- On `SIGTERM` or `SIGINT`, if `NEXT_MANUAL_SIG_HANDLE` is set, the process sets a global shutdown flag, rejects new `/api/chat` requests, aborts active chats, loops over late registrations, waits up to 8 seconds for outcomes, marks leftovers interrupted, closes the pg pool and exits.
- The Docker Compose grace period is 15 seconds.

### 14.5 Versioning and releases

- The root `package.json` version is the single source of truth; the web and mascot packages are kept in sync.
- `pnpm version` prints it, `pnpm version:set 0.2.0` updates all three package files, and `pnpm version:check v0.2.0` rejects a mismatched tag.
- `next.config.ts` injects `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_GIT_COMMIT` and `NEXT_PUBLIC_BUILD_TIME` at build time. `/api/health`, the landing footer and the sidebar show the same identity.
- On a green push to `main`, CI creates the annotated tag `v<version>` if it does not exist, builds the production image, pushes `ghcr.io/<repo>:v<version>` and `:latest`, records the registry digest and creates a GitHub release with generated notes.
- The deploy job deploys that digest with `flyctl deploy --image`, not a second source build, and runs a post-deploy `/api/health` smoke check.
- A new release requires a version bump. Pushing another commit without one leaves the existing tag and image untouched.

### 14.6 Fly.io deployment

`fly.toml` describes the production topology: one shared-CPU 1 GB machine in `fra`, scale-to-zero, a 20-second shutdown window, HTTP health checks on `/api/health`, and the migration release command.

- Production deploys are gated by the repository variable `FLY_DEPLOY_ENABLED=true`. When a new version tag is created, the `deploy` job in `ci.yml` installs pinned flyctl `0.4.120` and deploys the GHCR digest produced by the release job.
- Required Fly secrets: `DATABASE_URL`, `AUTH_SECRET`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `KMS_KEY_NAME`, `GCP_KMS_CREDENTIALS`, `KILL_SWITCH_SECRET`, `METRICS_SECRET`, `LEGAL_ENTITY`, `LEGAL_ADDRESS`, `LEGAL_CONTACT_EMAIL` and, when analytics is enabled, the PostHog values. Optional: `LEGAL_VAT_ID`, and `LEGAL_LOG_RETENTION_DAYS`/`LEGAL_BACKUP_RETENTION_DAYS` when the Fly log or Neon backup retention differs from the 30/7-day defaults; `SMTP_URL`, `MAIL_FROM` and `LEGAL_MAIL_PROVIDER` to email a shutdown notice.
- `SIGNUP_MODE=allowlist` is the Fly default. Set `SIGNUP_MODE=open` explicitly to open public registration, or add `SIGNUP_ALLOWED_EMAILS`/`SIGNUP_ALLOWED_EMAIL_DOMAINS`.
- The public smoke URL comes from the repository variable `PUBLIC_APP_URL` (falling back to `https://beamling.app`).
- `GCP_KMS_CREDENTIALS` is the service-account JSON. It lets the GCP client run on a host with no credentials file; Application Default Credentials remain the fallback.
- `release_command = "node scripts/migrate.mjs"` applies the schema before the new machine receives traffic. Applied migrations store a SHA-256 checksum; editing an applied file fails the run instead of silently drifting.
- Neon must use its pooled connection string with TLS; `DATABASE_SSL=true` is set in `fly.toml`.
- `APP_URL` defaults to `https://beamling.app`. Override it as a Fly secret for staging or a different domain, and register the matching Google OAuth callback.
- The Fly app and certificate are not created by the repository. Create the app, set the secrets, enable the workflow variable and attach the custom domain before the first deploy.

### 14.7 Database pool

- One pool per process, reused across route handlers and instrumentation through `globalThis`.
- Default max 10 connections.
- Connection timeout 10 seconds.
- Statement timeout 15 seconds.
- Lock timeout 5 seconds.
- Idle-in-transaction timeout 30 seconds.
- TLS is enabled only when `DATABASE_SSL=true`; CA and certificate verification are configurable. `DATABASE_SSL_CA_FILE` lets the parity stack and scripts read a mounted CA.

### 14.8 Operational killswitch

- `system_flags` stores `accepting_new_streams`; a missing row means open, so a fresh database accepts streams.
- `POST /api/internal/kill` changes the flag with a Bearer `KILL_SWITCH_SECRET` and an optional reason. It never auto-re-enables.
- `/api/chat` reads the flag before parsing the question or starting work. When closed, it returns 503 `SERVICE_BUSY` with `Retry-After: 60`; existing streams are not aborted.
- `GET /api/internal/metrics` requires a Bearer `METRICS_SECRET` and returns the flag, active stream count, configured stream cap and build identity.
- `GET`/`POST /api/internal/shutdown` (Bearer `KILL_SWITCH_SECRET`) shows, schedules or cancels a service shutdown (§6.7, §14.10).
- A missing or short secret disables its endpoint (404) and logs a production startup warning. A wrong bearer token returns 401 and logs an `internal_auth_failed` audit event. The bearer is compared as SHA-256 digests with `timingSafeEqual`, so the comparison is constant-time and does not reveal the secret's length. None of these endpoints uses a session or the public read limiter.
- `.github/workflows/watchdog.yml` probes `/api/live`, `/api/health` and `/` every five minutes. Failure notifies GitHub and, when `WATCHDOG_WEBHOOK_URL` is configured, an operator webhook.
- There is no bundled error-tracking service; Sentry/Better Stack remain operator choices.

### 14.9 License inventory

- `scripts/licenses.mjs` reads `pnpm licenses list --prod --json`, strips local paths, evaluates SPDX expressions and writes `packages/web/lib/generated/licenses.json`.
- The script rejects any license outside `0BSD`, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MIT, MIT-0 and OFL-1.1. The only exception is `caniuse-lite` under CC-BY-4.0, recorded with its attribution in the generated data.
- Each package keeps its name, versions, license, homepage, copyright or NOTICE text. The page also renders one full license text per license expression.
- `pnpm licenses:check` fails CI when the committed inventory is stale or a dependency adds an unreviewed license.
- Sharp is excluded from optional dependencies and Next image optimization is disabled because the app does not use `next/image`; this keeps the LGPL libvips binary out of the production image.
- The landing, sign-in, welcome and legal pages share a small legal footer with Privacy, Terms, Cookies, Data processors, Security, Status, Contact and Licenses, and the line "Beamling is open source under the MIT License".
- Beamling itself is MIT-licensed: the root `LICENSE` file ("Copyright (c) 2026 Beamling contributors") and `"license": "MIT"` in the root, web and mascot `package.json` files.

## 15. Tests

The repository contains four layers.

| Suite | Count | Coverage |
|---|---|---|
| `packages/mascot/test/geometry.test.mjs` | 6 | Eye/beam geometry, expressions, state mapping |
| `packages/web/tests/unit.test.ts` | 57 | KMS-backed credential encryption/rotation, workspace-key re-wrap by the rotation script, integrity vs KMS-outage decryption errors, hidden last four for short keys, analytics dropped for opted-out accounts, model allowlist, Brave/Tavily/Exa/OpenRouter mapping, 429 retry, network vs abort, citations, ranking, freshness, language, prompt injection, client IP HMAC, same-origin anchors, production config and PostHog host rules, analytics allowlist/identity/delivery/deletion/kill-switch deletion/shared client, erasure backoff, Tavily free validation, body limits, provider-safe log redaction, fail-closed plaintext reads, malformed provider bodies, missing OpenRouter completion markers, PostHog deletion behind the kill switch, English shutdown notice with date and export instructions |
| `packages/web/tests/integration.test.ts` | 38 | Database-backed account persistence, inactive/unaccepted account cleanup, data export (decrypted content, no key material), analytics opt-out with queued erasure, content encryption, Quick/Deep/Deeper, the Deeper AI SDK tool loop, planner repair/degrade, partial search, missing keys, selected-provider persistence and cost, no fallback, one stream per conversation, global concurrency, lock timeout, stop flag, mid-answer delete, timeout, NUL, retry, stale repair, pinned ordering, pagination, session cleanup, rate limits, Brave spacing, key replacement, unverified keys, the analytics erasure queue, the new-stream flag, per-account concurrency, empty-conversation cleanup, interrupted-terminal race, 100-conversation cap dropping unpinned ones first, 60-day conversation expiry for pinned and unpinned, scheduled shutdown that notifies each account once and deletes every account on the date |
| `packages/web/e2e/*.spec.ts` | 44 | 15 API checks, 18 UI flows and 11 public-route variants for CSP and axe; the terms gate refuses the API until acceptance and a new account accepts on `/welcome`, data export and analytics opt-out work, `security.txt` is served, only Brave and Exa keys skip validation; Quick checks search details, reasoning and tables, provider selection checks Tavily and marks a provider without a key, an Exa key is saved unvalidated and checked later, the killswitch rejects new streams and metrics stay secret-protected, the license page and its footer links resolve, Deeper checks the third mode, sidebar checks pinning and title search, and a scheduled shutdown is announced in the app, at sign-in and on the status page |

Commands:

```sh
pnpm test
DATABASE_URL=postgres://... pnpm --filter @beamling/web test
pnpm --filter @beamling/web typecheck
pnpm --filter @beamling/web lint
pnpm licenses:check
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
- An account that has not accepted the current terms gets `TERMS_REQUIRED` from the API but can still export its data; acceptance without the age confirmation is rejected and a stale version gets `TERMS_OUTDATED`.
- A new account is sent to `/welcome`, must tick both checkboxes, and then reaches the app.
- An account can download its data export and opt out of analytics.
- `/.well-known/security.txt` names a contact, a policy and a future expiry.
- `validate: false` is refused for an OpenRouter key.
- The killswitch rejects new streams with `SERVICE_BUSY`/`Retry-After`, requires the kill secret, and keeps metrics behind their separate secret.
- The generated license page lists production packages, and its footer links resolve.
- Onboarding preserves saved model and mode; settings accepts a launch provider and rejects an unknown one.
- Quick answers stream citations, costs and sources.
- A Tavily answer can be selected per question and keeps its provider badge after reload.
- Answers stay isolated per conversation when switching.
- Client-side navigation keeps a stream alive.
- Stop keeps partial text; “Ask again” replaces the answer without repeating the question.
- Reload mid-answer shows a stopped stored answer.
- Failures before storage can be retried as a new question.
- Deletion of an active conversation returns to a new question.
- Older conversations load on demand.
- A scheduled shutdown shows its banner in the app, the date and closed sign-up on `/login`, and the date on `/status`.
- Public routes and `/welcome` have no CSP violations or serious/critical axe violations.

---

## 16. Current capability map

| Capability | Implementation |
|---|---|
| Accounts | Google-only OIDC, one account per Google subject, versioned terms acceptance with 18+ confirmation |
| Session management | Opaque token, SHA-256 at rest, 30-day sliding expiry capped at 90 days, previous-session revocation on sign-in, sign-out |
| Provider credentials | OpenRouter + Brave/Tavily/Exa, validated, KMS-encrypted, replaceable, deletable, revalidatable |
| Credential limits | Brave Free/Paid plan, declared expiry and budget, estimated spend and warnings |
| Key rotation | KMS key rotation with lazy re-wrap of workspace and credential keys; env adapter supports previous-key list + re-wrap script for credential and workspace keys |
| Quick answers | One search on the selected provider, cited streamed answer |
| Deep answers | Planner, 3–5 sub-queries, bounded concurrent search, optional gap pass, cited report |
| Deeper answers | AI SDK `ToolLoopAgent`, selected-provider search tool, adaptive rounds, 60-search/60-source cap, long cited report |
| Retrieval | Brave, Tavily or Exa snippets selected per answer, freshness filter, Brave per-key spacing, 429 retry |
| Source quality | URL validation, snippet requirement, canonical dedupe, site diversity, stable numbering |
| Citations | Streamed `[n]` parsing, sanitization, click-to-source, uncited warning |
| Conversation history | Create, open, title, paginate, delete; 100 per account (oldest unpinned trimmed), deleted 60 days after last activity, sidebar notice and warning from 90 |
| Message history | 60-message pages, earlier pages, source attachment |
| Streaming | SSE stages, progress, sources, deltas, citations, usage, done/error; heartbeat |
| Cancellation | Local and cross-instance stop, partial text kept, timeout and shutdown handling |
| Models | Five allowlisted OpenRouter models, default DeepSeek V4.1 Flash |
| Costs | OpenRouter actual generation cost, selected-provider list-price estimate, tokens, latency, search count |
| Search transparency | Persisted per-answer search trace, collapsed by default |
| Reasoning transparency | Provider-supplied reasoning, persisted encrypted and collapsed by default |
| Markdown | Tables in addition to headings, lists, quotes, code and citations |
| Settings | Default model, default search provider, default mode, keys and limits, account |
| Account deletion | Immediate hard delete of the account, workspace key, content and credentials; automatic deletion after 24 months of inactivity or 7 days without terms acceptance |
| Data rights | Self-service JSON export, analytics objection with erasure, account deletion |
| Service shutdown | Operator-scheduled closure with at least 14 days' notice: an English email to every account, in-app/login/status banner, no new sign-ups, then deletion of every account |
| Legal | Privacy notice, terms, cookies, data processors, security policy, DSA contact, `security.txt`, MIT license |
| Rate limits | Login, chat, conversations, credentials, key validation, exports, reads, writes; per-account and per-IP |
| Encryption | KMS-wrapped workspace keys, AES-256-GCM content and credential encryption |
| Local parity | Caddy HTTPS, Dex OIDC, LocalStack KMS, TLS PostgreSQL, production image |
| Concurrency control | Global cap + one streaming answer per conversation, database-enforced |
| UI | Landing, login, onboarding, chat, source panel/sheet, settings modal, account panel |
| Accessibility | Focus traps, keyboard tabs, live regions, reduced motion, axe-checked routes |
| Security | CSP nonce, strict headers, `APP_URL`-anchored origin checks, body caps, prompt injection boundaries, redacted provider logs, safe markdown and URLs |
| Credential protection | AES-256-GCM envelope encryption, AAD binding, master-key rotation |
| Persistence | PostgreSQL 18, Drizzle schema, forward-only migration ledger |
| Local deployment | Docker Compose app + PostgreSQL, standalone image, build identity, health check, graceful shutdown |
| Production deploy config | `fly.toml`, gated Fly deploy job, GCP service-account secret support; no live deployment yet |
| Killswitch | Database flag, chat gate, internal kill/metrics/shutdown endpoints, GitHub Actions watchdog |
| Observability | Structured JSON logs, security audit events, versioned health endpoint, build identity in the UI, optional server-side PostHog events |
| Analytics | Opt-in server-side PostHog events with allowlisted metadata, HMAC ids, per-account opt-out, kill switch and deletion cleanup |
| Testing | Unit, integration, E2E and mascot geometry suites |

### 14.10 Incident runbook

- **Sign-in outage:** check `/status`, then the OIDC issuer and Google OAuth client. A bad callback secret or a `503`/JSON error at `/api/auth/login` redirects to `/login?error=auth_unavailable`; the underlying cause is in the request log with its `requestId`.
- **Answer outage:** check `/api/health` (`database`, `schema`, `kms`) and the `answer_failed` rate by error code. Use the kill switch for a provider-wide failure; existing streams continue.
- **KMS or schema down:** health returns 503 with that component `down`. Do not bypass readiness or the migration checksum; restore the key/version or apply a new migration.
- **Database pressure:** check the active-stream count in `/api/internal/metrics`, the pool size and Fly connection limits. Keep `MAX_CONCURRENT_CHATS` below `PLATFORM_CONNECTION_LIMIT`.
- **PostHog erasure failures:** query `analytics_erasures` ordered by `next_attempt_at`; failures are retried with backoff and logged after five attempts with a truncated distinct-id prefix.
- **Rollback:** list releases with `flyctl releases`, then deploy the previous image digest with `flyctl deploy --image <digest>`. Migrations are forward-only; restore from a backup if a schema change must be undone.
- **Shutting the service down:**
  1. Configure mail: set `SMTP_URL` (`smtps://` or `smtp://` with STARTTLS), `MAIL_FROM` and `LEGAL_MAIL_PROVIDER` (so `/subprocessors` names the provider), and deploy. `GET /api/internal/shutdown` reports `mailConfigured`.
  2. Schedule: `POST /api/internal/shutdown` with `Authorization: Bearer $KILL_SWITCH_SECRET` and `{ "action": "schedule", "days": 14, "reason": "..." }` (`days` at least 14). Without mail the call returns `MAIL_NOT_CONFIGURED`; `notify: false` schedules without email (banner only). Sign-ups stop and the banner appears at once; notices start immediately and the 15-minute cleanup job resumes them.
  3. Monitor `GET /api/internal/shutdown` until `notified` equals `accounts`; `Shutdown notice could not be sent` errors in the log mean SMTP failures, retried on the next tick. `{ "action": "cancel" }` stops everything before the date; rescheduling re-sends the notice to every account.
  4. After the date the cleanup job deletes every account (`shutdown_account_deleted` audit events, `Service shutdown deleted accounts` warning); wait until `accounts` is 0 and the PostHog erasure queue is empty.
  5. Destroy the KMS key (all versions). This crypto-shreds the wrapped workspace and credential keys, so content and keys in database backups become unreadable.
  6. Remove the Fly app, the Neon project and its backups, DNS and remaining secrets.
- **Watchdog:** `.github/workflows/watchdog.yml` runs every five minutes and can be triggered manually. Set `WATCHDOG_WEBHOOK_URL` for operator notification. Sentry/Better Stack are optional operator choices, not bundled dependencies.

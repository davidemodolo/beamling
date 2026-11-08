# Runtime configuration

Configuration is environment variables only.

## Required in production

| Variable | Behavior |
|---|---|
| `DATABASE_URL` | App pool connection string; may be a transaction-mode pooler. Non-production default `postgres://beamling:beamling@127.0.0.1:5432/beamling`. |
| `APP_URL` | Public origin only; `https://` outside localhost. Dev fallback: `OPENROUTER_APP_URL`, `NEXT_PUBLIC_APP_URL`, `http://localhost:3000`. Sent to OpenRouter as `HTTP-Referer`. |
| `AUTH_SECRET` | 32 bytes, base64. HKDF root for OIDC transaction encryption, IP hashes, credential fingerprints and provider-slot keys. |
| `OIDC_CLIENT_ID` | Google OAuth client id. |
| `OIDC_CLIENT_SECRET` | Google OAuth client secret. |
| `KMS_PROVIDER` | `gcp` in production, `aws` in the parity stack, `env` only on localhost/tests. |
| `KMS_KEY_NAME` | GCP Cloud KMS key resource name (`gcp`). |
| `GCP_KMS_CREDENTIALS` | Optional service-account JSON; otherwise Application Default Credentials. |
| `KMS_KEY_ID` | AWS KMS key id or alias (`aws`). |
| `LEGAL_ENTITY` | Operator name on legal and contact pages. |
| `LEGAL_CONTACT_EMAIL` | Privacy/security/abuse address, also in `/.well-known/security.txt`. |
| `LEGAL_ADDRESS` | Postal address, shown when set; required with `LEGAL_VAT_ID`. |

`LEGAL_ENTITY` and `LEGAL_CONTACT_EMAIL` are required outside localhost only. Production refuses to boot when:

- `DATABASE_URL` is missing, or a Neon `-pooler` host without `DATABASE_URL_DIRECT`, or `DATABASE_URL_DIRECT` is a pooler (`scripts/migrate.mjs` also refuses one).
- `APP_URL` is missing or invalid (see above).
- Outside localhost: `COOKIE_SECURE=false`, or `TRUSTED_PROXY_HOPS` missing.
- `AUTH_SECRET` is invalid, or an `OIDC_CLIENT_*` value is missing.
- Outside localhost: `OIDC_ISSUER` is not `https://accounts.google.com`; `LEGAL_ENTITY` or a valid `LEGAL_CONTACT_EMAIL` is missing; `LEGAL_VAT_ID` lacks `LEGAL_ADDRESS`; a `LEGAL_*_RETENTION_DAYS` is not a positive integer; `SMTP_URL` is invalid or lacks `MAIL_FROM`/`LEGAL_MAIL_PROVIDER`.
- `SIGNUP_MODE` is not `open`, `allowlist` or `paused`.
- `KMS_PROVIDER=env` outside localhost, or the selected KMS key setting is missing.
- `GCP_KMS_CREDENTIALS` is not service-account JSON with `client_email` and `private_key`.
- `BEAMLING_FAKE_PROVIDERS=1` without a localhost `APP_URL`.
- `ANALYTICS_ENABLED` is not `true`/`false`, or analytics is on without its required settings.
- Any PostHog deletion setting is present but salt, personal key, project id or hosts are incomplete.
- A PostHog host is not HTTPS (plain-HTTP localhost allowed outside production), or `POSTHOG_PROJECT_ID` is not numeric.

## Optional

| Variable | Default / behavior |
|---|---|
| `OIDC_ISSUER` | `https://accounts.google.com`; parity stack: `http://auth.localhost:5556`. |
| `OIDC_REDIRECT_URI` | `${APP_URL}/api/auth/callback/google`. Production requires the `APP_URL` origin and this path. |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `KMS_ENDPOINT` | AWS KMS adapter (LocalStack in the parity stack). |
| `CREDENTIAL_MASTER_KEY` | Required with `KMS_PROVIDER=env`: 32 bytes, base64 (`openssl rand -base64 32`). |
| `CREDENTIAL_MASTER_KEY_ID` | `k1`; env-KMS only. |
| `CREDENTIAL_PREVIOUS_MASTER_KEYS` | Env-KMS rotation list. |
| `DATABASE_URL_DIRECT` | Non-pooled connection for session advisory locks (migrations, shutdown worker). Defaults to `DATABASE_URL`. |
| `DATABASE_SSL` | `false` unless exactly `true`. |
| `DATABASE_SSL_CA` | PEM CA; literal `\n` becomes a newline. |
| `DATABASE_SSL_CA_FILE` | PEM CA file path (parity stack, scripts). |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true` unless exactly `false`. |
| `DATABASE_POOL_MAX` | `10` connections per process. |
| `PORT` | `3000` in Docker; Next.js default otherwise. |
| `TRUSTED_PROXY_HOPS` | `1`; proxies appending to `X-Forwarded-For`. `0` ignores the header (one shared IP bucket). |
| `COOKIE_SECURE` | Secure cookies. Default: on in production unless localhost; in dev only for HTTPS `APP_URL`. |
| `MAX_CONCURRENT_CHATS` | `50` active streams database-wide. `deploy/gcp/service.yaml` sets `30` for headroom. |
| `MAX_CONCURRENT_CHATS_PER_USER` | `2` active streams per account. |
| `DATABASE_SIZE_LIMIT_MB` | `850`. New questions pause for everyone (`SERVICE_FULL`) once `pg_database_size` reaches it. |
| `PLATFORM_CONNECTION_LIMIT` | Platform concurrency ceiling (`40` on Cloud Run). |
| `LOGINS_PER_IP_PER_HOUR` | `60` sign-in starts per hashed IP per fixed hour. |
| `AUTH_CALLBACKS_PER_IP_PER_HOUR` | `120` callbacks per hashed IP per fixed hour. |
| `NEW_ACCOUNTS_PER_HOUR` | `200` new accounts per fixed hour, deployment-wide. |
| `SIGNUPS_PER_IP_PER_HOUR` | `10` new accounts per hashed IP per fixed hour. |
| `SIGNUP_MODE` | `open`, `allowlist` or `paused`; default `open` outside production, `allowlist` in production. |
| `SIGNUP_ALLOWED_EMAILS` | Comma-separated exact addresses (allowlist mode). |
| `SIGNUP_ALLOWED_EMAIL_DOMAINS` | Comma-separated domain suffixes; an empty allowlist admits nobody. |
| `LEGAL_VAT_ID` | VAT or company registration, shown next to the operator. |
| `LEGAL_LOG_RETENTION_DAYS` | `30`; log retention stated in the privacy notice. |
| `LEGAL_BACKUP_RETENTION_DAYS` | `7`; backup retention stated in the privacy notice. |
| `LEGAL_GOVERNING_LAW` | Terms governing law; default `Italian law`. |
| `SMTP_URL` | Shutdown-notice relay: `smtps://user:pass@host:465` or `smtp://user:pass@host:587` (STARTTLS required). 15 s connect timeout. Unset: no email. |
| `MAIL_FROM` | Notice sender; needed with `SMTP_URL`. |
| `LEGAL_MAIL_PROVIDER` | SMTP provider and location, listed on `/subprocessors`. |
| `BRAVE_MIN_INTERVAL_MS` | `1,100` ms between Free-plan Brave requests per key. `0` disables. |
| `BRAVE_PAID_MIN_INTERVAL_MS` | `0`; spacing for Paid-plan Brave keys. |
| `BEAMLING_FAKE_PROVIDERS` | `1` uses fixture providers. Honored outside production, or in production with a localhost `APP_URL`. |
| `BEAMLING_FAKE_DELAY_MS` | Overrides fixture delays. |
| `BEAMLING_TEST_AUTH` | `1` enables `POST /api/auth/test-login`, only with fixture providers and a localhost `APP_URL` ([Accounts](accounts.md)). |
| `KILL_SWITCH_SECRET` | Bearer for `/api/internal/kill` and `/api/internal/shutdown`. ≥ 32 bytes; otherwise the endpoint returns 404. |
| `METRICS_SECRET` | Bearer for `/api/internal/metrics`; same rule. |
| `APP_VERSION`, `GIT_COMMIT` (or `GITHUB_SHA`), `BUILD_TIME` | Build-time identity; defaults `package.json` version, `local`, now. |
| `ANALYTICS_ENABLED` | Off unless exactly `true`; `false` is the kill switch. |
| `POSTHOG_HOST` | Ingestion origin, default `https://eu.i.posthog.com`. |
| `POSTHOG_APP_HOST` | Personal API origin; derived from the EU/US host or set for self-hosted. |
| `POSTHOG_API_KEY` | Project token; required with analytics. |
| `POSTHOG_PERSONAL_API_KEY` | `person:write` key for erasure on account deletion; required with analytics. Keep it after the kill switch: deletions continue. |
| `POSTHOG_PROJECT_ID` | Numeric project id; required with analytics. |
| `ANALYTICS_SALT` | HMAC-SHA256 salt for the distinct id; ≥ 32 bytes, required with analytics. |

Production warnings (non-fatal):

- `DATABASE_SSL` off for a remote database, or certificate verification disabled.
- Default database password `beamling`.
- `TRUSTED_PROXY_HOPS=0`.
- `MAX_CONCURRENT_CHATS` not below `PLATFORM_CONNECTION_LIMIT`.
- `SIGNUP_MODE=allowlist` with an empty allowlist (sign-ups paused).
- No `SMTP_URL`/`MAIL_FROM` (shutdown notice cannot be emailed).
- `KILL_SWITCH_SECRET` or `METRICS_SECRET` missing or < 32 bytes (endpoint disabled).

## Fixture providers

With `BEAMLING_FAKE_PROVIDERS=1` (tests and offline dev, no network calls):

- Keys starting with `test-` validate.
- Search returns fixed example sources; planner, gap and answer calls return deterministic content.
- `[fixture:broken-plan]` in a Deep question forces planner fallback.
- `[fixture:bad-plan]` fails the first plan to exercise repair.
- `[fixture:partial-search]` makes one Deep search fail.
- A question containing `no sources` returns no results.

# Runtime configuration

Configuration is read from environment variables at request/startup time. There is no config file.

## Required in production

| Variable | Behavior |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by the application pool. Required when `NODE_ENV=production`. Falls back to `postgres://beamling:beamling@127.0.0.1:5432/beamling` outside production. May point at a transaction-mode pooler (Neon `-pooler`, PgBouncer). |
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
| `LEGAL_ADDRESS` | Postal address of the operator shown on the privacy notice, terms and contact page when set. Optional for a private, non-commercial operator; required outside localhost when `LEGAL_VAT_ID` is set. |

Production startup refuses to boot when any of these checks fails:

- `DATABASE_URL` is missing.
- `DATABASE_URL` points at a Neon pooler host (`-pooler`) and `DATABASE_URL_DIRECT` is missing, or `DATABASE_URL_DIRECT` itself is a pooler host. `scripts/migrate.mjs` also refuses to run over a pooler host.
- `APP_URL` is missing, malformed, includes a path/query/credentials, or is not HTTPS outside localhost.
- `COOKIE_SECURE=false` outside localhost.
- `TRUSTED_PROXY_HOPS` is missing outside localhost.
- `AUTH_SECRET` is not a valid 32-byte base64 value.
- `OIDC_CLIENT_ID` or `OIDC_CLIENT_SECRET` is missing.
- `OIDC_ISSUER` is not HTTPS outside localhost, or is not `https://accounts.google.com` outside localhost (Google-only alpha).
- `LEGAL_ENTITY` or a valid `LEGAL_CONTACT_EMAIL` is missing outside localhost, or `LEGAL_VAT_ID` is set without `LEGAL_ADDRESS`.
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

## Optional

| Variable | Default / behavior |
|---|---|
| `OIDC_ISSUER` | `https://accounts.google.com`; the local parity stack uses `http://auth.localhost:5556`. |
| `OIDC_REDIRECT_URI` | Defaults to `${APP_URL}/api/auth/callback/google`. Production requires the same origin as `APP_URL` and the fixed callback path. |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `KMS_ENDPOINT` | AWS KMS adapter; LocalStack uses test credentials and an internal endpoint. |
| `CREDENTIAL_MASTER_KEY_ID` | `k1`; env-KMS adapter only. |
| `CREDENTIAL_PREVIOUS_MASTER_KEYS` | Env-KMS adapter rotation list. |
| `DATABASE_URL_DIRECT` | Direct (non-pooled) connection string for work that holds a session-level advisory lock: migrations and the scheduled-shutdown worker. Falls back to `DATABASE_URL`. Set it whenever `DATABASE_URL` points at a transaction-mode pooler. |
| `DATABASE_SSL` | `false` unless exactly `true`. |
| `DATABASE_SSL_CA` | PEM CA; literal `\n` sequences are converted to newlines. |
| `DATABASE_SSL_CA_FILE` | Path to a PEM CA file, used by the parity stack and scripts. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true` unless exactly `false`. |
| `DATABASE_POOL_MAX` | `10` pg pool connections per process. |
| `PORT` | `3000` in Docker; Next.js default otherwise. |
| `TRUSTED_PROXY_HOPS` | `1`; number of trusted proxies that append to `X-Forwarded-For`. `0` ignores the header and puts all clients in one IP bucket. |
| `COOKIE_SECURE` | Forces Secure cookies on/off. Default: on in production unless `APP_URL` is localhost; on in development only for an HTTPS `APP_URL`. |
| `MAX_CONCURRENT_CHATS` | `50` active streams across the database. `deploy/gcp/service.yaml` sets `30` to leave headroom below the per-instance request ceiling. |
| `MAX_CONCURRENT_CHATS_PER_USER` | `2` active streams for one account, so one user cannot occupy every global slot. |
| `PLATFORM_CONNECTION_LIMIT` | Optional platform connection ceiling (Cloud Run `containerConcurrency`, `40` in production); startup warns when `MAX_CONCURRENT_CHATS` is not below it. |
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

## Fixture providers

With `BEAMLING_FAKE_PROVIDERS=1`:

- Any key starting with `test-` validates.
- Search returns a fixed set of example sources.
- Planner, gap, and answer calls return deterministic fixture content.
- Adding `[fixture:broken-plan]` to a Deep question forces planner fallback.
- `[fixture:bad-plan]` fails the first plan and exercises repair.
- `[fixture:partial-search]` makes one Deep search fail.
- A question containing `no sources` returns no results.

Fixtures exist for automated tests and a fast offline dev loop; no network calls are made to OpenRouter or any search provider in this mode. The production-parity stack leaves them off.

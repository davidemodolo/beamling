# Deployment and operations

## Production-parity Docker Compose

`docker-compose.yml` defines the local stack:

| Service | Role |
|---|---|
| `certs` | Local CA and PostgreSQL server certificate, owned by the Postgres uid |
| `db` | `postgres:18-alpine`, TLS required, loopback `127.0.0.1:5433`, named volume, `pg_isready` check |
| `localstack` | LocalStack 4.14.0 KMS with `alias/beamling-local`. Pinned: later images need an auth token |
| `dex` | Dex OIDC at `http://auth.localhost:5556`, user `test@beamling.local` / `beamling` |
| `migrate` | One-shot `node scripts/migrate.mjs` in the production image |
| `app` | Production standalone image, `NODE_ENV=production`, `__Host-` cookie, KMS crypto |
| `caddy` | HTTPS on `https://localhost` (internal CA), proxies `app:3000`; 80/443 on loopback |

Same OIDC, session, KMS, encryption, migration and SSE code as production; Dex replaces Google and LocalStack replaces Cloud KMS. No fixture providers.

```sh
pnpm local:up
# Browse https://localhost (accept the local CA), sign in with
# test@beamling.local / beamling, then add real model and search provider keys.
pnpm local:down
```

Integration tests use `DATABASE_URL=postgres://beamling:beamling@127.0.0.1:5433/beamling`.

`pnpm web:dev` is a fast dev loop, not the parity stack. `BEAMLING_FAKE_PROVIDERS=1` selects fixture providers; Playwright uses them with the test-only `/api/auth/test-login`.

## Image contract

Multi-stage Dockerfile:

1. `deps`: Node 26 Alpine; installs pnpm via npm at the `packageManager` version (Node 26 has no corepack); installs dependencies with `--ignore-scripts`.
2. `build`: builds the mascot and runs `next build` (standalone).
3. `runner`: Node 26 Alpine without npm, non-root `beamling` user, standalone server, static/public assets, Drizzle migrations and both scripts.

```text
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
NEXT_TELEMETRY_DISABLED=1
NEXT_MANUAL_SIG_HANDLE=true
NODE_PATH=/app/node_modules/.pnpm/node_modules
```

Alpine security updates are applied; `HEALTHCHECK` hits `/api/health`.

## Migrations

`scripts/migrate.mjs`:

- `0000_init.sql` is the schema applied to production on 7 November 2026 (v0.3.0). Applied files are never edited; changes add a higher-numbered file.
- `0001_default_model_nemotron.sql` (v0.6.0) changes the `settings.llm_model` default; existing rows keep their model.
- Connects to `DATABASE_URL_DIRECT`, else `DATABASE_URL`. Not through a transaction-mode pooler: the advisory lock is session-scoped.
- Clears its session timeouts, takes advisory lock `7314002917` so deploys serialize, creates `beamling_migrations` if absent.
- Applies unapplied `drizzle/*.sql` files in name order, each in a transaction split on `--> statement-breakpoint`; records the filename after commit; rolls back on error.
- Sets role defaults (`ALTER ROLE CURRENT_USER SET`): `statement_timeout` 15 s, `lock_timeout` 5 s, `idle_in_transaction_session_timeout` 30 s, on every run. App and migrations must use the same role.
- Releases the lock and closes.

Migrations are a release step, not run at app start.

## Health and shutdown

- `/api/live`: DB-free liveness, `{ "ok": true }`.
- `/api/health`: readiness cached five seconds: `select 1`, `beamling_migrations` table, KMS wrap/unwrap.
  - Healthy: 200 `{ "ok": true, "database": "up", "schema": "up", "kms": "up", "version": "<version>", "commit": "...", "builtAt": "..." }`.
  - Unhealthy: 503, failing component `down`, no error details.
- Both unauthenticated with `Cache-Control: no-store`. `/status` shows the same state.
- On `SIGTERM`/`SIGINT` with `NEXT_MANUAL_SIG_HANDLE` set: set a shutdown flag, reject new `/api/chat`, abort active chats (including late registrations), wait up to 8 seconds for outcomes, mark leftovers interrupted, close the pool, exit.
- Grace period: 15 s in Docker Compose, 10 s on Cloud Run.

## Versioning and releases

- The root `package.json` version is the source of truth; web and mascot packages are kept in sync.
- `pnpm version` prints it, `pnpm version:set <x.y.z>` updates all three, `pnpm version:check v<x.y.z>` rejects a mismatched tag.
- `next.config.ts` injects `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_GIT_COMMIT` and `NEXT_PUBLIC_BUILD_TIME`, shown by `/api/health`, the landing footer and the sidebar.
- On a green push to `main`, CI creates tag `v<version>` if missing, builds and pushes `ghcr.io/<repo>:v<version>` and `:latest`, records the digest and creates a GitHub release.
- The deploy job deploys that digest ([Google Cloud Run deployment](#google-cloud-run-deployment)) and smoke-checks `/api/health`.
- No version bump, no release: the existing tag and image stay.

## Google Cloud Run deployment

Cloud Run in `europe-west1`, Neon Postgres in Frankfurt, Cloud KMS key in `europe-west3`. GCP project `beamling-prod`.

- **Setup:** `deploy/gcp/setup.sh` creates all resources and is re-runnable. No service-account keys:

  | Identity | Used by | Permissions |
  |---|---|---|
  | `beamling-app` | Cloud Run service | `cloudkms.cryptoKeyEncrypterDecrypter` on the key; `secretmanager.secretAccessor` on the six app secrets |
  | `beamling-migrate` | Cloud Run job `beamling-migrate` | `secretmanager.secretAccessor` on `DATABASE_URL_DIRECT` only |
  | `beamling-deploy` | GitHub Actions `deploy` job | `run.developer`, `iam.serviceAccountUser` on the two accounts above, `artifactregistry.reader` on the `ghcr` proxy; no IAM, secret or KMS rights |

- **Keyless deploys:** GitHub OIDC via Workload Identity pool `github` / provider `github-actions`, limited to the repository and owner IDs, `refs/heads/main` and environment `production`. Only `principalSet://…/attribute.repository_id/1427513799` can impersonate `beamling-deploy`.
- **Key:** rotates every 90 days; destroyed versions recoverable for 120 days. Rows store the key name, so decrypt survives rotation. KMS audit logs on.
- **Secrets:** Secret Manager (`europe-west1`) holds `DATABASE_URL`, `DATABASE_URL_DIRECT`, `AUTH_SECRET`, `OIDC_CLIENT_SECRET`, `KILL_SWITCH_SECRET`, `METRICS_SECRET` (`key: latest`, read at instance start). Add values with `gcloud secrets versions add NAME --data-file=-`.
- **Images:** public GHCR, proxied by Artifact Registry remote `ghcr`; Cloud Run deploys `europe-west1-docker.pkg.dev/beamling-prod/ghcr/<owner>/<repo>@sha256:…`. Cleanup keeps the five newest versions.
- **Topology** (`deploy/gcp/service.yaml`):
  - 0–2 instances; the maximum is the spend cap.
  - Request-based billing, startup CPU boost, 1 vCPU, 1 GiB.
  - 40 concurrent requests per instance (`PLATFORM_CONNECTION_LIMIT=40`), 420 s timeout (Deeper's 360 s plus storing).
  - Startup and liveness probes on `/api/live`.
  - Non-secret config, including `LEGAL_ENTITY`, `LEGAL_CONTACT_EMAIL`, `LEGAL_BACKUP_RETENTION_DAYS=1`.
  - The deploy job fills `${IMAGE}`, `${OIDC_CLIENT_ID}` (variable) and `${SIGNUP_ALLOWED_EMAILS}` (environment secret).
- **Deploy order:** on a new version tag with repository variable `GCP_DEPLOY_ENABLED=true`, the `deploy` job (environment `production`):
  1. renders both manifests;
  2. applies and runs `deploy/gcp/migrate-job.yaml` with `--wait` ([Migrations](#migrations)); failure stops the deploy;
  3. `gcloud run services replace`, waiting for the revision;
  4. smoke-tests `/api/health`.
  Deploys never change IAM; `allUsers` → `run.invoker` is granted once by setup.
- **GitHub settings:** environment `production` with variables `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `OIDC_CLIENT_ID` and secret `SIGNUP_ALLOWED_EMAILS`; repository variables `GCP_DEPLOY_ENABLED` and optional `PUBLIC_APP_URL` (default `https://beamling.app`). The GHCR package must be public.
- **Background work:** idle instances have no CPU, so hourly [cleanup](conversations.md#cleanup) runs only while serving.
- **Logs:** JSON on stdout with `severity`; `_Default` sink to EU bucket `beamling-eu` (`europe-west1`, 30 days), matching `LEGAL_LOG_RETENTION_DAYS=30`. Cloud Run request logs with status below 500 are excluded (`run-requests-ok`).
- **Spend:** max one instance, plus `deploy/gcp/budgets.sh`: a €5 Cloud Run spend cap (pauses new requests until the 1st or a manual lift) and a €5 account email alert.
- **Domain:** `beamling.app` via Cloud Run domain mapping, Google-managed TLS.
- Optional: `LEGAL_ADDRESS`, `LEGAL_VAT_ID` (requires the address), and `SMTP_URL`, `MAIL_FROM`, `LEGAL_MAIL_PROVIDER` for shutdown email, added to `service.yaml` when needed.
- `APP_URL` is `https://beamling.app`; for another domain change it and register the Google OAuth callback.
- `GCP_KMS_CREDENTIALS` (service-account JSON) is supported outside Google Cloud; production doesn't use it.

## Database pool

- One pool per process via `globalThis`; max 10 connections; 10 s connection timeout.
- Statement/lock/idle-in-transaction timeouts (15 s / 5 s / 30 s) are role defaults set by [migrations](#migrations), not startup parameters, which transaction-mode poolers reject.
- Pooler-safe: no session state; the global stream cap uses a transaction-scoped advisory lock. The scheduled-shutdown worker opens its own `DATABASE_URL_DIRECT` connection for a session lock.
- TLS only when `DATABASE_SSL=true`; CA and verification configurable; `DATABASE_SSL_CA_FILE` reads a mounted CA.

## Operational killswitch

- `system_flags.accepting_new_streams`; a missing row means open.
- `POST /api/internal/kill` (Bearer `KILL_SWITCH_SECRET`, optional reason) sets it. Never auto-re-enables.
- When closed, `/api/chat` returns 503 `SERVICE_BUSY` with `Retry-After: 60` before parsing; existing streams continue.
- `GET /api/internal/metrics` (Bearer `METRICS_SECRET`): flag, active streams, stream cap, build identity.
- `GET`/`POST /api/internal/shutdown` (Bearer `KILL_SWITCH_SECRET`) shows, schedules or cancels a shutdown ([Scheduled shutdown](conversations.md#scheduled-shutdown), [Incident runbook](#incident-runbook)).
- Missing or short secret: endpoint 404 plus a production startup warning. Wrong bearer: 401 and an `internal_auth_failed` audit event. Comparison is constant-time on SHA-256 digests (`timingSafeEqual`). No session or public read limiter.
- No bundled error tracking; see the [watchdog](#incident-runbook).

## License inventory

- `scripts/licenses.mjs` reads `pnpm licenses list --prod --json`, strips local paths, evaluates SPDX expressions and writes `packages/web/lib/generated/licenses.json`.
- Allowed: `0BSD`, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MIT, MIT-0, OFL-1.1. Sole exception: `caniuse-lite` (CC-BY-4.0, with attribution).
- Entries keep name, versions, license, homepage and copyright/NOTICE; the page shows one full text per license.
- `pnpm licenses:check` fails CI on a stale inventory or unreviewed license.
- Sharp is excluded and Next image optimization disabled (no `next/image`), keeping LGPL libvips out of the image.
- Beamling is MIT (root `LICENSE`, all three `package.json` files); public pages' footer says so.

## Production checklist

- `APP_URL`: public `https://` origin only (no path or query). It anchors same-origin checks, cookies and OIDC redirects.
- Don't expose the container directly. The proxy terminates TLS, overwrites client forwarding headers, appends to `X-Forwarded-For` and passes the original `Host`.
- Set `TRUSTED_PROXY_HOPS` to the exact proxy count; non-local deployments refuse to start without it.
- Run `node scripts/migrate.mjs` before new instances start.
- Retention: account data until deletion, 24 months without sign-in, or 7 days if terms never accepted; conversations 60 days after last activity, max 100 per account (oldest unpinned first); expired sessions deleted.
- To close the service, follow the [incident runbook](#incident-runbook).
- Production uses GCP Cloud KMS. The env master key and `scripts/rewrap-credentials.mjs` are for local tests only.
- Enable backups and log retention, and set `LEGAL_BACKUP_RETENTION_DAYS` (default 7) and `LEGAL_LOG_RETENTION_DAYS` (default 30) to the real windows (the privacy notice states them). Alert on the watchdog and `/api/health`.
- Analytics is off by default; see [Configuration](configuration.md) for the `ANALYTICS_*`/`POSTHOG_*` variables (the personal key needs `person:write`).
- Set `LEGAL_ENTITY`, `LEGAL_ADDRESS`, `LEGAL_CONTACT_EMAIL` (optional `LEGAL_VAT_ID`); use `SIGNUP_MODE=open` only after legal review. Material terms/privacy changes bump `LEGAL_VERSION` in `packages/web/lib/legal.ts`, forcing re-acceptance.
- Before each release: `pnpm audit --prod`, a Gitleaks history scan, a container scan. CI runs `pnpm audit --audit-level low` (any advisory fails) and Gitleaks.

## Incident runbook

- **Sign-in outage:** check `/status`, the OIDC issuer and Google OAuth client. Failures at `/api/auth/login` redirect to `/login?error=auth_unavailable`; the cause is in the request log by `requestId`.
- **Answer outage:** check `/api/health` and the `answer_failed` rate by code. Use the kill switch for provider-wide failure.
- **KMS or schema down:** health 503 with that component `down`. Don't bypass readiness or the migration checksum; restore the key/version or add a migration.
- **Database pressure:** check active streams in `/api/internal/metrics`, pool size, Cloud Run concurrency and instances. Keep `MAX_CONCURRENT_CHATS` below `PLATFORM_CONNECTION_LIMIT`.
- **PostHog erasure failures:** query `analytics_erasures` by `next_attempt_at`; retried with backoff, logged after five attempts with a truncated distinct-id prefix.
- **Rollback:** `gcloud run revisions list --service beamling --region europe-west1`, then `gcloud run services update-traffic beamling --region europe-west1 --to-revisions <revision>=100`. The next deploy takes traffic again. Migrations are forward-only; undo schema changes from a backup.
- **Shutting the service down:**
  1. Set `SMTP_URL` (`smtps://` or `smtp://` with STARTTLS), `MAIL_FROM` and `LEGAL_MAIL_PROVIDER` and deploy. `GET /api/internal/shutdown` reports `mailConfigured`.
  2. `POST /api/internal/shutdown` with `Authorization: Bearer $KILL_SWITCH_SECRET` and `{ "action": "schedule", "days": 14, "reason": "..." }` (`days` ≥ 14). Without mail: `MAIL_NOT_CONFIGURED`; `notify: false` skips email (banner only). Sign-ups stop and the banner appears at once; notices are sent immediately and resumed by the hourly cleanup.
  3. Poll `GET /api/internal/shutdown` until `notified` equals `accounts`; `Shutdown notice could not be sent` logs are SMTP failures, retried next tick. `{ "action": "cancel" }` cancels; rescheduling re-sends notices.
  4. After the date cleanup deletes every account (`shutdown_account_deleted` audit events, `Service shutdown deleted accounts` warning); wait for `accounts` 0 and an empty PostHog erasure queue.
  5. Destroy the KMS key (all versions), crypto-shredding content and keys in backups.
  6. Delete GCP project `beamling-prod`, the Neon project and backups, and DNS records.
- **Watchdog:** `.github/workflows/watchdog.yml` probes `/api/live` every five minutes, `/api/health` and `/` hourly (so Neon can scale to zero). Failures notify GitHub and `WATCHDOG_WEBHOOK_URL` if set.

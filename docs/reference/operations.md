# Deployment and operations

## Production-parity Docker Compose

`docker-compose.yml` defines the local stack:

| Service | Role |
|---|---|
| `certs` | Generates a local CA plus PostgreSQL server certificate, owned by the Postgres uid |
| `db` | `postgres:18-alpine` with TLS required, loopback port `127.0.0.1:5433` for host-run tests, named volume, `pg_isready` health check |
| `localstack` | LocalStack 4.14.0 with KMS and a pre-created `alias/beamling-local` key. Pinned: later LocalStack images require an account auth token. |
| `dex` | Dex OIDC issuer at `http://auth.localhost:5556`, seeded `test@beamling.local` / `beamling` |
| `migrate` | One-shot production image invocation of `node scripts/migrate.mjs`; waits for the database |
| `app` | Production standalone image, `NODE_ENV=production`, secure `__Host-` cookie, KMS-backed crypto |
| `caddy` | HTTPS on `https://localhost`, internal CA, reverse proxy to `app:3000`; ports 80/443 bound to loopback only |

The stack runs the same OIDC callback, session, KMS, encryption, migration and SSE code as production. Dex replaces Google and LocalStack replaces GCP Cloud KMS; the protocols and application code paths are the same. The default stack does not use fixture providers.

Run:

```sh
pnpm local:up
# Browse https://localhost (accept the local CA), sign in with
# test@beamling.local / beamling, then add real model and search provider keys.
pnpm local:down
```

PostgreSQL is exposed only on loopback `5433` for integration tests:
`DATABASE_URL=postgres://beamling:beamling@127.0.0.1:5433/beamling`.

`pnpm web:dev` remains available for a fast dev loop, but it is not the parity stack. Fixture providers are selected by `BEAMLING_FAKE_PROVIDERS=1`; Playwright uses them with the test-only `/api/auth/test-login` route.

## Image contract

The Dockerfile is multi-stage:

1. `deps`: Node 26 Alpine, pnpm installed with npm at the version in `package.json` `packageManager` (Node 26 no longer bundles corepack), install workspace dependencies with `--ignore-scripts`.
2. `build`: copy sources, build the mascot, run `next build` with standalone output.
3. `runner`: Node 26 Alpine with npm removed, non-root `beamling` user, standalone server, static assets, public assets, Drizzle migrations and both scripts.

Runtime environment includes:

```text
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
NEXT_TELEMETRY_DISABLED=1
NEXT_MANUAL_SIG_HANDLE=true
NODE_PATH=/app/node_modules/.pnpm/node_modules
```

The image applies Alpine security updates, removes npm from the runtime, exposes a `HEALTHCHECK` against `/api/health`, and runs as a non-root user.

## Migrations

`scripts/migrate.mjs`:

- `0000_init.sql` is the schema applied to the production database on 7 November 2026 (v0.3.0). Applied migration files are never edited: every schema change adds a new, higher-numbered file.
- Connects to `DATABASE_URL_DIRECT`, falling back to `DATABASE_URL`. It must not go through a transaction-mode pooler, because the advisory lock is session-scoped.
- Clears its own session timeouts, then takes a PostgreSQL advisory lock (`7314002917`) so concurrent deploys serialize.
- Creates `beamling_migrations` if absent.
- Reads `.sql` files from `drizzle/`, sorted by name.
- Applies each unapplied file in a transaction, splitting on `--> statement-breakpoint`.
- Records the filename only after a successful commit.
- Rolls back the failing file on error.
- Sets the application timeouts as defaults on the connecting role (`ALTER ROLE CURRENT_USER SET`): `statement_timeout` 15 s, `lock_timeout` 5 s, `idle_in_transaction_session_timeout` 30 s. This runs on every migration, so the values are restored if changed. The application and migrations must use the same database role.
- Releases the advisory lock and closes the client.

Migrations are a release step, not an app-start side effect. The local compose `migrate` service runs them before the app starts.

## Health and shutdown

- `/api/live` is a DB-free liveness probe returning `{ "ok": true }`.
- `/api/health` is cached readiness for five seconds: database `select 1`, the `beamling_migrations` table, and a KMS wrap/unwrap probe.
- Healthy: 200 `{ "ok": true, "database": "up", "schema": "up", "kms": "up", "version": "0.2.0", "commit": "...", "builtAt": "..." }`.
- Unhealthy: 503 with the failing component marked `down`; no error details are exposed.
- No authentication and no cache headers. `/status` renders the same readiness state for people.
- On `SIGTERM` or `SIGINT`, if `NEXT_MANUAL_SIG_HANDLE` is set, the process sets a global shutdown flag, rejects new `/api/chat` requests, aborts active chats, loops over late registrations, waits up to 8 seconds for outcomes, marks leftovers interrupted, closes the pg pool and exits.
- The Docker Compose grace period is 15 seconds; Cloud Run allows 10.

## Versioning and releases

- The root `package.json` version is the single source of truth; the web and mascot packages are kept in sync.
- `pnpm version` prints it, `pnpm version:set 0.2.0` updates all three package files, and `pnpm version:check v0.2.0` rejects a mismatched tag.
- `next.config.ts` injects `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_GIT_COMMIT` and `NEXT_PUBLIC_BUILD_TIME` at build time. `/api/health`, the landing footer and the sidebar show the same identity.
- On a green push to `main`, CI creates the annotated tag `v<version>` if it does not exist, builds the production image, pushes `ghcr.io/<repo>:v<version>` and `:latest`, records the registry digest and creates a GitHub release with generated notes.
- The deploy job deploys that digest to Cloud Run ([Google Cloud Run deployment](#google-cloud-run-deployment)), not a second source build, and runs a post-deploy `/api/health` smoke check.
- A new release requires a version bump. Pushing another commit without one leaves the existing tag and image untouched.

## Google Cloud Run deployment

Production runs on Cloud Run in `europe-west1` (Belgium), with Neon Postgres in Frankfurt and the Cloud KMS key in `europe-west3` (Frankfurt). `europe-west1` is used because Cloud Run custom-domain mapping is not available in `europe-west3`. All of it lives in the GCP project `beamling-prod`.

- **One-time setup:** `deploy/gcp/setup.sh` creates every Google Cloud resource and is safe to re-run. No service-account key exists; each identity holds only what it needs:

  | Identity | Used by | Permissions |
  |---|---|---|
  | `beamling-app` | Cloud Run service | `cloudkms.cryptoKeyEncrypterDecrypter` on the one key; `secretmanager.secretAccessor` on the six app secrets |
  | `beamling-migrate` | Cloud Run job `beamling-migrate` | `secretmanager.secretAccessor` on `DATABASE_URL_DIRECT` only |
  | `beamling-deploy` | GitHub Actions `deploy` job | `run.developer` on the project, `iam.serviceAccountUser` on the two accounts above and `artifactregistry.reader` on the `ghcr` proxy (Cloud Run checks the deployer can read the image); no IAM, secret or KMS rights |

- **Keyless deploys:** the `deploy` job exchanges GitHub's OIDC token through the Workload Identity pool `github` / provider `github-actions`. The provider's attribute condition accepts only the immutable repository and owner IDs, `refs/heads/main` and the `production` environment, and `beamling-deploy` can be impersonated only by identities with that repository ID (`principalSet://…/attribute.repository_id/1427513799`). The binding does not use the subject, whose format changes with GitHub's immutable-subject setting.
- **Key:** the KMS key rotates every 90 days, and destroyed versions are recoverable for 120 days. Rows store the key name, not a version, so decrypt works across rotations. Admin, read and write audit logs are enabled for Cloud KMS.
- **Secrets:** Secret Manager in `europe-west1` holds `DATABASE_URL`, `DATABASE_URL_DIRECT`, `AUTH_SECRET`, `OIDC_CLIENT_SECRET`, `KILL_SWITCH_SECRET` and `METRICS_SECRET` (`key: latest`, read when an instance starts). Values are added with `gcloud secrets versions add NAME --data-file=-`; neither the repository nor the setup script contains them.
- **Images:** the release job pushes to public GHCR. The Artifact Registry remote repository `ghcr` (`europe-west1`) proxies `ghcr.io`, so Cloud Run deploys the same digest as `europe-west1-docker.pkg.dev/beamling-prod/ghcr/<owner>/<repo>@sha256:…`. Its cleanup policy keeps the five most recent versions and deletes others after 30 days.
- **Topology:** `deploy/gcp/service.yaml` is the service definition:
  - Scaling: 0–2 instances. The maximum is the spend cap.
  - Billing and size: request-based billing (CPU only while a request or stream is in flight), startup CPU boost, 1 vCPU, 1 GiB.
  - Concurrency and timeout: 40 concurrent requests per instance (`PLATFORM_CONNECTION_LIMIT=40`) and a 420-second request timeout, covering Deeper's 360 s plus storing the outcome.
  - Probes: startup and liveness probes on the database-free `/api/live`.
  - Non-secret configuration, including `LEGAL_ENTITY`, `LEGAL_CONTACT_EMAIL` and `LEGAL_BACKUP_RETENTION_DAYS=1` (Neon Free keeps 6 hours of history), is in the file.
  - The deploy job fills in `${IMAGE}`, `${OIDC_CLIENT_ID}` (environment variable) and `${SIGNUP_ALLOWED_EMAILS}` (environment secret, so the list stays out of the repository and logs).
- **Deploy order:** when a new version tag is created and the repository variable `GCP_DEPLOY_ENABLED=true`, the `deploy` job (environment `production`):
  1. renders both manifests;
  2. applies `deploy/gcp/migrate-job.yaml` and runs it with `--wait`, so the job applies `scripts/migrate.mjs` over `DATABASE_URL_DIRECT` ([Migrations](#migrations)) and a failure stops the deploy;
  3. applies the service with `gcloud run services replace`, which waits for the new revision to become ready;
  4. smoke-tests `/api/health`.
  Deploys never change IAM; public access (`allUsers` → `run.invoker`) is granted once by the setup script.
- **GitHub settings:** environment `production` with variables `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` and `OIDC_CLIENT_ID`, and secret `SIGNUP_ALLOWED_EMAILS`; repository variables `GCP_DEPLOY_ENABLED` and optionally `PUBLIC_APP_URL` (smoke-test URL, default `https://beamling.app`). The GHCR package must be public.
- **Shutdown:** Cloud Run sends `SIGTERM` and allows 10 seconds; the server gives running answers 8 seconds to store their outcome ([Health and shutdown](#health-and-shutdown)).
- **Background work:** with request-based billing, an idle instance has no CPU, so the hourly cleanup ([Cleanup](conversations.md#cleanup)) runs only while the instance is serving.
- **Logs:** structured JSON on stdout carries `severity` for Cloud Logging. The `_Default` sink writes to the EU bucket `beamling-eu` (`europe-west1`, 30-day retention), matching the privacy notice's `LEGAL_LOG_RETENTION_DAYS=30`.
- **Spend:** the two-instance maximum, plus two budgets set up by `deploy/gcp/budgets.sh`:
  - **Native Cloud Run spend cap**, "Cloud Run spend cap (beamling-prod)" at €5. Google pauses new Cloud Run requests in `beamling-prod` when the month's gross list-price Cloud Run cost reaches €5. That cost is counted before the free allowance, so real charges are still near zero at that point.
    - All traffic-driven cost, including the KMS, secret and log use it causes, starts in Cloud Run.
    - Nothing is deleted, and other services keep running.
    - The cap lifts on the 1st of the month, or by hand from the budget page.
    - Enforcement lags actual use by hours, so a little usage past the cap is billed normally.
  - **Account email alert**, "Account monthly alert" at €5 across every project on the billing account. It emails the billing admins at 50%, 90%, 100% and when the forecast passes 100%. It only alerts; acting on it is manual.
- Neon Free has its own compute allowance; the watchdog's readiness probe runs hourly so the database can scale to zero.
- **Domain:** `beamling.app` is attached with Cloud Run domain mapping (Preview) to the `beamling` service, with Google-managed TLS. The domain must be verified in Search Console for the account that creates the mapping.
- Optional operator details: `LEGAL_ADDRESS` and `LEGAL_VAT_ID` (a VAT ID requires the address), and `SMTP_URL`, `MAIL_FROM` and `LEGAL_MAIL_PROVIDER` to email a shutdown notice, are added to `service.yaml` when needed.
- `APP_URL` is `https://beamling.app`; change it in `service.yaml` for another domain and register the matching Google OAuth callback.
- `GCP_KMS_CREDENTIALS` (a service-account JSON key) is still supported for hosts outside Google Cloud; production does not use it.

## Database pool

- One pool per process, reused across route handlers and instrumentation through `globalThis`.
- Default max 10 connections.
- Connection timeout 10 seconds.
- Statement timeout 15 seconds, lock timeout 5 seconds and idle-in-transaction timeout 30 seconds, applied as role defaults by `scripts/migrate.mjs` ([Migrations](#migrations)). They are not connection startup parameters, because a transaction-mode pooler rejects them (`unsupported startup parameter: statement_timeout`).
- Works through a transaction-mode pooler: the pool holds no session state, and the global stream cap uses a transaction-scoped advisory lock. The scheduled-shutdown worker opens its own connection to `DATABASE_URL_DIRECT` for its session-scoped lock.
- TLS is enabled only when `DATABASE_SSL=true`; CA and certificate verification are configurable. `DATABASE_SSL_CA_FILE` lets the parity stack and scripts read a mounted CA.

## Operational killswitch

- `system_flags` stores `accepting_new_streams`; a missing row means open, so a fresh database accepts streams.
- `POST /api/internal/kill` changes the flag with a Bearer `KILL_SWITCH_SECRET` and an optional reason. It never auto-re-enables.
- `/api/chat` reads the flag before parsing the question or starting work. When closed, it returns 503 `SERVICE_BUSY` with `Retry-After: 60`; existing streams are not aborted.
- `GET /api/internal/metrics` requires a Bearer `METRICS_SECRET` and returns the flag, active stream count, configured stream cap and build identity.
- `GET`/`POST /api/internal/shutdown` (Bearer `KILL_SWITCH_SECRET`) shows, schedules or cancels a service shutdown ([Scheduled shutdown](conversations.md#scheduled-shutdown), [Incident runbook](#incident-runbook)).
- A missing or short secret disables its endpoint (404) and logs a production startup warning. A wrong bearer token returns 401 and logs an `internal_auth_failed` audit event. The bearer is compared as SHA-256 digests with `timingSafeEqual`, so the comparison is constant-time and does not reveal the secret's length. None of these endpoints uses a session or the public read limiter.
- `.github/workflows/watchdog.yml` probes `/api/live` every five minutes and `/api/health` and `/` hourly. Failure notifies GitHub and, when `WATCHDOG_WEBHOOK_URL` is configured, an operator webhook.
- There is no bundled error-tracking service; Sentry/Better Stack remain operator choices.

## License inventory

- `scripts/licenses.mjs` reads `pnpm licenses list --prod --json`, strips local paths, evaluates SPDX expressions and writes `packages/web/lib/generated/licenses.json`.
- The script rejects any license outside `0BSD`, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MIT, MIT-0 and OFL-1.1. The only exception is `caniuse-lite` under CC-BY-4.0, recorded with its attribution in the generated data.
- Each package keeps its name, versions, license, homepage, copyright or NOTICE text. The page also renders one full license text per license expression.
- `pnpm licenses:check` fails CI when the committed inventory is stale or a dependency adds an unreviewed license.
- Sharp is excluded from optional dependencies and Next image optimization is disabled because the app does not use `next/image`; this keeps the LGPL libvips binary out of the production image.
- The landing, sign-in, welcome and legal pages share a small legal footer with Privacy, Terms, Cookies, Data processors, Security, Status, Contact and Licenses, and the line "Beamling is open source under the MIT License".
- Beamling itself is MIT-licensed: the root `LICENSE` file ("Copyright (c) 2026 Beamling contributors") and `"license": "MIT"` in the root, web and mascot `package.json` files.

## Production checklist

- `APP_URL` must be the public `https://` origin only, for example `https://beamling.example` (no path, query or trailing route). It is the anchor for same-origin checks, cookies and OIDC redirects.
- Do not expose the app container directly. The proxy must terminate TLS, overwrite client-supplied forwarding headers, append to `X-Forwarded-For`, and pass the original `Host`.
- Set `TRUSTED_PROXY_HOPS` to the exact proxy count. The server refuses a non-local deployment without it; without a trusted proxy, per-IP limits would trust a client-controlled header.
- Run `node scripts/migrate.mjs` before starting new instances; migrations are serialized with an advisory lock.
- On `SIGTERM` the server stores running answers as interrupted before exiting; allow it about 10 seconds.
- Accounts persist across Google sign-ins; expired sessions are deleted. Account data is removed by account deletion, after 24 months without a sign-in, or 7 days after creation when the terms were never accepted. Conversations are deleted 60 days after their last activity, and an account keeps at most 100 (the oldest unpinned ones are removed first).
- To close the service, set `SMTP_URL`, `MAIL_FROM` and `LEGAL_MAIL_PROVIDER`, then `POST /api/internal/shutdown` with the `KILL_SWITCH_SECRET` bearer and `{"action":"schedule","days":14}` (at least 14 days). Every account is emailed, sign-ups stop, and on the date every account is deleted; then destroy the KMS key so backups become unreadable. See the [incident runbook](#incident-runbook).
- Production uses GCP Cloud KMS. The env master key and `scripts/rewrap-credentials.mjs` are for local tests only.
- Enable database backups and platform log retention, and set `LEGAL_BACKUP_RETENTION_DAYS` (default 7) and `LEGAL_LOG_RETENTION_DAYS` (default 30) to the windows actually configured: the privacy notice states them. Add alerting on the watchdog and `/api/health`.
- Analytics is opt-in and off by default. Set `ANALYTICS_ENABLED=true` plus `POSTHOG_API_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` and a 32-byte `ANALYTICS_SALT` to send allowlisted metadata events to PostHog Cloud EU. `POSTHOG_HOST` defaults to the EU ingestion host; the personal key needs `person:write` so account deletion can remove the hashed person and its events. Set `ANALYTICS_ENABLED=false` to stop all events immediately.
- Set `LEGAL_ENTITY`, `LEGAL_ADDRESS` and `LEGAL_CONTACT_EMAIL` (optionally `LEGAL_VAT_ID`), have counsel review the implemented legal pages, and choose `SIGNUP_MODE=open` only after that review. Changing the terms or privacy notice materially means bumping `LEGAL_VERSION` in `packages/web/lib/legal.ts`, which asks every account to accept again.
- Before each release: `pnpm audit --prod`, a Gitleaks history scan, and a container scan of the built image. CI runs the production audit and Gitleaks automatically.

## Incident runbook

- **Sign-in outage:** check `/status`, then the OIDC issuer and Google OAuth client. A bad callback secret or a `503`/JSON error at `/api/auth/login` redirects to `/login?error=auth_unavailable`; the underlying cause is in the request log with its `requestId`.
- **Answer outage:** check `/api/health` (`database`, `schema`, `kms`) and the `answer_failed` rate by error code. Use the kill switch for a provider-wide failure; existing streams continue.
- **KMS or schema down:** health returns 503 with that component `down`. Do not bypass readiness or the migration checksum; restore the key/version or apply a new migration.
- **Database pressure:** check the active-stream count in `/api/internal/metrics`, the pool size and the Cloud Run concurrency and instance limits. Keep `MAX_CONCURRENT_CHATS` below `PLATFORM_CONNECTION_LIMIT`.
- **PostHog erasure failures:** query `analytics_erasures` ordered by `next_attempt_at`; failures are retried with backoff and logged after five attempts with a truncated distinct-id prefix.
- **Rollback:** list revisions with `gcloud run revisions list --service beamling --region europe-west1`, then send traffic back with `gcloud run services update-traffic beamling --region europe-west1 --to-revisions <revision>=100`. The next deploy routes traffic to its new revision again. Migrations are forward-only; restore from a backup if a schema change must be undone.
- **Shutting the service down:**
  1. Configure mail: set `SMTP_URL` (`smtps://` or `smtp://` with STARTTLS), `MAIL_FROM` and `LEGAL_MAIL_PROVIDER` (so `/subprocessors` names the provider), and deploy. `GET /api/internal/shutdown` reports `mailConfigured`.
  2. Schedule: `POST /api/internal/shutdown` with `Authorization: Bearer $KILL_SWITCH_SECRET` and `{ "action": "schedule", "days": 14, "reason": "..." }` (`days` at least 14). Without mail the call returns `MAIL_NOT_CONFIGURED`; `notify: false` schedules without email (banner only). Sign-ups stop and the banner appears at once; notices start immediately and the hourly cleanup job resumes them.
  3. Monitor `GET /api/internal/shutdown` until `notified` equals `accounts`; `Shutdown notice could not be sent` errors in the log mean SMTP failures, retried on the next tick. `{ "action": "cancel" }` stops everything before the date; rescheduling re-sends the notice to every account.
  4. After the date the cleanup job deletes every account (`shutdown_account_deleted` audit events, `Service shutdown deleted accounts` warning); wait until `accounts` is 0 and the PostHog erasure queue is empty.
  5. Destroy the KMS key (all versions). This crypto-shreds the wrapped workspace and credential keys, so content and keys in database backups become unreadable.
  6. Delete the GCP project `beamling-prod` (Cloud Run, secrets, logs, key ring), the Neon project and its backups, and the DNS records.
- **Watchdog:** `.github/workflows/watchdog.yml` probes `/api/live` every five minutes and the full readiness check (`/api/health`, landing page) hourly and on manual dispatch, so Neon can scale to zero between checks. Set `WATCHDOG_WEBHOOK_URL` for operator notification. Sentry/Better Stack are optional operator choices, not bundled dependencies.

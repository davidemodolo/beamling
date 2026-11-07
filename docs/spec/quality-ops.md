# Testing and operations

## Testing and QA

### Current suite

The current tests, their counts and what each file covers are listed in the [technical reference](../reference/tests.md).

Commands:

```sh
pnpm test
pnpm --filter @beamling/web typecheck
pnpm --filter @beamling/web lint
pnpm web:build
pnpm --filter @beamling/web test:e2e
```

Integration tests require `DATABASE_URL` pointing at a migrated database. Playwright requires a production build (`pnpm web:build`) and `E2E_DATABASE_URL` (or `DATABASE_URL`) pointing at a disposable migrated database.

### Target release gates

| Layer | Tool | Target scope |
|---|---|---|
| Google OIDC | Unit + integration | State/nonce/PKCE replay, wrong issuer/audience, unverified email, account upsert by `sub`, session revocation, sign-out, deletion |
| Local parity | Compose smoke + Playwright | Production image, HTTPS, secure `__Host-` cookie, Dex login, LocalStack KMS wrap/unwrap, Postgres TLS, migrations |
| Brave key metadata | Unit + integration + Playwright | Free 1 req/s across instances, Paid spacing, 80/100% budget warnings, 14/7/1-day expiry warnings, same-fingerprint replacement preserves usage |
| Analytics | Unit + integration | Event allowlist contains no content, keys or error messages; IP/GeoIP disabled; no events when disabled; deletion removes PostHog events |
| Legal and consent | Playwright + link checker | Legal routes, footer links, generated license page, CMP blocks non-essential scripts, Reject all, no banner when only essential cookies exist |
| Killswitch | Integration | Flag disables new streams, returns 503 with Retry-After, existing streams finish, watchdog re-enables only manually |
| Donations | Playwright + content check | Footer and `/support` link out, no payment script/iframe loads, chat is not interrupted, `/supporters` shows only consented entries and no amounts or emails |
| Encryption at rest | Node test runner + `pg_dump` | Raw dump contains no plaintext question/answer/source/title; cross-workspace decrypt fails; key rotation re-wraps; account deletion removes the workspace key |
| Security | Custom suite | Prompt injection, XSS, CSRF, key leakage, planner-output injection |
| Load | k6 | 100 concurrent streams, p95 latency, memory ceiling |
| Accessibility | axe-core | All routes, WCAG 2.2 AA; reduced-motion run |
| Evals | Custom harness | 100-question golden set, 50 Quick and 50 Deep |
| Provider contracts | Scheduled job | OpenRouter `GET /key` and a minimal search request for each enabled provider daily |

Evaluation methodology: each golden question has a reference answer and expected source domains. A judge model scores groundedness, citation correctness and refusal correctness on a 1–5 scale. Regressions greater than 2% block the release. Human review runs monthly on a 20-question sample. CI gates: typecheck, lint, unit tests, integration tests, E2E smoke, eval threshold and bundle-size budget.

---

## Deployment and Operations

**Current checkout:** `pnpm local:up` runs the production image behind Caddy with Dex OIDC, LocalStack KMS and TLS PostgreSQL; migrations are a separate release step; `/api/health` is the health check; `SIGTERM` stores partial answers before exit. `deploy/gcp/` (setup script, Cloud Run service and migration job) and a gated keyless CI deploy job are committed; production runs at https://beamling.app on Cloud Run and Neon since 7 November 2026 (v0.3.0), with sign-ups limited to an allowlist. `/licenses` is generated from the production dependency graph and checked in CI. A GitHub Actions watchdog probes liveness every 5 minutes and readiness hourly; Sentry, Better Stack and automatic stream disabling remain public-launch targets.

### Public launch stack (target)

| Layer | Public launch choice | Notes |
|---|---|---|
| Domain | **Dynadot**, `beamling.app` | ICANN-accredited registrar; `.app` requires HTTPS. Keep registrar lock, 2FA and auto-renew on. |
| DNS / TLS | Dynadot DNS, or Cloudflare DNS by choice; Google-managed certificates (Cloud Run domain mapping) | If Cloudflare is used, keep the app records DNS-only (grey cloud) during certificate issuance. |
| Compute | **Google Cloud Run** (`europe-west1`), Docker image | Scale to zero, request-based billing, fixed maximum instance count, 1 vCPU / 1 GiB, liveness probes and graceful shutdown. Domain mapping is not available in `europe-west3`. |
| Database | **Neon Postgres Launch**, EU region | Scale-to-zero after 5 minutes, max CU cap, pooled connection string for the app and a direct one for migrations, 7-day instant restore plus weekly logical dumps. |
| KMS | **GCP Cloud KMS**, one software master key | Per-workspace WDKs wrapped by the master key; deletion protection and rotation enabled. Use a restricted service account (`cloudkms.cryptoKeyEncrypterDecrypter`). Cloud Run runs as that service account, so no key file exists. |
| Analytics | **PostHog Cloud EU** | Server-side, metadata-only events; free plan or $0 billing limit. |
| Legal / consent | **Iubenda** default; Cookiebot free tier alternative | Only enabled when a non-essential script exists; no custom banner. |
| Open-source compliance | MIT `LICENSE`, generated `/licenses`, dependency allowlist | CI gate on dependency licenses; the application source is MIT-licensed. |
| Monitoring | **Sentry** for exceptions, **Better Stack** for uptime | Alert to email and a Slack/Discord webhook; Cloud Run and Neon for capacity. |
| CI/CD | GitHub Actions → Cloud Run via Workload Identity Federation (no stored deploy key) | Migrations as a Cloud Run job before the service update; runtime secrets in Secret Manager. |
| Backups | Neon instant restore + weekly `pg_dump` to S3-compatible storage | Test a restore before launch; the encryption dump test is a release gate. |
| Docs / feedback | Public source, docs and feedback repository | MIT-licensed source; public issue templates and private security disclosure. |
| Provider keys | User BYOK only | No operator OpenRouter, Brave, Tavily or Exa keys in production. |
| Donations | Tipeee primary; PayPal.me fallback | Outbound links only; no embedded widget, webhook or payment data. `/supporters` is a static, opt-in list. |

### Operations (target)

- **CI/CD:** GitHub Actions. Preview deploy per pull request. Production deploy on tagged release.
- **Migrations:** forward-only, reviewed, applied before deploy with `node scripts/migrate.mjs`. No destructive migration without a backfill plan. The public-launch migration must encrypt any existing plaintext content ([Workspace data encryption (public-launch target)](keys.md#workspace-data-encryption-public-launch-target)) and verify that a raw database dump contains no readable user content; this is a release gate.
- **Encryption at rest:** per-workspace content encryption ([Workspace data encryption (public-launch target)](keys.md#workspace-data-encryption-public-launch-target)) is live and the production deployment must use GCP KMS; the launch dump/backup check must pass.
- **Backups:** managed database backups with point-in-time recovery where available, 30-day window. Quarterly restore drill.
- **Secrets:** platform secret store only. No secrets in the repository or build logs. Public launch requires `DATABASE_URL`, `DATABASE_URL_DIRECT`, `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `KMS_PROVIDER=gcp`, `KMS_KEY_NAME` plus a restricted GCP service account (the Cloud Run identity; `GCP_KMS_CREDENTIALS` only off Google Cloud), `POSTHOG_API_KEY`, `POSTHOG_HOST`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `ANALYTICS_SALT`, `KILL_SWITCH_SECRET`, `METRICS_SECRET`, `LEGAL_ENTITY` and `LEGAL_CONTACT_EMAIL` (optionally `LEGAL_ADDRESS` and `LEGAL_VAT_ID`, the address being required with a VAT ID, `LEGAL_LOG_RETENTION_DAYS`, `LEGAL_BACKUP_RETENTION_DAYS`, and `SMTP_URL`, `MAIL_FROM` and `LEGAL_MAIL_PROVIDER` to email a shutdown notice). Local development may use the AWS/LocalStack KMS adapter; `CREDENTIAL_MASTER_KEY` is test-only.
- **Analytics:** PostHog Cloud EU, server-side only. Environment: `POSTHOG_API_KEY`, `POSTHOG_HOST`, `POSTHOG_APP_HOST` (optional), `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `ANALYTICS_SALT`; `ANALYTICS_ENABLED=true` is the opt-in and `false` is the kill switch. The personal key needs `person:write` for account-deletion cleanup. Keep the project on the free plan or a $0 billing limit; no browser SDK, autocapture or session replay.
- **Legal and consent:** publish reviewed Privacy/Terms/Cookie Policy/Subprocessors/Security pages; configure Iubenda (default) or Cookiebot only if non-essential scripts exist; add CMP domains to CSP; generate `/licenses` in CI; run the footer link checker.
- **Public docs and feedback:** The source and product docs are published in a public repository under the MIT License, with GitHub issue templates for bugs and feature requests and a private security disclosure path.
- **Status page:** public availability and provider incident feed (v1).
- **Runbooks:** OpenRouter outage, search-provider outage (Brave, Tavily or Exa), master key failure, database failover, credential leak, abuse spike, cost anomaly.
- **Portability:** the same Docker image runs on Cloud Run, Railway, Render, Fly.io or a Docker Compose VM. A migration runbook covers moving between hosting providers.
- **SLOs:** 99.9% API availability; Quick p95 time to first token under 3 seconds; Deep p95 first progress under 1 second; error budget policy at 10% consumption.

### Spend guardrails, alerts and killswitch (target)

**Hard caps**

- Cloud Run maximum instance count (2 at launch); Cloud Run never starts more.
- Per-machine concurrency `hard_limit`; the total is roughly machine count × per-machine limit.
- App-level global active-stream cap and per-IP/per-account rate limits.
- Neon maximum CU cap and scale-to-zero enabled.
- Maximum request body, request timeout and maximum search-request budgets.
- No operator LLM or search keys, so the expensive variable cost is user-paid.
- Analytics kill switch (`ANALYTICS_ENABLED`) so a traffic spike cannot create a PostHog bill.
- Retention jobs bound database growth.

**Alerts**

- Better Stack: uptime check on `/api/health` and the welcome page, email plus Slack/Discord webhook.
- Sentry: new issue, 5xx spike and release regression.
- Neon: 80% and 100% spending notifications; monitor CU usage.
- Google Cloud: a native spend cap that pauses Cloud Run at €5 of monthly list-price usage (nothing deleted, resets monthly), an account-wide €5 email alert, and the fixed instance count. Target: total spend under €10 a month.
- GCP: budget alert for the KMS key.
- PostHog: activation, error-rate and event-volume anomalies.
- A daily cost check is enough at alpha scale; review before raising machine or CU caps.

**Killswitch**

- Store `system_flags.accepting_new_streams` in Postgres so every instance sees the same state.
- `/api/chat` checks the flag before starting a stream. If disabled, return `503` with `Retry-After` and a friendly "Beamling is briefly at capacity" message. Existing streams finish; do not kill them.
- Protect `POST /api/internal/kill` and `GET /api/internal/metrics` with `KILL_SWITCH_SECRET` and `METRICS_SECRET`. Do not expose them in the UI.
- **Current checkout:** the database flag, `/api/chat` gate, `POST /api/internal/kill` and `GET /api/internal/metrics` are implemented; an availability watchdog (probes only) runs; metric-driven stream disabling and external alerting remain target work.
- A GitHub Actions watchdog runs every 5 minutes, reads aggregate metrics, and disables new streams when thresholds are breached: 5xx rate above 10% over 5 minutes, active streams at the cap for two checks, provider failure rate above 25%, Neon CU at its cap for 10 minutes, or a login-failure spike.
- Do not auto-re-enable. A human reviews the cause and re-enables the flag. Do not scale machines to zero as a killswitch: users get network errors and no explanation.
- Test the killswitch in staging before launch: flag flips, `/api/chat` returns 503, existing streams finish, and the alert fires.

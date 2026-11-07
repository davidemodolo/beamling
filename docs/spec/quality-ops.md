# Testing and operations

## Testing and QA

### Current suite

See [Tests](../reference/tests.md) for files and coverage, and [Development](../development.md#tests-and-checks) for how to run them.

```sh
pnpm test
pnpm --filter @beamling/web typecheck
pnpm --filter @beamling/web lint
pnpm web:build
pnpm --filter @beamling/web test:e2e
```

Integration tests need `DATABASE_URL` on a migrated database. Playwright needs `pnpm web:build` and `E2E_DATABASE_URL` (or `DATABASE_URL`) on a disposable migrated database.

### Target release gates

| Layer | Tool | Target scope |
|---|---|---|
| Google OIDC | Unit + integration | State/nonce/PKCE replay, wrong issuer/audience, unverified email, upsert by `sub`, session revocation, sign-out, deletion |
| Local parity | Compose smoke + Playwright | Production image, HTTPS, `__Host-` cookie, Dex login, LocalStack KMS, Postgres TLS, migrations |
| Brave key metadata | Unit + integration + Playwright | FR-61–FR-64 |
| Analytics | Unit + integration | FR-52; deletion removes PostHog events |
| Legal and consent | Playwright + link checker | Legal routes, footer links, license page, CMP blocks non-essential scripts, Reject all, no banner with only essential cookies |
| Killswitch | Integration | Flag blocks new streams with 503 + Retry-After, existing streams finish, manual re-enable only |
| Donations | Playwright + content check | FR-58, FR-59 |
| Encryption at rest | Node test runner + `pg_dump` | Tests in [Migration and verification](keys.md#workspace-data-encryption-public-launch-target) |
| Security | Custom suite | Prompt injection, XSS, CSRF, key leakage, planner-output injection |
| Load | k6 | 100 concurrent streams, p95 latency, memory ceiling |
| Accessibility | axe-core | All routes, WCAG 2.2 AA, reduced motion |
| Evals | Custom harness | 100-question golden set (50 Quick, 50 Deep) |
| Provider contracts | Daily scheduled job | OpenRouter `GET /key` and a minimal search per enabled provider |

Evals: each golden question has a reference answer and expected domains. A judge model scores groundedness, citation and refusal correctness (1–5). Regressions over 2% block release. Monthly human review of 20 questions. CI gates: typecheck, lint, unit, integration, E2E smoke, eval threshold, bundle-size budget.

---

## Deployment and Operations

**Current checkout:** production runs at https://beamling.app on Cloud Run and Neon since 7 November 2026 (v0.3.0), sign-ups allowlisted. `deploy/gcp/` and a gated keyless CI deploy are committed; a GitHub Actions watchdog probes liveness every 5 minutes and readiness hourly. Details: [Deployment and operations](../reference/operations.md). Sentry, Better Stack and automatic stream disabling are public-launch targets.

### Public launch stack (target)

| Layer | Choice | Notes |
|---|---|---|
| Domain | **Dynadot**, `beamling.app` | Registrar lock, 2FA, auto-renew. |
| DNS / TLS | Dynadot DNS (or Cloudflare); Google-managed certificates via domain mapping | Cloudflare records DNS-only during issuance. |
| Compute | **Cloud Run** (`europe-west1`) | Scale to zero, fixed max instances, 1 vCPU / 1 GiB, liveness probes, graceful shutdown. (No domain mapping in `europe-west3`.) |
| Database | **Neon Launch**, EU | Scale-to-zero after 5 min, max CU cap, pooled URL for app, direct for migrations, 7-day restore + weekly dumps. |
| KMS | **GCP Cloud KMS**, one software master key | Wraps WDKs; deletion protection and rotation on. Cloud Run runs as a restricted service account (`cloudkms.cryptoKeyEncrypterDecrypter`), so no key file. |
| Analytics | **PostHog Cloud EU** | Server-side metadata; free plan or $0 limit. |
| Legal / consent | **Iubenda** default; Cookiebot alternative | Only when a non-essential script exists. |
| Open-source compliance | MIT `LICENSE`, generated `/licenses`, license allowlist | CI gate. |
| Monitoring | **Sentry** (exceptions), **Better Stack** (uptime) | Email + Slack/Discord webhook. |
| CI/CD | GitHub Actions → Cloud Run via Workload Identity Federation | Migration job before service update; secrets in Secret Manager. |
| Backups | Neon restore + weekly `pg_dump` to S3-compatible storage | Test a restore before launch; encryption dump test is a release gate. |
| Provider keys | BYOK only | No operator OpenRouter, Brave, Tavily or Exa keys. |
| Donations | Tipeee, PayPal.me fallback | Outbound only; static opt-in `/supporters`. |

### Operations (target)

- **CI/CD:** preview deploy per PR; production on tagged release.
- **Migrations:** forward-only, reviewed, applied before deploy with `node scripts/migrate.mjs`; no destructive change without a backfill plan. The launch migration encrypts any plaintext ([Workspace data encryption](keys.md#workspace-data-encryption-public-launch-target)) and the raw-dump check is a release gate.
- **Encryption at rest:** live ([Workspace data encryption](keys.md#workspace-data-encryption-public-launch-target)); production uses GCP KMS.
- **Backups:** PITR where available, 30-day window, quarterly restore drill.
- **Secrets:** platform secret store only; never in the repo or build logs. Public launch needs `DATABASE_URL`, `DATABASE_URL_DIRECT`, `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `KMS_PROVIDER=gcp`, `KMS_KEY_NAME` + a restricted service account (`GCP_KMS_CREDENTIALS` only off Google Cloud), `POSTHOG_API_KEY`, `POSTHOG_HOST`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `ANALYTICS_SALT`, `KILL_SWITCH_SECRET`, `METRICS_SECRET`, `LEGAL_ENTITY`, `LEGAL_CONTACT_EMAIL`. Optional: `LEGAL_ADDRESS` and `LEGAL_VAT_ID` (address required with a VAT ID), `LEGAL_LOG_RETENTION_DAYS`, `LEGAL_BACKUP_RETENTION_DAYS`, and `SMTP_URL`, `MAIL_FROM`, `LEGAL_MAIL_PROVIDER` for the shutdown notice. Local may use AWS/LocalStack KMS; `CREDENTIAL_MASTER_KEY` is test-only.
- **Analytics:** server-side PostHog EU; optional `POSTHOG_APP_HOST`; `POSTHOG_PERSONAL_API_KEY` needs `person:write` for deletion cleanup. `ANALYTICS_ENABLED=true` opts in; `false` is the kill switch.
- **Legal and consent:** publish reviewed legal pages; enable a CMP only for non-essential scripts and add its domains to CSP; generate `/licenses` and check footer links in CI.
- **Public repo:** MIT source and docs, bug/feature issue templates, private security disclosure.
- **Status page:** availability and provider incidents (v1).
- **Runbooks:** OpenRouter outage, search-provider outage, master key failure, database failover, credential leak, abuse spike, cost anomaly.
- **Portability:** the same image runs on Cloud Run, Railway, Render, Fly.io or a Compose VM; a runbook covers moving.
- **SLOs:** 99.9% API availability; Quick p95 first token < 3 s; Deep p95 first progress < 1 s; error-budget policy at 10% consumption.

### Spend guardrails, alerts and killswitch (target)

**Hard caps**

- Cloud Run max instances (2 at launch).
- Per-machine concurrency `hard_limit` (total ≈ machines × limit).
- Global active-stream cap and per-IP/per-account rate limits.
- Neon max CU cap, scale-to-zero on.
- Max request body, request timeout and search-request budgets.
- No operator LLM or search keys: variable cost is user-paid.
- `ANALYTICS_ENABLED` kill switch against a PostHog bill.
- Retention jobs bound database growth.

**Alerts**

- Better Stack: uptime on `/api/health` and the welcome page, email + webhook.
- Sentry: new issue, 5xx spike, release regression.
- Neon: 80% and 100% spend notifications; watch CU.
- Google Cloud: spend cap that pauses Cloud Run at €5/month list price (nothing deleted, monthly reset), €5 account email alert, fixed instance count. Target: total under €10/month.
- GCP: KMS key budget alert.
- PostHog: activation, error-rate and event-volume anomalies.
- A daily cost check is enough at alpha scale; review before raising caps.

**Killswitch**

- `system_flags.accepting_new_streams` in Postgres, shared by all instances.
- `/api/chat` checks it first; if off, `503` with `Retry-After` and "Beamling is briefly at capacity". Existing streams finish.
- `POST /api/internal/kill` and `GET /api/internal/metrics` require `KILL_SWITCH_SECRET` / `METRICS_SECRET`; not in the UI.
- **Current checkout:** flag, `/api/chat` gate, both internal routes and a probe-only watchdog are implemented. Metric-driven disabling and external alerts are target.
- Target watchdog (every 5 min) disables new streams on: 5xx > 10% over 5 min, active streams at cap for two checks, provider failures > 25%, Neon CU at cap for 10 min, or a login-failure spike.
- Never auto-re-enable; a human reviews and re-enables. Don't scale to zero as a killswitch (users get unexplained network errors).
- Test in staging before launch: flag flips, 503 returned, existing streams finish, alert fires.

# Architecture

## Scope of this architecture

This section describes the **entire project**, not only the frontend. Alpha 1 is a single Next.js application that contains the UI, HTTP API and answer pipeline. There is no separate backend service and no client-side orchestration.

Alpha 1 is Docker-first and PostgreSQL-only. The same container image runs locally through Docker Compose and in production on Google Cloud Run with Neon Postgres. There is no platform-specific database or serverless adapter.

**Current checkout:** production-parity Docker Compose with Caddy TLS, Dex OIDC, LocalStack KMS, TLS PostgreSQL 18, the production image, structured logs and `/api/health`. The KMS adapters support GCP (production) and AWS/LocalStack (local). Cloud Run (`deploy/gcp/`), Neon, Sentry and Better Stack are target infrastructure; no application code depends on them today. PostHog is implemented as an optional, opt-in integration.

## Alpha 1 stack (target)

| Layer | Choice | Notes |
|---|---|---|
| Application | Next.js 16.4, React 19.3, TypeScript 6 | Current repository; UI and API in one deployable unit |
| Styling | Tailwind CSS 4.3 plus the existing custom CSS | No UI-kit requirement; keep the current accessible components |
| Runtime | Node.js 26 LTS | Long-lived SSE, AES-256-GCM and standard Node APIs |
| Database | PostgreSQL 18 | Neon Postgres (EU region); local Postgres 18 in Docker Compose |
| ORM | Drizzle ORM | Typed schema, versioned migrations |
| Cache and limits | Database-backed limits at launch | No Redis |
| Auth | Google OIDC + Drizzle sessions | Google-only sign-in; opaque token cookie, hashed at rest. No passwords or guest workspaces |
| Email | Google identity email | Stored for account display and legal contact; no Beamling-sent verification or marketing email; optional SMTP relay sends only the service-shutdown notice |
| Payments | None at launch | Added only when monetization starts |
| Object storage | None in Alpha 1 | Exports are generated on demand; no uploads |
| Cryptography | AES-256-GCM envelope encryption with KMS-wrapped keys | Current: GCP/AWS/env KMS adapters, per-account workspace content keys. Production: GCP Cloud KMS |
| LLM | OpenRouter Chat Completions, streaming | One adapter, no direct-provider adapters |
| Search | Brave, Tavily or Exa | Provider adapter per answer; snippets only; no Beamling page fetcher |
| Container | Multi-stage Dockerfile, Next standalone output | Non-root runtime, healthcheck, no secrets in the image |
| Observability | Structured logs now; Sentry and Better Stack target | Cloud Run/Neon metrics and PostHog usage analytics; no content in logs |
| Analytics | PostHog Cloud EU, server-side (target) | Metadata-only product events; no content or keys; free tier. The checkout implements the event contract, opt-in kill switch and deletion hook |

## Chat request path

1. The browser sends `POST /api/chat` with a session cookie and an abort signal.
2. The route handler authenticates the user and loads the conversation.
3. The handler resolves the OpenRouter credential and the credential for the selected search provider, decrypts them in memory, and starts the pipeline.
4. The handler returns an SSE stream with events `meta`, `stage`, `plan`, `progress`, `sources`, `delta`, `citation`, `usage`, `done`, or `error`.
5. Quick runs one search on the selected provider. Deep runs the planner, 3–5 searches with concurrency 2, then an optional gap pass of at most two searches.
6. The selected provider returns ranked results. The server normalizes, deduplicates, trims and numbers them; it does not fetch pages.
7. OpenRouter streams deltas. The handler forwards them, accumulates the full text and parses citation markers.
8. On completion, the handler persists the resolved model, selected search provider, sources, usage, generation cost, search request count, search cost and final status.
9. The abort signal cancels Beamling's pending search requests on the selected provider and the OpenRouter stream, then marks the message as stopped. Provider cancellation is upstream-dependent, so the UI must not promise that stopping guarantees zero provider billing.

## Environments

| Environment | Purpose | Identity | Database and crypto | Providers |
|---|---|---|---|---|
| Local parity | Development and manual testing against production code paths | Local Dex OIDC provider through the same OIDC client; Google only in production | PostgreSQL 18 with TLS, LocalStack KMS, production Docker image, Caddy TLS | Real user keys only; fixture providers only in an explicit test profile |
| Preview | Pull request checks | Google test client or Dex | Preview Postgres + LocalStack KMS | Fixture adapters, optional sandbox keys |
| Production | Live users | Google OIDC | Neon Postgres with PITR and weekly dumps + GCP Cloud KMS | Real user keys only |

The local parity stack is **not** a simplified dev server. It runs the same standalone image, `NODE_ENV=production`, secure cookies, the real OIDC callback code, the real KMS envelope code, TLS to PostgreSQL and real migrations. Only the external vendors are substituted: Dex stands in for Google and LocalStack KMS stands in for GCP KMS. The app-facing protocols and code paths are the same.

## Streaming and limits

- SSE heartbeat every 15 seconds to keep proxies open.
- The chat route runs on Node.js 26 and uses web-standard streams for SSE.
- Quick mode maximum duration: 60 seconds. Deep mode: 90 seconds. Deeper mode: 360 seconds.
- One active generation per conversation; the current code rejects a second request with `GENERATION_IN_PROGRESS` (409) rather than cancelling the first.
- Global concurrency cap protects provider quota and server memory. With more than one instance, use a database-backed atomic counter or the host's native limiter; do not rely on process memory alone.
- Per-user and per-IP limits are keyed by hashed identifiers and stored in `rate_limits` or a platform equivalent.
- No sticky sessions. Each SSE connection stays on one instance for its lifetime; all durable state lives in the database.
- Alpha 1 Deep and Deeper run synchronously in the chat request. There is no queue or background worker; Deep stops after 90 seconds and Deeper after 360 seconds, keeping any partial text.

## Deployment targets

| Target | Model | Notes |
|---|---|---|
| **Google Cloud Run + Neon** | Docker image + scale-to-zero Postgres | **Public launch default.** Scale-to-zero compute and DB on free allowances; keyless KMS and deploy identities; custom domain/TLS via domain mapping |
| Railway | Docker image + managed PostgreSQL | Fallback; simpler but not scale-to-zero |
| Render | Docker image + managed PostgreSQL | Equivalent fallback |
| Hetzner or similar | Docker Compose or Dokploy | Cheapest steady state, more operations |
| AWS | ECS Fargate + RDS | Only when a concrete compliance or scale requirement appears |

Decision rule: use Google Cloud Run for compute and Neon for Postgres at public launch. Everything must run from the Docker image plus PostgreSQL; no platform-specific runtime APIs, no Redis and no queue. Fly.io, Railway and Render remain fallbacks.

## Container contract

- `Dockerfile` is multi-stage: install workspace dependencies, build the mascot package and Next.js, then run the standalone output as a non-root user.
- `next.config.ts` must set `output: "standalone"`.
- `docker-compose.yml` starts the production-parity stack: Caddy TLS, the app image, PostgreSQL 18 with TLS, Dex OIDC, LocalStack KMS and a one-shot migrator.
- The image must not contain `.env` files, API keys or build-time user credentials.
- Current environment: `DATABASE_URL` and TLS options, `APP_URL`, `AUTH_SECRET`, `OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`/`OIDC_REDIRECT_URI`, `KMS_PROVIDER` plus the selected KMS key settings, `PORT`, `TRUSTED_PROXY_HOPS`, `MAX_CONCURRENT_CHATS`, `BRAVE_MIN_INTERVAL_MS`/`BRAVE_PAID_MIN_INTERVAL_MS`, `COOKIE_SECURE` and the fixture-provider switches. The env KMS adapter additionally uses `CREDENTIAL_MASTER_KEY` and rotation variables.
- Target public-launch additions: `POSTHOG_API_KEY`, `POSTHOG_HOST`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `ANALYTICS_SALT`, `KILL_SWITCH_SECRET` and `METRICS_SECRET`. `POSTHOG_APP_HOST` is optional.
- The image exposes a health endpoint and a Docker `HEALTHCHECK`.
- Database migrations run as a release step, not automatically on every container start.
- The Docker build must include `packages/web` and `packages/mascot` because the app depends on the workspace package.

## Local production-parity stack

The default `docker compose up --build` must exercise the production code paths. It includes:

| Service | Role | Production equivalent |
|---|---|---|
| `caddy` | HTTPS on `https://localhost`, reverse proxy, `X-Forwarded-*`, local CA | Google front end (TLS, `X-Forwarded-For`) |
| `app` | The standalone production image, `NODE_ENV=production` | Cloud Run service |
| `migrate` | One-shot `node scripts/migrate.mjs` | Release command |
| `db` | PostgreSQL 18 with TLS required and a local CA | Neon Postgres |
| `dex` | Local OIDC issuer with a seeded test account | Google OIDC |
| `kms` | LocalStack KMS with a pre-created symmetric key | GCP Cloud KMS |

Requirements:

- No `BEAMLING_FAKE_PROVIDERS` in the default profile. Fixtures live in a separate test profile used by automated tests.
- Login goes through the real `/api/auth/login` → OIDC → `/api/auth/callback/google` flow. Dex is configured as a generic OIDC issuer; production sets the Google issuer.
- Credential and content encryption call the real KMS adapter. Local uses the AWS KMS API against LocalStack; production uses GCP Cloud KMS. Both wrap/unwrap workspace keys through the same interface.
- PostgreSQL connections use TLS with a mounted CA; the app verifies it.
- Cookies are `Secure` and `__Host-` because the local URL is HTTPS.
- The parity stack uses the same standalone image and migration files as production, not `next dev`.
- A `pnpm local:up` / `pnpm local:down` pair wraps Compose. A separate `pnpm dev` path may use the dev server, but it is not the parity environment.
- The stack must expose enough seeded identity to log in without Google. The seeded local account is test-only and must never be enabled in production.

## Stateless rules

- Application instances hold no durable state and write no local files.
- The database is the only source of truth for users, sessions, conversations, messages, sources, credentials and usage.
- No in-memory job queues. Alpha 1 Deep is synchronous; background jobs are post-alpha.
- Handlers are idempotent where possible and safe to retry.
- Any instance can serve any request. Sessions live in the database, not in memory.
- Configuration comes from environment variables only.

# Architecture

## Scope of this architecture

The whole project. Alpha 1 is one Next.js app holding UI, HTTP API and answer pipeline: no separate backend, no client-side orchestration.

Docker-first and PostgreSQL-only. The same image runs in Docker Compose locally and on Google Cloud Run with Neon in production. No platform-specific database or serverless adapter.

**Current checkout:** parity Compose stack (Caddy TLS, Dex OIDC, LocalStack KMS, TLS PostgreSQL 18, production image), structured logs, `/api/health`, GCP and AWS/LocalStack KMS adapters, optional opt-in PostHog. Cloud Run (`deploy/gcp/`), Neon, Sentry and Better Stack are target; no code depends on them.

## Alpha 1 stack (target)

| Layer | Choice | Notes |
|---|---|---|
| Application | Next.js 16.4, React 19.3, TypeScript 6 | UI and API in one unit |
| Styling | Tailwind CSS 4.3 + existing custom CSS | No UI kit |
| Runtime | Node.js 26 LTS | Long-lived SSE, AES-256-GCM |
| Database | PostgreSQL 18 | Neon (EU); Postgres 18 in Compose |
| ORM | Drizzle ORM | Typed schema, versioned migrations |
| Cache and limits | Database-backed | No Redis |
| Auth | Google OIDC + Drizzle sessions | Google only; opaque cookie token, hashed. No passwords or guests |
| Email | Google identity email | For display and legal contact. No Beamling email except the optional SMTP shutdown notice |
| Payments | None at launch | Only when monetization starts |
| Object storage | None | Exports on demand; no uploads |
| Cryptography | AES-256-GCM envelopes, KMS-wrapped keys | GCP/AWS/env adapters, per-account content keys. Production: GCP Cloud KMS |
| LLM | OpenRouter Chat Completions, streaming | One adapter |
| Search | Brave, Tavily or Exa | One provider per answer; snippets only; no page fetcher |
| Container | Multi-stage Dockerfile, Next standalone | Non-root, healthcheck, no secrets |
| Observability | Structured logs; Sentry and Better Stack target | Cloud Run/Neon metrics; no content in logs |
| Analytics | PostHog Cloud EU, server-side (target) | Metadata only. Event contract, opt-in kill switch and deletion hook implemented |

## Chat request path

1. Browser sends `POST /api/chat` with session cookie and abort signal.
2. Handler authenticates and loads the conversation.
3. It decrypts the OpenRouter and selected search credentials in memory and starts the pipeline.
4. It returns SSE: `meta`, `stage`, `plan`, `progress`, `sources`, `delta`, `citation`, `usage`, `done`, `error` ([Streaming protocol](../reference/streaming.md)).
5. Quick: one search. Deep: planner, 3–5 searches at concurrency 2, optional gap pass of at most two.
6. Results are normalized, deduplicated, trimmed and numbered; no page fetching.
7. OpenRouter deltas are forwarded, accumulated and parsed for citations.
8. On completion it persists resolved model, search provider, sources, usage, generation cost, search request count, search cost and status.
9. Abort cancels pending searches and the OpenRouter stream and marks the message stopped. Provider cancellation is upstream-dependent; never promise zero billing.

## Environments

| Environment | Purpose | Identity | Database and crypto | Providers |
|---|---|---|---|---|
| Local parity | Dev and manual testing on production paths | Dex via the same OIDC client | TLS PostgreSQL 18, LocalStack KMS, production image, Caddy TLS | Real user keys; fixtures only in a test profile |
| Preview | PR checks | Google test client or Dex | Preview Postgres + LocalStack KMS | Fixtures, optional sandbox keys |
| Production | Live users | Google OIDC | Neon (PITR, weekly dumps) + GCP Cloud KMS | Real user keys |

Local parity is **not** a simplified dev server: same image, `NODE_ENV=production`, secure cookies, real OIDC callback, real KMS envelope code, TLS to PostgreSQL, real migrations. Only vendors are swapped (Dex for Google, LocalStack for GCP KMS).

## Streaming and limits

- SSE heartbeat every 15 seconds; web-standard streams on Node.js 26.
- Max duration: Quick 60 s, Deep 90 s, Deeper 360 s. Deep and Deeper run synchronously in the request (no queue) and keep partial text on timeout.
- One active generation per conversation; a second request gets `GENERATION_IN_PROGRESS` (409).
- Global concurrency cap. With several instances, use a database-backed atomic counter or the host limiter, not process memory.
- Per-user and per-IP limits use hashed keys in `rate_limits` or equivalent.
- No sticky sessions; an SSE connection stays on one instance; durable state is in the database.

## Deployment targets

| Target | Model | Notes |
|---|---|---|
| **Google Cloud Run + Neon** | Docker image + scale-to-zero Postgres | **Public launch default.** Free allowances, keyless KMS and deploy identities, domain mapping for TLS |
| Railway | Docker + managed PostgreSQL | Fallback; not scale-to-zero |
| Render | Docker + managed PostgreSQL | Equivalent fallback |
| Hetzner or similar | Compose or Dokploy | Cheapest steady state, more ops |
| AWS | ECS Fargate + RDS | Only for a concrete compliance or scale need |

Decision: Cloud Run + Neon at launch. Everything runs from the image plus PostgreSQL: no platform runtime APIs, Redis or queue. Fly.io, Railway and Render are fallbacks.

## Container contract

- Multi-stage `Dockerfile`: install workspace deps, build `packages/mascot` and Next.js (both packages in the build), run standalone output as non-root.
- `next.config.ts` sets `output: "standalone"`.
- `docker-compose.yml` starts Caddy TLS, the app, TLS PostgreSQL 18, Dex, LocalStack KMS and a one-shot migrator.
- No `.env` files, API keys or user credentials in the image.
- Health endpoint and Docker `HEALTHCHECK`.
- Migrations run as a release step, not on container start.
- Current env ([Runtime configuration](../reference/configuration.md)): `DATABASE_URL` + TLS options, `APP_URL`, `AUTH_SECRET`, `OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`/`OIDC_REDIRECT_URI`, `KMS_PROVIDER` + KMS key settings, `PORT`, `TRUSTED_PROXY_HOPS`, `MAX_CONCURRENT_CHATS`, `BRAVE_MIN_INTERVAL_MS`/`BRAVE_PAID_MIN_INTERVAL_MS`, `COOKIE_SECURE`, fixture switches; env KMS adds `CREDENTIAL_MASTER_KEY` and rotation variables.
- Public-launch additions: `POSTHOG_API_KEY`, `POSTHOG_HOST`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `ANALYTICS_SALT`, `KILL_SWITCH_SECRET`, `METRICS_SECRET`; optional `POSTHOG_APP_HOST`.

## Local production-parity stack

`docker compose up --build` exercises production code paths:

| Service | Role | Production equivalent |
|---|---|---|
| `caddy` | HTTPS on `https://localhost`, reverse proxy, `X-Forwarded-*`, local CA | Google front end |
| `app` | Standalone image, `NODE_ENV=production` | Cloud Run service |
| `migrate` | One-shot `node scripts/migrate.mjs` | Release command |
| `db` | PostgreSQL 18, TLS required, local CA | Neon |
| `dex` | OIDC issuer with a seeded test account | Google OIDC |
| `kms` | LocalStack KMS with a symmetric key | GCP Cloud KMS |

- No `BEAMLING_FAKE_PROVIDERS` by default; fixtures only in the automated test profile.
- Login uses the real `/api/auth/login` → OIDC → `/api/auth/callback/google` flow, with Dex as a generic issuer.
- Encryption uses the real KMS adapter (AWS API on LocalStack locally, GCP in production), same interface.
- PostgreSQL TLS with a mounted CA the app verifies.
- `Secure`, `__Host-` cookies (local URL is HTTPS).
- Same image and migrations as production, not `next dev`. `pnpm local:up` / `pnpm local:down` wrap Compose; `pnpm dev` is not parity.
- The seeded Dex account is test-only, never enabled in production.

## Stateless rules

- Instances hold no durable state and write no local files.
- The database is the only source of truth; sessions live there.
- No in-memory job queues; background jobs are post-alpha.
- Handlers are idempotent where possible and safe to retry.
- Any instance serves any request.
- Configuration comes only from environment variables.

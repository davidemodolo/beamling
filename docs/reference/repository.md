# Repository and build

```text
.
├─ packages/web/                  Next.js application
│  ├─ app/                        Pages and route handlers
│  ├─ components/                 React UI
│  ├─ lib/                        Client state, API client, shared types
│  │  ├─ provider-catalog.ts       Client/server-safe provider catalog: providers, capabilities, models
│  │  ├─ contracts.ts              Domain enums shared by routes and types
│  │  ├─ stream-events.ts          Shared SSE event union and parser
│  ├─ lib/server/                 Server-only code
│  │  ├─ providers/               Provider registry, shared AI SDK model layer, adapters, fixtures
│  │  ├─ repo/                    Database access
│  │  ├─ answer-pipeline.ts       Answer pipeline entry: prepareChat, runChat, outcome handling
│  │  ├─ answer/                  Pipeline stages
│  │  │  ├─ context.ts            Run state, limits, shared search loop and source appending
│  │  │  ├─ prepare.ts            Settings, keys and the stored exchange before streaming
│  │  │  ├─ retrieval.ts          Deep retrieval (and fixture runs) and the freshness heuristic
│  │  │  ├─ deep.ts               Deep planner (with repair) and evidence-gap pass
│  │  │  ├─ research.ts           Quick and Deeper research loop (budgets) and its search tool
│  │  │  ├─ synthesis.ts          Streamed answer and citation events
│  │  │  └─ outcome.ts            Stored outcome, abort classification and analytics
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
├─ deploy/gcp/                    Google Cloud setup, budgets, Cloud Run service and migration job
├─ docs/                          This documentation site (MkDocs; config in mkdocs.yml)
├─ .github/workflows/             CI and release, docs site, watchdog
├─ Dockerfile                     Multi-stage standalone image
├─ docker-compose.yml             Production-parity local stack
└─ pnpm-workspace.yaml
```

Toolchain:

| Item | Version / choice |
|---|---|
| Package manager | pnpm 12.18.0; dependency build scripts are denied in `pnpm-workspace.yaml` |
| Web framework | Next.js 16.4.5, App Router |
| UI | React 19.3.1, TypeScript 6.0.3 in the web app (typescript-eslint does not support TypeScript 7 yet), TypeScript 7.0.2 in the mascot package |
| Styling | Tailwind CSS 4.3.3 plus hand-written CSS files under `app/styles` |
| Database | PostgreSQL 18 |
| ORM | Drizzle ORM 0.45.4, `pg` 8.23.1 |
| Validation | Zod 4.6.7 |
| Email | Nodemailer 10.2.0 (shutdown notice only) |
| Model calls | AI SDK 7.0.163 (`streamText`, `ToolLoopAgent`) with `@openrouter/ai-sdk-provider` 3.1.0 |
| SSE parsing (browser) | `eventsource-parser` 4.1.3 |
| Test runner | Node test runner through `tsx`; Playwright 1.65.0 |
| Runtime target | Node.js 26 LTS in Docker and CI |

Useful commands:

```sh
pnpm install
pnpm web:dev             # build mascot, then next dev
pnpm web:build           # build mascot, then next build
pnpm web:start           # start the production build
pnpm test                # mascot + web tests
pnpm check:unused        # knip: unused files, exports and dependencies (knip.json)
pnpm check:dupes         # jscpd: duplicated code, fails on any clone (.jscpd.json)
pnpm db:migrate          # apply SQL migrations
pnpm local:up            # build and start the parity stack
pnpm local:down          # stop the parity stack
pnpm --filter @beamling/web typecheck
pnpm --filter @beamling/web lint
pnpm --filter @beamling/web test:e2e
```

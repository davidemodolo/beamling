# Repository and build

```text
.
├─ packages/web/                Next.js app
│  ├─ app/                      Pages and route handlers
│  ├─ components/               React UI
│  ├─ lib/                      Client state, API client, shared types
│  │  ├─ provider-catalog.ts    Providers, capabilities, models
│  │  ├─ contracts.ts           Domain enums
│  │  └─ stream-events.ts       SSE events and parser
│  ├─ lib/server/               Server-only code
│  │  ├─ providers/             Registry, AI SDK layer, adapters, fixtures
│  │  ├─ repo/                  Database access
│  │  ├─ answer-pipeline.ts     Entry: prepareChat, runChat
│  │  ├─ answer/                Pipeline stages
│  │  │  ├─ context.ts          Run state, limits, search loop, sources
│  │  │  ├─ prepare.ts          Settings, keys, stored exchange
│  │  │  ├─ retrieval.ts        Deep and fixture retrieval, freshness
│  │  │  ├─ deep.ts             Planner and gap pass
│  │  │  ├─ research.ts         Quick/Deeper loop and search tool
│  │  │  ├─ synthesis.ts        Streamed answer and citations
│  │  │  └─ outcome.ts          Stored outcome, aborts, analytics
│  │  ├─ auth.ts                Google OIDC, account upsert
│  │  ├─ kms.ts                 Env/AWS/GCP KMS adapters
│  │  ├─ workspace-key.ts       Content encryption
│  │  ├─ crypto.ts              Credential encryption
│  │  ├─ prompts.ts             Prompts
│  │  ├─ shutdown.ts            Scheduled shutdown
│  │  ├─ mail.ts                SMTP
│  │  └─ ...
│  ├─ drizzle/                  SQL migrations
│  ├─ scripts/                  Migration and key-rotation CLIs
│  ├─ tests/                    Node test runner suites
│  └─ e2e/                      Playwright
├─ packages/mascot/             Mascot engine + React wrapper
├─ local/                       Caddy, Dex, LocalStack config
├─ deploy/gcp/                  GCP setup, Cloud Run service, migration job
├─ docs/                        This site
├─ .github/workflows/           CI/release, docs, watchdog
├─ Dockerfile                   Standalone image
├─ docker-compose.yml           Parity stack
└─ pnpm-workspace.yaml
```

## Toolchain

| Item | Version |
|---|---|
| Package manager | pnpm 12.18.0; dependency build scripts denied |
| Web framework | Next.js 16.4.5, App Router |
| UI | React 19.3.1; TypeScript 6.0.3 in web (for typescript-eslint), 7.0.2 in mascot |
| Styling | Tailwind CSS 4.3.4 plus CSS in `app/styles` |
| Database | PostgreSQL 18; Drizzle ORM 0.45.4, `pg` 8.23.1 |
| Validation | Zod 4.6.7 |
| Email | Nodemailer 10.3.1 (shutdown notice only) |
| Model calls | AI SDK 7.0.163 (`streamText`, `ToolLoopAgent`), `@openrouter/ai-sdk-provider` 3.1.0, `@ai-sdk/deepseek` 3.0.80 |
| Browser SSE | `eventsource-parser` 4.1.3 |
| Tests | Node test runner via `tsx`; Playwright 1.65.0 |
| Runtime | Node.js 26 LTS in Docker and CI |

## Commands

More in [Development](../development.md).

```sh
pnpm web:dev             # build mascot, then next dev
pnpm web:build           # build mascot, then next build
pnpm web:start           # start the production build
```

`check:unused` uses `knip.json`; `check:dupes` uses `.jscpd.json` and fails on any clone.

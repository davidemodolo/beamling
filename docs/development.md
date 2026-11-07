# Development

## Requirements

- Node.js 26 and pnpm (version in `packageManager`, root `package.json`)
- Docker, for the parity stack and test database
- Python 3, only for this docs site

## Running locally

```sh
pnpm install
pnpm local:up                   # https://localhost
```

Production image behind Caddy, with Dex OIDC and LocalStack KMS. Accept the local CA, sign in as `test@beamling.local` / `beamling`, add real keys. `pnpm local:down` stops it. Use it for auth, KMS, TLS and other production-path changes.

`pnpm web:dev` is the fast loop; `BEAMLING_FAKE_PROVIDERS=1` switches to fixture providers (any `test-` key). Fixtures and `/api/auth/test-login` are test-only, not a guide to production behavior.

| Command | What it does |
|---|---|
| `pnpm local:logs` | Follows parity-stack app logs |
| `pnpm mascot:dev` / `mascot:build` | Mascot package (`web:dev` and `web:build` build it first) |
| `pnpm db:migrate` | Applies migrations in `packages/web/drizzle` |
| `pnpm --filter @beamling/web db:generate` | New migration file from `lib/server/schema.ts` (drizzle-kit) |
| `pnpm --filter @beamling/web db:studio` | Drizzle Studio on `DATABASE_URL` |
| `pnpm licenses:generate` | Regenerates the license inventory for `licenses:check` |

## Tests and checks

| Command | What it runs |
|---|---|
| `pnpm test` | Mascot and web unit tests; integration tests if `DATABASE_URL` is a migrated test database |
| `pnpm --filter @beamling/web test:e2e` | Playwright on a production build with fixtures |
| `pnpm --filter @beamling/web typecheck` / `lint` | TypeScript and ESLint |
| `pnpm check:unused` | knip: unused files, exports and dependencies |
| `pnpm check:dupes` | jscpd: duplicated code |
| `pnpm licenses:check` | Licenses against the allowlist and inventory |

CI runs these plus `pnpm audit` and Gitleaks on every pull request. Suites: [Tests](reference/tests.md).

## Releasing

The three `package.json` versions must match. Release through a pull request:

```sh
git switch -c release/0.5.0
pnpm version:set 0.5.0
git commit -am "chore: release 0.5.0"
gh pr create --fill
```

Merging a version bump releases and deploys ([Versioning and releases](reference/operations.md#versioning-and-releases)).

## Documentation

[MkDocs](https://www.mkdocs.org/) with [Material](https://squidfunk.github.io/mkdocs-material/), published to GitHub Pages from `main`.

```sh
python3 -m venv .venv-docs && .venv-docs/bin/pip install -r docs/requirements.txt
.venv-docs/bin/mkdocs serve      # http://127.0.0.1:8000
```

Update the [reference](reference/index.md) with the code; planned behavior goes in the [specification](spec/index.md).

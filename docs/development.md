# Development

## Requirements

- Node.js 26 and pnpm (the version is pinned in `packageManager` in the root `package.json`)
- Docker, for the production-parity stack and the test database
- Python 3, only to preview this documentation site

## Running locally

```sh
pnpm install
pnpm local:up                   # https://localhost
```

The parity stack runs the production image behind Caddy, with Dex as the local OIDC provider and LocalStack KMS. Accept the local CA, sign in with `test@beamling.local` / `beamling`, then add real model and search provider keys. Stop it with `pnpm local:down`. Use this stack for auth, KMS, TLS and other production-path changes.

`pnpm web:dev` is the fast development loop. Set `BEAMLING_FAKE_PROVIDERS=1` to try it without provider keys (any key starting with `test-` works). Fixture providers and `/api/auth/test-login` are test-only: do not use them to judge production behavior.

Other scripts:

| Command | What it does |
|---|---|
| `pnpm local:logs` | Follows the app container's logs in the parity stack |
| `pnpm mascot:dev` / `mascot:build` | Develops or builds the mascot package (`web:dev` and `web:build` build it first) |
| `pnpm db:migrate` | Applies the SQL migrations in `packages/web/drizzle` |
| `pnpm --filter @beamling/web db:generate` | Generates a new migration from `lib/server/schema.ts` with drizzle-kit; always a new file |
| `pnpm --filter @beamling/web db:studio` | Opens Drizzle Studio on `DATABASE_URL` |
| `pnpm licenses:generate` | Regenerates the dependency license inventory that `licenses:check` compares against |

## Tests and checks

| Command | What it runs |
|---|---|
| `pnpm test` | Mascot tests, web unit tests, and the integration tests when `DATABASE_URL` points at a migrated test database |
| `pnpm --filter @beamling/web test:e2e` | Playwright against a production build with fixture providers |
| `pnpm --filter @beamling/web typecheck` / `lint` | TypeScript and ESLint |
| `pnpm check:unused` | knip: unused files, exports and dependencies |
| `pnpm check:dupes` | jscpd: duplicated code |
| `pnpm licenses:check` | Dependency licenses against the allowlist and the generated inventory |

CI runs all of them, plus `pnpm audit` and a Gitleaks scan, on every pull request. The [tests page](reference/tests.md) lists the suites.

## Releasing

The version lives in the three `package.json` files and must match. `main` is protected, so a release is a pull request:

```sh
git switch -c release/0.5.0
pnpm version:set 0.5.0
git commit -am "chore: release 0.5.0"
gh pr create --fill
```

When the merged commit on `main` changes the version, CI tags it, pushes the image to GHCR as that tag and `latest`, creates the GitHub release, runs the migration job and deploys the new revision to Cloud Run, then smoke-tests `/api/health`. A merge without a version bump does not deploy. `/api/health`, the landing footer and the sidebar show the running version and commit. See [Versioning and releases](reference/operations.md#versioning-and-releases).

## Documentation

This site is built with [MkDocs](https://www.mkdocs.org/) and [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) from the `docs/` folder and published to GitHub Pages on every push to `main` that touches it.

```sh
python3 -m venv .venv-docs && .venv-docs/bin/pip install -r docs/requirements.txt
.venv-docs/bin/mkdocs serve      # http://127.0.0.1:8000
```

Update the [technical reference](reference/index.md) in the same change as the code it describes. Keep planned behavior in the [product specification](spec/index.md) only.

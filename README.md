# Beamling

Beamling is an answer engine that uses your own model and search keys. It searches the web, works through the results, and returns cited answers with sources you can inspect.

Your models. Your search. Your bill.

## Current features

- Google-only accounts; no guest workspaces
- Bring your own OpenRouter key and a Brave, Tavily or Exa search key
- Keys and conversation content encrypted at rest through KMS-backed envelope encryption
- Choose the search provider per answer; Brave Free/Paid plan plus optional expiry and budget warnings
- Quick for one search pass, Deep for planned multi-query research, Deeper for an agentic loop with up to 60 searches
- Streamed answers with inline, numbered citations
- Collapsed panels for the searches actually run and any model-provided reasoning
- Markdown tables, headings, lists, quotes and code
- Source panel with titles, domains, snippets, and publication dates
- Conversation history with pinned chats, title search and per-conversation deletion
- Model, default search-provider and default-mode settings
- Account deletion and sign-out
- Optional server-side PostHog analytics with metadata-only allowlisted events, no browser SDK and account-deletion cleanup
- Production-parity local stack with HTTPS, OIDC, KMS and TLS PostgreSQL

## Technical reference

See [TECHNICAL.md](TECHNICAL.md) for the current architecture, API, answer pipeline, data model, security controls and tests.

## Running locally

```sh
pnpm local:up                   # https://localhost
```

The parity stack runs the production image behind Caddy with Dex as the local OIDC provider and LocalStack KMS. Sign in with `test@beamling.local` / `beamling`, accept the local CA, then add real OpenRouter and Brave/Tavily/Exa keys. Stop it with `pnpm local:down`.

`pnpm web:dev` remains available for a fast dev loop. Set `BEAMLING_FAKE_PROVIDERS=1` to try it without provider keys (any key starting with `test-` works).

Tests: `pnpm test` (unit; integration tests run when `DATABASE_URL` points at a migrated test database) and
`pnpm --filter @beamling/web test:e2e` (Playwright, against a production build with fixture providers).

## Releasing

The version lives in the root `package.json`. To cut a release:

```sh
pnpm version:set 0.3.0
git add package.json packages/web/package.json packages/mascot/package.json
git commit -m "chore(release): v0.3.0"
git push origin main
```

On a green `main` build, CI tags `v0.3.0`, pushes the image to GHCR as `v0.3.0` and `latest`, and creates the GitHub release. `/api/health`, the landing footer and the sidebar expose the same version and commit.

## Deploying

- `APP_URL` must be the public `https://` origin only, for example `https://beamling.example` (no path, query or trailing route). It is the anchor for same-origin checks, cookies and OIDC redirects.
- Do not expose the app container directly. The proxy must terminate TLS, overwrite client-supplied forwarding headers, append to `X-Forwarded-For`, and pass the original `Host`.
- Set `TRUSTED_PROXY_HOPS` to the exact proxy count. The server refuses a non-local deployment without it; without a trusted proxy, per-IP limits would trust a client-controlled header.
- Run `node scripts/migrate.mjs` before starting new instances; migrations are serialized with an advisory lock.
- On `SIGTERM` the server stores running answers as interrupted before exiting; allow it about 10 seconds.
- Accounts persist across Google sign-ins; expired sessions are deleted, but account data is only removed by account deletion or retention policy.
- Production uses GCP Cloud KMS. The env master key and `scripts/rewrap-credentials.mjs` are for local tests only.
- Enable database backups with a 30-day expiry, platform log retention of at most 30 days, and alerts on `/api/health`.
- Analytics is opt-in and off by default. Set `ANALYTICS_ENABLED=true` plus `POSTHOG_API_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` and a 32-byte `ANALYTICS_SALT` to send allowlisted metadata events to PostHog Cloud EU. `POSTHOG_HOST` defaults to the EU ingestion host; the personal key needs `person:write` so account deletion can remove the hashed person and its events. Set `ANALYTICS_ENABLED=false` to stop all events immediately.
- Publish the operator's legal entity and monitored privacy contact before opening sign-ups; the supplied legal pages are factual drafts, not legal review.
- Before each release: `pnpm audit --prod`, a Gitleaks history scan, and a container scan of the built image. CI runs the production audit and Gitleaks automatically.

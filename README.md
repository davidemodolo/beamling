# Beamling

Beamling is an answer engine that uses your own model and search keys. It searches the web, works through the results, and returns cited answers with sources you can inspect.

Your models. Your search. Your bill.

## Current features

- Guest workspaces with no signup, email, or stored identity
- Bring your own OpenRouter and Brave Search keys
- Keys encrypted at rest and never returned in plaintext
- Quick mode for one search pass and Deep mode for multi-query research
- Streamed answers with inline, numbered citations
- Source panel with titles, domains, snippets, and publication dates
- Conversation history with per-conversation deletion
- Model and default-mode settings
- Workspace deletion from the account settings
- Self-hosting with Docker Compose and PostgreSQL

## Running locally

```sh
cp .env.example .env            # set CREDENTIAL_MASTER_KEY (openssl rand -base64 32)
docker compose up --build       # http://localhost:3000
```

Set `BEAMLING_FAKE_PROVIDERS=1` to try it without provider keys (any key starting with `test-` works).

Tests: `pnpm test` (unit; integration tests run when `DATABASE_URL` points at a migrated test database) and
`pnpm --filter @beamling/web test:e2e` (Playwright, against a production build with fixture providers).

## Deploying

- Serve it behind a reverse proxy that terminates TLS and appends to `X-Forwarded-For`, and set
  `TRUSTED_PROXY_HOPS` to the number of proxies. Without one, per-IP limits trust a client-controlled header.
- `APP_URL` must be the public `https://` URL. The server refuses to start with an unsafe configuration.
- Run `node scripts/migrate.mjs` before starting new instances; migrations are serialized with an advisory lock.
- On `SIGTERM` the server stores running answers as interrupted before exiting; allow it about 10 seconds.
- Guest workspaces whose session expired (30 days without use) are deleted automatically.
- The privacy page promises logs and database backups kept at most 30 days: configure log retention
  and backup expiry on the hosting platform to match.
- Rotating `CREDENTIAL_MASTER_KEY`: see `.env.example` and `scripts/rewrap-credentials.mjs`.

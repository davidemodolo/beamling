# Beamling

Beamling is an answer engine that uses your own model and search keys. It searches the web, works through the results, and returns cited answers with sources you can inspect.

Your models. Your search. Your bill.

## Current features

- Google-only accounts; no guest workspaces
- Bring your own keys: OpenRouter or DeepSeek for models, Brave, Tavily, Exa or DeepSeek for search (one DeepSeek key covers both)
- Keys and conversation content encrypted at rest through KMS-backed envelope encryption
- Choose the search provider per answer; Brave Free/Paid plan plus optional expiry and budget warnings
- Quick for one search pass, Deep for planned multi-query research, Deeper for an agentic loop with up to 60 searches
- Streamed answers with inline, numbered citations
- Collapsed panels for the searches actually run and any model-provided reasoning
- Markdown tables, headings, lists, quotes and code
- Source panel with titles, domains, snippets, and publication dates
- Conversation history with pinned chats, title search and per-conversation deletion; 60-day retention and 100 chats per account
- Model, default search-provider and default-mode settings
- Terms acceptance on first use and after every material change, with an 18+ confirmation
- Your data in Settings: download everything as JSON, opt out of product analytics (and erase what was collected), sign out everywhere, delete the account
- Automatic deletion of accounts unused for 24 months or never accepted after 7 days
- Privacy notice, terms, cookie policy, data processors, security policy with `security.txt`, and DSA contact page
- Optional server-side PostHog analytics with metadata-only allowlisted events, no browser SDK and account-deletion cleanup
- Production-parity local stack with HTTPS, OIDC, KMS and TLS PostgreSQL
- Open source under the MIT License

## Technical reference

See [TECHNICAL.md](TECHNICAL.md) for the current architecture, API, answer pipeline, data model, security controls and tests.

## Running locally

```sh
pnpm local:up                   # https://localhost
```

The parity stack runs the production image behind Caddy with Dex as the local OIDC provider and LocalStack KMS. Sign in with `test@beamling.local` / `beamling`, accept the local CA, then add real model and search provider keys. Stop it with `pnpm local:down`.

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

On a green `main` build, CI tags the new version, pushes the image to GHCR as that tag and `latest`, and creates the GitHub release. `/api/health`, the landing footer and the sidebar expose the same version and commit.

## Deploying

- `APP_URL` must be the public `https://` origin only, for example `https://beamling.example` (no path, query or trailing route). It is the anchor for same-origin checks, cookies and OIDC redirects.
- Do not expose the app container directly. The proxy must terminate TLS, overwrite client-supplied forwarding headers, append to `X-Forwarded-For`, and pass the original `Host`.
- Set `TRUSTED_PROXY_HOPS` to the exact proxy count. The server refuses a non-local deployment without it; without a trusted proxy, per-IP limits would trust a client-controlled header.
- Run `node scripts/migrate.mjs` before starting new instances; migrations are serialized with an advisory lock.
- On `SIGTERM` the server stores running answers as interrupted before exiting; allow it about 10 seconds.
- Accounts persist across Google sign-ins; expired sessions are deleted. Account data is removed by account deletion, after 24 months without a sign-in, or 7 days after creation when the terms were never accepted. Conversations are deleted 60 days after their last activity, and an account keeps at most 100 (the oldest unpinned ones are removed first).
- To close the service, set `SMTP_URL`, `MAIL_FROM` and `LEGAL_MAIL_PROVIDER`, then `POST /api/internal/shutdown` with the `KILL_SWITCH_SECRET` bearer and `{"action":"schedule","days":14}` (at least 14 days). Every account is emailed, sign-ups stop, and on the date every account is deleted; then destroy the KMS key so backups become unreadable. See the runbook in `TECHNICAL.md` §14.10.
- Production uses GCP Cloud KMS. The env master key and `scripts/rewrap-credentials.mjs` are for local tests only.
- Enable database backups and platform log retention, and set `LEGAL_BACKUP_RETENTION_DAYS` (default 7) and `LEGAL_LOG_RETENTION_DAYS` (default 30) to the windows actually configured: the privacy notice states them. Add alerting on the watchdog and `/api/health`.
- Analytics is opt-in and off by default. Set `ANALYTICS_ENABLED=true` plus `POSTHOG_API_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` and a 32-byte `ANALYTICS_SALT` to send allowlisted metadata events to PostHog Cloud EU. `POSTHOG_HOST` defaults to the EU ingestion host; the personal key needs `person:write` so account deletion can remove the hashed person and its events. Set `ANALYTICS_ENABLED=false` to stop all events immediately.
- Set `LEGAL_ENTITY`, `LEGAL_ADDRESS` and `LEGAL_CONTACT_EMAIL` (optionally `LEGAL_VAT_ID`), have counsel review the implemented legal pages, and choose `SIGNUP_MODE=open` only after that review. Changing the terms or privacy notice materially means bumping `LEGAL_VERSION` in `packages/web/lib/legal.ts`, which asks every account to accept again.
- Before each release: `pnpm audit --prod`, a Gitleaks history scan, and a container scan of the built image. CI runs the production audit and Gitleaks automatically.

## License

Beamling is open source under the [MIT License](LICENSE). Third-party dependencies keep their own licenses; the inventory is generated with `pnpm licenses:generate` and shown on the `/licenses` page.

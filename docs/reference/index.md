# Technical reference


**Status:** describes the code in this checkout, not a roadmap.
**Last verified against the code:** 2026-11-07.
**Scope:** the web application, API, database schema, answer pipeline, browser UI, security controls, tests and local deployment.

Beamling is a hosted, bring-your-own-key answer engine. A visitor signs in with Google, connects a model-provider key (OpenRouter or DeepSeek) and a search-provider key (Brave, Tavily, Exa or DeepSeek; one DeepSeek key can serve both), and asks questions in Quick, Deep or Deeper mode. The server searches the web, builds a grounded prompt from the retrieved snippets, streams the model's answer over SSE, and persists the conversation, sources and usage data.

The application is a single Next.js service plus a small workspace package for the mascot. There is no separate backend, queue, worker or client-side orchestration.


## System at a glance

```text
Browser
  │  HTML/CSS/JS from Next.js
  │  JSON + SSE with the account session cookie
  ▼
Next.js 16 application (Node.js runtime)
  ├─ App Router pages: landing, login, welcome (terms acceptance), onboarding, chat, legal pages
  ├─ Google OIDC sign-in and database sessions
  ├─ Route handlers under /api
  ├─ Answer pipeline (Quick / Deep / Deeper)
  ├─ KMS-backed envelope encryption for credentials and content
  └─ PostgreSQL access through pg + Drizzle
       │
       ├─ Google OIDC  discovery + code exchange
       ├─ KMS         wrap/unwrap workspace and credential keys
       ├─ SMTP        service-shutdown notice only (optional)
       ├─ OpenRouter  GET /api/v1/key
       │              POST /api/v1/chat/completions (SSE)
       ├─ DeepSeek    GET /user/balance
       │              POST /chat/completions (SSE), POST /v1/tools/search
       ├─ Brave       GET /res/v1/web/search
       ├─ Tavily      POST /search
       └─ Exa         POST /search
```

Current external dependencies:

| Dependency | Use |
|---|---|
| PostgreSQL 18 | Accounts, sessions, workspace keys, credentials, usage, conversations, messages, sources, rate limits, provider slots |
| Google OIDC | Account sign-in and verified identity |
| KMS | Wrapping workspace keys and credential data keys; LocalStack locally, GCP Cloud KMS in production |
| OpenRouter | Model key validation and streamed chat completions |
| Brave Search API | Web Search validation and retrieval |
| Tavily Search API | Retrieval; key validation through the free usage endpoint |
| Exa Search API | Search validation and retrieval |
| DeepSeek API | Key validation through the balance endpoint, streamed chat completions and search |
| PostHog Cloud EU | Optional server-side, metadata-only product events |
| SMTP relay | Optional; sends only the one-off service-shutdown notice ([Incident runbook](operations.md#incident-runbook)) |
| Browser | Session cookie, SSE consumption, UI state |

The server does not fetch result pages, crawl the web or load remote media in answers. Provider traffic goes directly from the Next.js process to the selected model provider and search provider using the user's key. When analytics is explicitly enabled, the server also sends the allowlisted metadata events described in [Analytics privacy](security.md#analytics-privacy).

---

## Current capability map

| Capability | Implementation |
|---|---|
| Accounts | Google-only OIDC, one account per Google subject, versioned terms acceptance with 18+ confirmation |
| Session management | Opaque token, SHA-256 at rest, 30-day sliding expiry capped at 90 days, previous-session revocation on sign-in, sign-out |
| Provider credentials | One key per provider (OpenRouter, DeepSeek, Brave, Tavily, Exa), validated, KMS-encrypted, replaceable, deletable, revalidatable |
| Credential limits | Brave Free/Paid plan, declared expiry and budget, estimated spend and warnings |
| Key rotation | KMS key rotation with lazy re-wrap of workspace and credential keys; env adapter supports previous-key list + re-wrap script for credential and workspace keys |
| Quick answers | The research loop with a one-query budget on the selected provider, cited streamed answer |
| Deep answers | Planner, 3–5 sub-queries, bounded concurrent search, optional gap pass, cited report |
| Deeper answers | AI SDK `ToolLoopAgent`, selected-provider search tool, adaptive rounds, 60-search/60-source cap, long cited report |
| Retrieval | Brave, Tavily, Exa or DeepSeek snippets selected per answer, freshness filter, Brave per-key spacing, 429 retry |
| Source quality | URL validation, snippet requirement, canonical dedupe, site diversity, stable numbering |
| Citations | Streamed `[n]` parsing, sanitization, click-to-source, uncited warning |
| Conversation history | Create, open, title, paginate, delete; 100 per account (oldest unpinned trimmed), deleted 60 days after last activity, sidebar notice and warning from 90 |
| Message history | 60-message pages, earlier pages, source attachment |
| Streaming | SSE stages, progress, sources, deltas, citations, usage, done/error; heartbeat |
| Cancellation | Local and cross-instance stop, partial text kept, timeout and shutdown handling |
| Models | Allowlisted models per provider in the catalog (five through OpenRouter), default DeepSeek V4.1 Flash |
| Costs | OpenRouter actual generation cost, selected-provider list-price estimate, tokens, latency, search count |
| Search transparency | Persisted per-answer search trace, collapsed by default |
| Reasoning transparency | Provider-supplied reasoning, persisted encrypted and collapsed by default |
| Markdown | Tables in addition to headings, lists, quotes, code and citations |
| Settings | Default model, default search provider, default mode, keys and limits, account |
| Account deletion | Immediate hard delete of the account, workspace key, content and credentials; automatic deletion after 24 months of inactivity or 7 days without terms acceptance |
| Data rights | Self-service JSON export, analytics objection with erasure, account deletion |
| Service shutdown | Operator-scheduled closure with at least 14 days' notice: an English email to every account, in-app/login/status banner, no new sign-ups, then deletion of every account |
| Legal | Privacy notice, terms, cookies, data processors, security policy, DSA contact, `security.txt`, MIT license |
| Rate limits | Login, chat, conversations, credentials, key validation, exports, reads, writes; per-account and per-IP |
| Encryption | KMS-wrapped workspace keys, AES-256-GCM content and credential encryption |
| Local parity | Caddy HTTPS, Dex OIDC, LocalStack KMS, TLS PostgreSQL, production image |
| Concurrency control | Global cap + one streaming answer per conversation, database-enforced |
| UI | Landing, login, onboarding, chat, source panel/sheet, settings modal, account panel |
| Accessibility | Focus traps, keyboard tabs, live regions, reduced motion, axe-checked routes |
| Security | CSP nonce, strict headers, `APP_URL`-anchored origin checks, body caps, prompt injection boundaries, redacted provider logs, safe markdown and URLs |
| Credential protection | AES-256-GCM envelope encryption, AAD binding, master-key rotation |
| Persistence | PostgreSQL 18, Drizzle schema, forward-only migration ledger |
| Local deployment | Docker Compose app + PostgreSQL, standalone image, build identity, health check, graceful shutdown |
| Production deploy config | `deploy/gcp/` (setup script, Cloud Run service and migration job), keyless deploy job on version bumps; live at https://beamling.app on Cloud Run with Neon Postgres |
| Killswitch | Database flag, chat gate, internal kill/metrics/shutdown endpoints, GitHub Actions watchdog |
| Observability | Structured JSON logs, security audit events, versioned health endpoint, build identity in the UI, optional server-side PostHog events |
| Analytics | Opt-in server-side PostHog events with allowlisted metadata, HMAC ids, per-account opt-out, kill switch and deletion cleanup |
| Testing | Unit, integration, E2E and mascot geometry suites |

# Technical reference


**Status:** describes the code in this checkout, not a roadmap.
**Last verified against the code:** 2026-11-07.
**Scope:** web app, API, schema, answer pipeline, UI, security, tests and local deployment.

Users sign in with Google, add a model key (OpenRouter or DeepSeek) and a search key (Brave, Tavily, Exa or DeepSeek; one DeepSeek key can serve both), and ask in Quick, Deep or Deeper mode. The server searches, builds a prompt from the snippets, streams the answer over SSE and stores the conversation, sources and usage.

One Next.js service plus a mascot package. No separate backend, queue or worker.


## System at a glance

```text
Browser (session cookie, JSON + SSE, UI state)
  ▼
Next.js 16 application (Node.js runtime)
  ├─ Pages: landing, login, welcome (terms), onboarding, chat, legal
  ├─ Google OIDC sign-in, database sessions
  ├─ Route handlers under /api
  ├─ Answer pipeline (Quick / Deep / Deeper)
  ├─ KMS envelope encryption for credentials and content
  └─ pg + Drizzle
       │
       ├─ PostgreSQL 18  all state, rate limits, provider slots
       ├─ Google OIDC    discovery + code exchange
       ├─ KMS            wrap/unwrap keys (LocalStack locally, GCP Cloud KMS in production)
       ├─ OpenRouter     GET /api/v1/key, POST /api/v1/chat/completions (SSE)
       ├─ DeepSeek       GET /user/balance, POST /chat/completions (SSE), POST /v1/tools/search
       ├─ Brave          GET /res/v1/web/search
       ├─ Tavily         POST /search, GET /usage (validation)
       ├─ Exa            POST /search
       ├─ PostHog EU     optional metadata events
       └─ SMTP           optional, service-shutdown notice only
```

The server never fetches result pages, crawls or loads remote media. Provider calls go straight to the selected providers with the user's key. See [Analytics privacy](security.md#analytics-privacy) and the [Incident runbook](operations.md#incident-runbook) for PostHog and SMTP.

---

## Current capability map

| Capability | Implementation |
|---|---|
| Accounts | Google OIDC, one account per subject, versioned terms with 18+ confirmation |
| Sessions | Hashed opaque token, 30-day sliding expiry capped at 90 days, prior session revoked on sign-in |
| Credentials | One validated, KMS-encrypted key per provider; replace, delete, revalidate |
| Credential limits | Brave plan, expiry, budget, estimated spend, warnings |
| Encryption | KMS-wrapped workspace keys; AES-256-GCM envelope encryption with AAD binding |
| Key rotation | KMS rotation with lazy re-wrap; env adapter has a previous-key list and re-wrap script |
| Quick | Research loop with a one-query budget |
| Deep | Planner, 3–5 sub-queries, bounded concurrency, optional gap pass |
| Deeper | AI SDK `ToolLoopAgent`, 60-search/60-source cap |
| Retrieval | Per-answer provider, freshness filter, Brave per-key spacing, 429 retry |
| Sources | URL validation, snippet required, canonical dedupe, site diversity, stable numbering |
| Citations | Streamed `[n]` parsing, sanitization, click-to-source, uncited warning |
| Conversations | 100 per account (oldest unpinned trimmed), deleted 60 days after last activity, warning from 90 |
| Messages | 60-message pages with sources |
| Streaming | SSE events with heartbeat ([Streaming protocol](streaming.md)) |
| Cancellation | Local and cross-instance stop, partial text kept, timeout and shutdown handling |
| Models | Per-provider allowlist (five via OpenRouter), default DeepSeek V4.1 Flash |
| Costs | Generation cost (OpenRouter-reported or DeepSeek-estimated), list-price search cost, tokens, latency, search count |
| Transparency | Stored search trace and encrypted provider reasoning, both collapsed |
| Markdown | Tables, headings, lists, quotes, code, citations |
| Settings | Default model, search provider and mode; keys, limits, account |
| Account deletion | Immediate hard delete; automatic after 24 months inactive or 7 days without terms acceptance |
| Data rights | JSON export, analytics objection with erasure, account deletion |
| Service shutdown | Scheduled with ≥14 days' notice: email, banners, no new sign-ups, then all accounts deleted |
| Legal | Privacy, terms, cookies, processors, security policy, DSA contact, `security.txt`, MIT license |
| Rate limits | Per account and per IP on login, chat, conversations, credentials, validation, exports, reads, writes |
| Concurrency | Global cap, one streaming answer per conversation, DB-enforced |
| UI | Landing, login, onboarding, chat, source panel, settings, account |
| Accessibility | Focus traps, keyboard tabs, live regions, reduced motion, axe-checked routes |
| Security | CSP nonce, strict headers, `APP_URL` origin checks, body caps, prompt-injection boundaries, redacted logs, safe markdown and URLs |
| Persistence | PostgreSQL 18, Drizzle, forward-only migrations |
| Local deployment | Docker Compose; parity stack with Caddy HTTPS, Dex OIDC, LocalStack KMS, TLS PostgreSQL and the production image |
| Production | `deploy/gcp/` (setup script, Cloud Run service, migration job), keyless deploy on version bumps; Cloud Run + Neon at https://beamling.app |
| Killswitch | DB flag, chat gate, internal kill/metrics/shutdown endpoints, Actions watchdog |
| Observability | JSON logs, audit events, versioned health endpoint, build identity in the UI |
| Analytics | Opt-in server-side PostHog, allowlisted metadata, HMAC ids, opt-out, kill switch, deletion cleanup |
| Testing | Unit, integration, E2E and mascot geometry suites ([Tests](tests.md)) |

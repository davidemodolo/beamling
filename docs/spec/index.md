# Product specification


**Status:** Draft v0.9: target product and technical contract. The current checkout is narrower than this document; see [Document status and current implementation](#document-status-and-current-implementation) and the [technical reference](../reference/index.md).
**Date:** 2026-11-07
**Owner:** Davide (product), TBD (engineering)
**Primary domain:** `beamling.app` (target; `.app` is HTTPS-only and HSTS-preloaded)
**Working name:** Beamling (pronounced **BEEM-ling**)

> One-line pitch: a hosted, bring-your-own-key answer engine that turns your own models and search APIs into fast, cited answers with sources you can inspect.

> **Alpha 1 target:** OpenRouter and DeepSeek are the LLM providers. Brave Search, Tavily, Exa and DeepSeek are the search providers; one DeepSeek key can serve both. The user selects one search provider per answer; there is no silent provider fallback. Quick, Deep and Deeper modes ship in Alpha 1, with Beamling's animated search state visible from submit to first token. Deeper is an agentic research loop: the model calls a search tool until the evidence is sufficient, within a hard 60-search budget. Every other provider is post-alpha and must not block implementation.


## Document status and current implementation

This specification is the **target contract** for Alpha 1 and public launch. It is not an inventory of the current checkout. Where the target and the code disagree, the code is the source of truth for current behavior and the gap is tracked in [Snapshot](#snapshot) and the [technical reference](../reference/index.md).

### Source of truth

| Question | Read |
|---|---|
| What does the product aim to become? | This specification |
| What does the current checkout do? | The [technical reference](../reference/index.md) and the code |
| What must be true before public launch? | The P0 requirements and [Deployment and Operations](quality-ops.md#deployment-and-operations) |
| What changed in the code? | Git history, tests and the [technical reference](../reference/index.md) |

“Implemented” below means the checkout has the capability and tests or code paths for it. “Partial” means a working slice exists but the target behavior is wider. “Target” means it is specified here and not yet implemented. Priority labels (P0/P1/P2) describe the target release, not the current state.

### Snapshot

Verified against the code on 2026-11-07.

| Area | Current checkout | Alpha 1 / public-launch target |
|---|---|---|
| Runtime | Next.js 16.4.5, React 19.3.1, TypeScript 6.0.3, Node 26 LTS, one web app plus the mascot workspace package | Same, deployed on Google Cloud Run |
| Auth | Google-only OIDC accounts, opaque session cookie, 30-day sliding expiry capped at 90 days, previous session revoked on sign-in, hashed token at rest; versioned terms acceptance with 18+ confirmation at `/welcome` before the app or API can be used | Same; no guest workspaces |
| LLM | OpenRouter (seven allowlisted models including two free models, Nemotron 3.5 Super free default) and DeepSeek direct (V4.1 Flash), behind a provider registry with one AI SDK model layer | Same |
| Search | Brave, Tavily, Exa and DeepSeek selected per answer; Brave free/paid spacing and key metadata; Tavily and Exa use their basic search contracts | Same, plus provider-specific plan metadata and cost ceilings |
| Modes | Quick, Deep and Deeper. Quick and Deeper are the same AI SDK `ToolLoopAgent` research loop over the selected search provider with different budgets (Quick: one query; Deeper: up to 60 searches). Deep is a planner, bounded concurrent searches and an optional gap pass. | Same |
| Streaming | SSE with meta/stage/plan/search/progress/sources/delta/reasoning/citation/usage/done/error, stop and retry | Same contract, extra provider metadata |
| Sources | Ranked and deduplicated results from the selected provider, right panel or mobile sheet, inline citations | Same with provider-specific costs |
| History | Keyset pagination, 50 conversations per page, 60 messages per page, pinned chats, title search over loaded pages, per-conversation delete; at most 100 conversations per account (least recently active unpinned trimmed when a new conversation's first question is stored), conversations deleted 60 days after last activity, sidebar notice and warning from 90 | Same, plus full-history search |
| Onboarding | Free path (free OpenRouter model + Brave) or own providers, two steps; `/` (signed in) and `/onboarding` route on whether a model key and a search key exist; defaults follow saved keys | Same |
| Settings | Curated model, default search provider and default mode; per-answer provider picker in the composer | Add optional cost ceiling |
| Credentials | KMS-backed AES-256-GCM envelope encryption; one key per provider (OpenRouter, DeepSeek, Brave, Tavily, Exa; a DeepSeek key serves models and search); free OpenRouter, Tavily and DeepSeek key checks; optional unverified save for Brave/Exa only; key-check budget per account and IP; keyed-HMAC fingerprints; last four hidden for keys under 20 characters; lazy re-encryption after a KMS key change; Brave plan, expiry and budget metadata; usage warnings | Same; GCP KMS in production |
| Content at rest | Conversation titles, messages, sources and stored errors are encrypted with per-account workspace keys | Same; GCP KMS in production |
| Public pages | `/`, `/login`, `/welcome` (terms acceptance), `/onboarding`, `/chat/[id]`, `/privacy`, `/terms`, `/cookies`, `/subprocessors` (data processors), `/security`, `/contact` (DSA contact point), `/status`, `/licenses`, `/.well-known/security.txt` | Add docs, support and supporters; legal review still required |
| Data rights and retention | Self-service JSON export, analytics opt-out with erasure, sign out everywhere, immediate account deletion; accounts deleted after 24 months without sign-in or 7 days without terms acceptance; conversations deleted 60 days after last activity; 10 MB per account, 100 questions per chat and a database-wide size guard, shown on `/limits`; security audit events in the structured log | Same, reviewed by counsel |
| License | Open source under the MIT License (`LICENSE`); dependency licenses inventoried on `/licenses` | Same |
| Analytics | Server-side PostHog events with an allowlist, HMAC distinct IDs, opt-in kill switch, per-account opt-out and account-deletion hook; no browser SDK | PostHog Cloud EU, server-side metadata-only events and operator dashboards |
| Operations | Production-parity Docker Compose with Caddy TLS, Dex OIDC, LocalStack KMS, TLS Postgres and the production image; release migrations, versioned health, tagged releases, graceful shutdown; deployed to Google Cloud Run (europe-west1) with Neon Postgres (Frankfurt) at https://beamling.app since 7 November 2026, keyless CI deploys, sign-ups limited to an allowlist; database killswitch and internal metrics; operator-scheduled service shutdown with at least 14 days' notice (English email over optional SMTP, banner, sign-ups closed, then every account deleted) | Cloud Run + Neon, GCP KMS, monitoring, backups, killswitch |
| Tests | 64 web unit tests, 41 database integration tests, 48 Playwright E2E tests, 6 mascot tests | Add parity-stack smoke, analytics, dump-encryption, load and eval gates |
| Donations | None | Optional post-public `/support` and `/supporters` |

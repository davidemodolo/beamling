# Risks, roadmap and appendix

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Provider API breaking changes | Medium | High | Adapter isolation, contract tests, pinned API versions |
| Credential leak | Low | Critical | Envelope encryption, redaction, least-privilege access, audits |
| Prompt injection degrades trust | Medium | High | Delimiting, instruction hierarchy, eval regression suite |
| Search provider cost or limit changes | Medium | Medium | Adapter isolation, user-owned keys, conservative concurrency, cache post-alpha |
| Analytics privacy or vendor issue | Medium | Medium | Server-side metadata-only events, PostHog EU/DPA, IP/GeoIP disabled, kill switch, replaceable with a BI tool over our own database |
| Missing or inaccurate legal/consent surface | Medium | High | P0 footer and legal routes, CMP with Reject all, lawyer review, link and banner tests |
| Open-source license violation | Low | High | Generated `/licenses`, dependency-license allowlist, CI gate and legal review |
| Slow answers hurt retention | Medium | High | Search-provider snippets, bounded Deep searches, streaming, honest progress |
| Abuse via multiple Google accounts | Medium | Medium | Per-IP login limits, per-account chat limits, global concurrency cap, provider quotas |
| Google OIDC outage or policy change | Medium | High | Show a clear sign-in outage state; no fallback identity provider in Alpha 1; monitor Google status |
| Local/prod crypto drift | Medium | High | Same KMS interface and migration tests; parity stack uses LocalStack KMS; production smoke test wraps/unwraps a canary key |
| Alpha provider concentration | High | High | OpenRouter and the selected search provider are per-answer single points; three search adapters reduce lock-in; clear errors, no silent fallback, contract tests |
| OpenRouter routing or upstream policy changes | Medium | Medium | Record resolved model/provider, disclose routing, surface provider errors, do not promise direct-provider privacy |
| Model deprecation or price drift | High | Medium | Curated model list refreshed from OpenRouter; pin model IDs; show provider-reported cost |
| Deep mode cost or latency spike | Medium | High | Max 7 searches, 90 s cap, visible progress, cost display, stop control |
| Trademark conflict for the name | Low | High | Clearance search before filing; domains reserved |
| Single-founder bandwidth | High | Medium | Ruthless Alpha 1 scope, no teams, no native apps |
| Legal exposure from answer content | Low | Medium | Disclaimers, report flow, no professional advice positioning |
| Dependency on a single hosting vendor | Medium | Medium | Stateless app, portable database schema, no proprietary runtime APIs, migration runbook |
| Donation platform dependency or fee change | Medium | Low | Outbound Tipeee link with PayPal fallback; no auto-funding promise; review fees before publishing |
| Donor privacy or consent error | Low | Medium | Opt-in only, exact approved text, no amounts/emails, prompt removal, no scraping |
| Ads degrade trust or add consent burden | Medium | Medium | No ads at launch; separate privacy, CMP, security and UX review if ever added |

---

## Roadmap and Milestones

| Milestone | Deliverables | Exit criteria | State |
|---|---|---|---|
| M0 — Spec | This document, brand assets brief, domain purchases | Review complete | Spec exists; domain purchase unconfirmed |
| M1 — Alpha 1 | Google-only accounts, OpenRouter credentials and streaming, Brave/Tavily/Exa search adapters, Brave plan/expiry/budget metadata, Quick, Deep, Deeper, citations, search animation, history, PostHog usage analytics, production-parity local stack | Quick and Deep cited answers render end to end; Google login works; animation follows real stages; local stack runs the production image with KMS-backed crypto | Implemented in code and tests, including PostHog events, kill switch and deletion hook; live PostHog project, dashboards and alerts remain operator setup |
| M2 — Private alpha | Onboarding, settings, usage/cost, error states, account deletion, 100-question eval, Cloud Run + Neon deploy | 10–25 invited users complete real Quick, Deep and Deeper questions without key leakage | Partial: onboarding, settings, costs, errors and deletion are implemented; Cloud Run setup, manifests and deploy job are committed; the live deploy and 100-question eval remain |
| M3 — Public launch | All launch adapters, welcome page, public docs and GitHub feedback repo, legal pages, open-source license page, key-safety explainer page (FR-60), CMP if needed, rate limits, status page | Public Google sign-in open, SLOs met for one week | Partial: killswitch, internal metrics and the generated license page are implemented; the remaining legal surface, status and watchdog remain |
| M3.1 — Support (optional, post-public) | `/support`, outbound Tipeee/PayPal link, opt-in `/supporters`, footer link | Donation link works with no payment script; consent and removal process documented | Target |
| M4 — v1 | PDF upload, share links, exports, optional public API, KMS-backed keys | Quality and security gates passed for both modes | Target |

---

## Open Questions

1. Legal setup. Which entity signs the OpenRouter and search-provider terms (Brave, Tavily, Exa), and which jurisdictions for the trademark filing?
2. Domain purchases. Register `beamling.app` now, and which defensive domains?
3. Abuse contact. Which monitored address handles abuse reports?
4. Beta cohort. Who are the first 10–25 users?
5. Analytics legal review. Confirm the PostHog Cloud EU DPA, retention and legal basis, and who owns the analytics project.
6. Future monetization and self-hosting. Subscription, prepaid credits or token resale; hosted-only or eventually self-hostable?
7. Donations. Tipeee or PayPal (or both), which legal entity receives them, tax treatment, and who curates `/supporters` with what removal SLA?
8. Performance pass (to do before public launch). No load test or profiling has been done yet. Review bottlenecks end to end: queries per chat start (settings, credentials, exchange, cap trim), database pool size against `MAX_CONCURRENT_CHATS` and streaming connections, the analytics exclusion cache, cleanup-job batch sizes (retention, inactive accounts, shutdown deletion), data export for large accounts, and decryption cost per page. Run a load test against the parity stack and set budgets for p95 latency and pool usage.

---

## Appendix

### A. Competitor summary

| Product | Hosted | BYOK | Cited answers | Self-host | Notable limitation |
|---|---|---|---|---|---|
| Perplexity | Yes | No | Yes | No | Closed providers, subscription |
| You.com | Yes | Partial | Yes | No | Limited provider control |
| Phind | Yes | No | Yes | No | Developer-focused search |
| Vane (formerly Perplexica) | No | Yes | Yes | Yes | Requires setup and maintenance |
| Morphic | No | Yes | Yes | Yes | Requires setup |
| Farfalle | No | Yes | Yes | Yes | Requires API keys and deployment |
| SurfSense | No | Yes | Yes | Yes | Requires setup |
| Open WebUI | Sometimes | Yes | Partial | Often | Not search-first |
| **Beamling** | **Yes** | **Yes** | **Yes** | **No** | New entrant, unproven |

Open WebUI is a full self-hosted chat platform: a Python and Svelte application with its own database, model registry, and plugin ecosystem. It is not a library and not a dependency of Beamling. Beamling stays a focused answer engine with a fraction of the footprint.

### B. Adapter notes

| Provider | Status | Auth style | Validation call | Generation/retrieval |
|---|---|---|---|---|
| OpenRouter | Implemented | `Authorization: Bearer` | `GET /api/v1/key` | `/api/v1/chat/completions`, SSE |
| Brave Search API | Implemented | `X-Subscription-Token` | Minimal `/res/v1/web/search` request | `/res/v1/web/search`, JSON |
| OpenAI | Post-alpha | Bearer token | List models | SSE |
| Anthropic | Post-alpha | `x-api-key` header | Small message | SSE |
| Google Gemini | Post-alpha | API key query or header | List models | SSE |
| Groq | Post-alpha | Bearer token | List models | SSE |
| Mistral | Post-alpha | Bearer token | List models | SSE |
| Tavily | Implemented | `Authorization: Bearer` | `POST /search` with one result | `/search`, JSON |
| Exa | Implemented | `x-api-key` or Bearer | `POST /search` with one result | `/search`, JSON |
| Serper | Post-alpha | `X-API-KEY` | One-result search | Not streamed |
| SearXNG | Post-alpha | None or user token | One-result search | Not streamed |

Implemented today: OpenRouter, Brave, Tavily and Exa. Verified on 2026-10-21:

- OpenRouter Chat Completions is OpenAI-compatible and streams SSE. OpenRouter comment lines (`: OPENROUTER PROCESSING`) are keep-alives. Usage arrives once in the final chunk before `[DONE]`. Mid-stream errors arrive as `data:` events with a top-level `error` and `finish_reason: "error"`.
- OpenRouter may fall back upstream on `5xx` or rate limits. The selected model ID does not change; the upstream provider may.
- Brave Web Search returns `web.results[]` with title, URL, description and an age string. Beamling uses the description only, does not request extra snippets, and never fetches the page.
- Brave's public Search plan is `$5` per 1,000 requests with `$5` monthly credit and 50 queries/second (verified 2026-10-20). Re-check pricing before publishing cost estimates. Because key validation does not expose the key's plan, Beamling asks the user to declare Free (1 request/second) or Paid and applies the conservative limiter to Free.
- Tavily Search uses `POST /search` with `Authorization: Bearer`. `basic` search costs 1 credit; `advanced` costs 2. The free plan includes 1,000 credits/month and pay-as-you-go is currently `$0.008`/credit (verified 2026-10-21).
- Exa Search uses `POST /search` with `x-api-key` or Bearer, `type=auto`, and `contents.highlights` for snippets. Responses can include `costDollars` (verified 2026-10-21).

Verify each provider's current API at implementation time. Validation calls must be the cheapest possible request.

### C. Glossary

- **BYOK:** bring your own key. The user supplies provider credentials.
- **Quick mode:** one search pass, concise cited answer.
- **Deep mode:** multi-query planning, multiple searches, longer report.
- **DEK:** data encryption key, wrapped by the master key provider.
- **SSE:** server-sent events, used for streaming answers.
- **Grounded answer:** an answer that is supported by retrieved sources.
- **Citation coverage:** the share of factual paragraphs with at least one citation.

### D. Naming and domain status (checked 2026-10-19; re-check before purchase)

The chosen primary domain is `beamling.app`. The current code derives the Next.js metadata base and landing demo host from `APP_URL`; the production configuration uses `https://beamling.app`.

| Domain | Status |
|---|---|
| **beamling.app** | **Chosen primary domain; register first** |
| beamling.ai | Available defensive option; 2-year minimum, approximately $160 |
| beamling.co | Available |
| beamling.io | Available |
| beamling.page | Available |
| beamling.dev | Available |
| beamling.com | Registered, no live site; consider an aftermarket offer later |

Trademark: no exact BEAMLING filing surfaced in initial searches. Formal clearance in classes 9 and 42 is required before use in commerce.

### E. Assumptions log

| ID | Assumption | Status |
|---|---|---|
| A1 | Web application only at launch | Verify with founder |
| A2 | English UI first, Italian second | Verify |
| A3 | Alpha 1 uses Google-only accounts; there is no guest workspace | Confirmed |
| A4 | No data-region promise in Alpha 1; provider routing is disclosed | Confirmed |
| A5 | Free at launch; monetization deferred | Confirmed |
| A6 | Single deployable service, stateless and portable across hosts | Confirmed |
| A7 | Alpha 1 ships OpenRouter and Brave, Tavily and Exa; the broader LLM matrix is post-alpha | Confirmed |
| A8 | Quick, Deep and Deeper modes at launch | Confirmed |
| A9 | No mandatory auxiliary services (Redis, workers) at launch; Deep is synchronous | Confirmed |
| A10 | Alpha 1 may use an environment-held master key; public launch uses GCP Cloud KMS | Confirmed |
| A11 | Alpha 1 does not fetch pages; snippets from the selected search provider supply the evidence | Confirmed |
| A12 | Prompts are original adaptations, not verbatim copies of leaked prompts | Confirmed |
| A13 | Alpha 1 requires Google sign-in; no guest or other identity provider | Confirmed |
| A14 | Public launch deploys on Google Cloud Run from a Docker image with Neon Postgres (moved from Fly.io on 2026-11-07: free allowance and keyless credentials) | Confirmed |
| A15 | Default model is `deepseek/deepseek-v4.1-flash` via OpenRouter | Confirmed |
| A16 | PostHog Cloud EU free tier is the Alpha 1 product analytics service; events are server-side and metadata-only | Confirmed |
| A17 | Product documentation and application source are public under the MIT License; public feedback uses GitHub issues | Confirmed |
| A18 | Public launch includes reviewed legal pages, a generated open-source license page, and a CMP only when non-essential scripts exist | Confirmed |
| A19 | Donations are post-public and optional: Tipeee primary, PayPal fallback, outbound links only; `/supporters` is opt-in and lists no amounts | Confirmed |

### F. Prompt provenance

The Quick, Deep planner, Deep synthesis and evidence-gap prompts are original Beamling prompts. They follow useful structural patterns from Perplexity's leaked system prompts: direct opening answer, citation per sourced sentence, no separate references section, plain-language formatting, and evidence-gap honesty. They deliberately do not copy Perplexity's identity, model claims, current-date text, tool names, personalization blocks or ad-hoc political instructions.

The current prompts live in `packages/web/lib/server/prompts.ts` without version labels. The `quick-v1`, `deep-planner-v1`, `deep-synthesis-v1` and `deep-gap-v1` names, and the golden-set eval gate, are target release discipline.

# Risks, roadmap and appendix

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Provider API breaking changes | Medium | High | Adapter isolation, contract tests, pinned API versions |
| Credential leak | Low | Critical | Envelope encryption, redaction, least privilege, audits |
| Prompt injection | Medium | High | Delimiting, instruction hierarchy, eval regressions |
| Search cost or limit changes | Medium | Medium | Adapters, user-owned keys, conservative concurrency, cache post-alpha |
| Analytics privacy or vendor issue | Medium | Medium | Metadata-only, EU/DPA, kill switch, replaceable |
| Missing or wrong legal/consent surface | Medium | High | P0 legal routes, CMP, lawyer review, tests |
| License violation | Low | High | Generated `/licenses`, allowlist, CI gate, legal review |
| Slow answers | Medium | High | Snippets, bounded Deep, streaming, honest progress |
| Abuse via many Google accounts | Medium | Medium | Per-IP and per-account limits, global cap |
| Google OIDC outage or policy change | Medium | High | Clear outage state; no fallback IdP in Alpha 1 |
| Local/prod crypto drift | Medium | High | Same KMS interface, LocalStack parity, production canary |
| Provider concentration | High | High | Three search adapters, clear errors, no silent fallback, contract tests |
| OpenRouter routing changes | Medium | Medium | Record and disclose resolved model/provider; no direct-provider privacy promise |
| Model deprecation or price drift | High | Medium | Curated list refreshed from OpenRouter, pinned ids, reported cost |
| Deep cost or latency spike | Medium | High | Max 7 searches, 90 s cap, progress, cost display, stop |
| Trademark conflict | Low | High | Clearance search before filing; domains reserved |
| Single-founder bandwidth | High | Medium | Tight Alpha 1 scope, no teams, no native apps |
| Legal exposure from answers | Low | Medium | Disclaimers, report flow, no professional-advice positioning |
| Hosting vendor dependency | Medium | Medium | Stateless, portable, migration runbook |
| Donation platform change | Medium | Low | Tipeee link, PayPal fallback, no auto-funding promise |
| Donor privacy error | Low | Medium | Opt-in, approved text, no amounts/emails, prompt removal |
| Ads hurt trust | Medium | Medium | No ads at launch; separate review if ever added |

---

## Roadmap and Milestones

| Milestone | Deliverables | Exit criteria | State |
|---|---|---|---|
| M0 — Spec | This spec, brand brief, domains | Review complete | Spec exists; domain purchase unconfirmed |
| M1 — Alpha 1 | Google accounts, OpenRouter, Brave/Tavily/Exa, Brave key metadata, three modes, citations, animation, history, PostHog, parity stack | Cited answers end to end; Google login; animation follows real stages; parity stack with KMS | Implemented; PostHog project, dashboards and alerts are operator setup |
| M2 — Private alpha | Onboarding, settings, usage/cost, errors, account deletion, 100-question eval, Cloud Run + Neon | 10–25 invited users run real Quick, Deep and Deeper questions without key leakage | Partial: app features done; Cloud Run setup and deploy job committed; live deploy and eval remain |
| M3 — Public launch | All adapters, welcome page, public docs and feedback repo, legal pages, license page, key-safety page (FR-76), CMP if needed, rate limits, status page | Public sign-in open, SLOs met for a week | Partial: killswitch, internal metrics, license page done; remaining legal surface, status and watchdog remain |
| M3.1 — Support (optional, post-public) | `/support`, Tipeee/PayPal link, opt-in `/supporters`, footer link | Link works with no payment script; consent and removal documented | Target |
| M4 — v1 | PDF upload, share links, exports, optional public API, KMS-backed keys | Quality and security gates for both modes | Target |

---

## Open Questions

1. Legal: which entity signs OpenRouter and search-provider terms; which trademark jurisdictions?
2. Domains: register `beamling.app` now; which defensive domains?
3. Abuse contact: which monitored address?
4. Beta cohort: who are the first 10–25 users?
5. Analytics: confirm PostHog EU DPA, retention, legal basis and project owner.
6. Monetization and self-hosting: subscription, credits or resale; hosted-only or self-hostable?
7. Donations: Tipeee, PayPal or both; receiving entity; tax; who curates `/supporters` and removal SLA?
8. Performance pass (before public launch; nothing measured yet): queries per chat start, pool size vs `MAX_CONCURRENT_CHATS` and streams, analytics exclusion cache, cleanup batch sizes, large exports, decryption per page. Load-test the parity stack and set p95 and pool budgets.

---

## Appendix

### A. Competitor summary

| Product | Hosted | BYOK | Cited answers | Self-host | Notable limitation |
|---|---|---|---|---|---|
| Perplexity | Yes | No | Yes | No | Closed providers, subscription |
| You.com | Yes | Partial | Yes | No | Limited provider control |
| Phind | Yes | No | Yes | No | Developer-focused |
| Vane (formerly Perplexica) | No | Yes | Yes | Yes | Setup and maintenance |
| Morphic | No | Yes | Yes | Yes | Setup |
| Farfalle | No | Yes | Yes | Yes | Keys and deployment |
| SurfSense | No | Yes | Yes | Yes | Setup |
| Open WebUI | Sometimes | Yes | Partial | Often | Not search-first |
| **Beamling** | **Yes** | **Yes** | **Yes** | **No** | New, unproven |

Open WebUI is a self-hosted chat platform, not a Beamling dependency.

### B. Adapter notes

| Provider | Status | Auth style | Validation call | Generation/retrieval |
|---|---|---|---|---|
| OpenRouter | Implemented | `Authorization: Bearer` | `GET /api/v1/key` | `/api/v1/chat/completions`, SSE |
| Brave Search API | Implemented | `X-Subscription-Token` | Minimal `/res/v1/web/search` | `/res/v1/web/search`, JSON |
| OpenAI | Post-alpha | Bearer | List models | SSE |
| Anthropic | Post-alpha | `x-api-key` | Small message | SSE |
| Google Gemini | Post-alpha | API key query or header | List models | SSE |
| Groq | Post-alpha | Bearer | List models | SSE |
| Mistral | Post-alpha | Bearer | List models | SSE |
| Tavily | Implemented | `Authorization: Bearer` | `POST /search`, one result | `/search`, JSON |
| Exa | Implemented | `x-api-key` or Bearer | `POST /search`, one result | `/search`, JSON |
| Serper | Post-alpha | `X-API-KEY` | One-result search | Not streamed |
| SearXNG | Post-alpha | None or user token | One-result search | Not streamed |

Verified 2026-10-21 (see [Providers](../reference/providers.md) for current behavior):

- OpenRouter streams OpenAI-compatible SSE. `: OPENROUTER PROCESSING` lines are keep-alives; usage comes once in the last chunk before `[DONE]`; mid-stream errors are `data:` events with `error` and `finish_reason: "error"`.
- OpenRouter may fall back upstream on `5xx` or rate limits; the model id stays, the upstream provider may change.
- Brave returns `web.results[]`; Beamling uses the description only, requests no extra snippets and never fetches the page. Brave has a free plan. The API doesn't expose the plan, so users declare Free (Beamling limits it to 1 request/second) or Paid.
- Tavily: `POST /search` with Bearer; `advanced` costs more credits than `basic`. Tavily has a free plan.
- Exa: `POST /search` with `type=auto` and `contents.highlights`; responses may include `costDollars`.

Re-check APIs and pricing before implementing or publishing cost estimates. Validation calls must be the cheapest request.

### C. Glossary

- **BYOK:** bring your own key.
- **Quick mode:** one search, concise cited answer.
- **Deep mode:** planned multi-search, longer report.
- **DEK:** data encryption key, wrapped by the master key provider.
- **SSE:** server-sent events, for streaming.
- **Grounded answer:** supported by retrieved sources.
- **Citation coverage:** share of factual paragraphs with a citation.

### D. Naming and domain status (checked 2026-10-19; re-check before purchase)

Primary domain: `beamling.app`. The code derives the metadata base and landing demo host from `APP_URL` (`https://beamling.app` in production).

| Domain | Status |
|---|---|
| **beamling.app** | **Chosen primary; register first** |
| beamling.ai | Available defensive option |
| beamling.co | Available |
| beamling.io | Available |
| beamling.page | Available |
| beamling.dev | Available |
| beamling.com | Registered, no site; maybe an aftermarket offer later |

Trademark: no exact BEAMLING filing found. Formal clearance in classes 9 and 42 before commercial use.

### E. Assumptions log

| ID | Assumption | Status |
|---|---|---|
| A1 | Web only at launch | Verify with founder |
| A2 | English UI first, Italian second | Verify |
| A3 | Google-only accounts; no guest workspace | Confirmed |
| A4 | No data-region promise in Alpha 1; routing disclosed | Confirmed |
| A5 | Free at launch; monetization deferred | Confirmed |
| A6 | One stateless, portable service | Confirmed |
| A7 | Alpha 1: OpenRouter + Brave, Tavily, Exa; wider LLM matrix post-alpha | Confirmed |
| A8 | Quick, Deep and Deeper at launch | Confirmed |
| A9 | No Redis or workers at launch; Deep is synchronous | Confirmed |
| A10 | Alpha 1 may use an env master key; public launch uses GCP Cloud KMS | Confirmed |
| A11 | No page fetching; provider snippets are the evidence | Confirmed |
| A12 | Prompts are original adaptations, not copies of leaked prompts | Confirmed |
| A13 | Google sign-in required; no guest or other IdP | Confirmed |
| A14 | Launch on Cloud Run + Neon from the Docker image (moved from Fly.io on 2026-11-07: free allowance, keyless credentials) | Confirmed |
| A15 | Default model `deepseek/deepseek-v4.1-flash` via OpenRouter | Confirmed |
| A16 | PostHog Cloud EU free tier, server-side metadata events | Confirmed |
| A17 | Docs and source public under MIT; feedback via GitHub issues | Confirmed |
| A18 | Reviewed legal pages, generated license page, CMP only for non-essential scripts | Confirmed |
| A19 | Donations post-public and optional: Tipeee, PayPal fallback, outbound only; opt-in `/supporters` without amounts | Confirmed |

### F. Prompt provenance

The Quick, Deep planner, Deep synthesis and evidence-gap prompts are original. They borrow structure from Perplexity's leaked prompts (direct opening answer, citation per sourced sentence, no references section, plain formatting, honest evidence gaps) but not its identity, model claims, date text, tool names, personalization or political instructions.

Prompts live unversioned in `packages/web/lib/server/prompts.ts`. The `quick-v1`, `deep-planner-v1`, `deep-synthesis-v1` and `deep-gap-v1` names and the golden-set gate are target release discipline.

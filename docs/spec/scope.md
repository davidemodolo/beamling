# Scope and user flows

## Scope and Feature Set

### Alpha 1 scope

First end-to-end BYOK slice: OpenRouter or DeepSeek generation; Brave, Tavily, Exa or DeepSeek retrieval (one per answer; one DeepSeek key can serve both); Quick, Deep, Deeper; animated search. State is the current checkout.

| Area | Feature | Priority | State |
|---|---|---|---|
| Auth | Google-only OIDC, database-backed session cookie, no guest workspaces | P0 | Implemented |
| Onboarding | Free path (free OpenRouter model + Brave) or own providers; model key, then search key; Brave plan and optional key limits | P0 | Implemented |
| Models | Five curated OpenRouter models; DeepSeek V4.1 Flash default | P0 | Implemented |
| Chat | Ask, stream the answer, inline citations | P0 | Implemented |
| Retrieval | Brave, Tavily or Exa; titles, URLs, snippets; one provider per answer | P0 | Implemented |
| Sources | Source panel with title, domain, date, snippet, link | P0 | Implemented |
| Animation | Beamling states for queued, searching, reading, writing, done, errors | P0 | Implemented |
| Deep mode | Planner, 3–5 sub-queries, optional gap pass, longer cited report | P0 | Implemented |
| Deeper mode | Agentic loop with a search tool, adaptive rounds, hard 60-search budget, long cited report | P0 | Implemented |
| History | List, open, delete conversations | P0 | Implemented |
| Settings | One modal for keys, key plan/expiry/budget, default model, search provider and mode | P0 | Partial: model, mode, provider and Brave limits; no cost ceiling |
| Costs | Per-answer tokens, generation cost, search-provider cost | P0 | Implemented: OpenRouter actual + selected-provider estimate |
| Analytics | Server-side PostHog Cloud EU events and usage dashboards; metadata only | P0 | Implemented: allowlisted events, HMAC IDs, kill switch, deletion hook; dashboards are operator setup |
| Errors | Invalid key, insufficient credits, rate limit, provider outage, no sources | P0 | Implemented |
| Account | Delete account and data; sign out | P0 | Implemented |
| Files | PDF upload and Q&A over the document | P2 | Target |
| Teams | Shared workspaces and roles | P3 | Target |
| API | Public API for programmatic queries | P3 | Target |

### Alpha 1 provider decisions (target)

**Current:** OpenRouter and DeepSeek generation; Brave, Tavily, Exa and DeepSeek search; one registry ([providers](../reference/providers.md)). DeepSeek is China-based; its key card, onboarding field and Defaults say Beamling takes no responsibility for its data handling. Provider stored per answer, no fallback. Tavily and Exa: basic search, one 429 retry. Provider-specific concurrency and reported search costs are target.

**LLM: OpenRouter only.**

- Auth: `Authorization: Bearer <user key>`.
- Validation: `GET /api/v1/key` (no tokens spent).
- Default model: `nvidia/nemotron-3.5-super-vl:free` (also the free setup model; changed 2026-11-08).
- Allowlist (verified 2026-10-20):
  - `nvidia/nemotron-3.5-super-vl:free` (default and free setup path; added 2026-11-08)
  - `deepseek/deepseek-v4.1-flash`
  - `anthropic/claude-sonnet-4.5`
  - `anthropic/claude-haiku-4.5`
  - `openai/gpt-5.2`
  - `google/gemini-3.8-flash`
  - `google/gemma-4-31b-it:free` (added 2026-11-07)
- No auto-router (no silent model switch). IDs come from the allowlist, never free text; refresh from `GET /api/v1/models`, drop deprecated IDs.
- Generation: `POST /api/v1/chat/completions`, `stream: true`.
- Cost: `usage.prompt_tokens`, `usage.completion_tokens`, `usage.cost`; catalog pricing only without `usage.cost`.
- Attribution headers: `HTTP-Referer`, `X-OpenRouter-Title`.
- Beamling never changes the model ID; OpenRouter may pick the upstream. Each answer stores the returned model and upstream when available.
- Every LLM call (planning, gap review) uses the selected model; no hidden utility model.
- `max_tokens` (reasoning + answer): Quick 8,192, Deep 16,384 (when supported), planner 2,000, gap 1,500.
- No direct OpenAI, Anthropic, Gemini, Groq or Mistral adapters in Alpha 1.

**Search: Brave, Tavily or Exa; one provider per answer.** All three and a per-answer picker are implemented.

- Default set in Settings, changeable between answers, stored per assistant message.
- No saved credential: `CREDENTIAL_MISSING`, UI links to onboarding/settings. No fallback.
- One `SearchProvider` interface returns `{url, title, domain, snippet, publishedAt?, rank}`. Adapters own auth, validation, query clamping, rate limits, error mapping and cost estimation. Only the selected adapter runs.

**Brave adapter**

- `GET https://api.search.brave.com/res/v1/web/search`, `X-Subscription-Token: <user key>`.
- Snippet = `description` only; no `extra_snippets`, no page fetch (no SSRF surface).
- Validate with `q`, `count=1`; no plan-gated parameters.
- Queries ≤ 600 characters / 75 words.
- `count`: Quick `min(maxSources, 20)`; Deep 6 per sub-query, at most 7 searches including the gap pass; Deeper 6 per query, at most 60 searches.
- Default safe search; `search_lang` from the detected language.
- `freshness` only for recency questions: `pd`, `pw`, `pm`, `py`, or `YYYY-MM-DDtoYYYY-MM-DD`.
- Plan is user-declared (the API doesn't expose it): **Free** (1 request/second) or **Paid / provider plan**.
- Free keys: serialized per key, ≥ 1,100 ms apart across instances (`BRAVE_MIN_INTERVAL_MS`). Paid: plan interval or none. Limiter keyed by credential hash.
- Deep and Deeper concurrency 2; a Free key still runs one search at a time.
- Optional user-declared expiry and monthly USD budget (not verifiable).
- Requests and estimated cost recorded per credential; non-blocking warnings at 80%/100% of budget and 14/7/1 days before expiry. `402` → `INSUFFICIENT_CREDITS`.
- Cost: one unit per request at the plan rate; Free requests count toward the monthly allowance.
- Same-fingerprint replacement keeps plan, limits and usage period; a different key starts a new period.

**Tavily adapter**

- `POST https://api.tavily.com/search`, `Authorization: Bearer <user key>`.
- Validate with `GET https://api.tavily.com/usage` (free). `401` rejected; usage ≥ a non-null limit → `QUOTA_EXCEEDED`.
- `search_depth=basic` (1 credit); no `advanced` or `auto_parameters`.
- `max_results`: Quick `min(maxSources, 20)`; Deep 6 per sub-query, at most 7 requests; Deeper 6 per query, at most 60 searches.
- Snippet from `content`; plus `title`, `url`, `published_date`, `score`. No `include_raw_content`.
- `topic=general`, `news` only for recency. Recency → `time_range` (`day`, `week`, `month`, `year`); `start_date`/`end_date` only for custom ranges.
- `include_published_date=true`; keep undated results unless a strict window is asked. `safe_search=true`.
- Record `usage.credits` (`include_usage=true`); estimate cost from the plan rate.
- Errors: `432` → `SEARCH_PLAN_MISSING`, `433` → `QUOTA_EXCEEDED`, `401` → `CREDENTIAL_INVALID`, `429` → `PROVIDER_RATE_LIMITED`, `5xx` → `PROVIDER_UNAVAILABLE`.

**Exa adapter**

- `POST https://api.exa.ai/search`, `x-api-key: <user key>`.
- Validate with a probe `query`, `numResults=1`, `type="auto"`, `contents={"highlights": true}`.
- `type="auto"` always; no `deep` or `deep-reasoning`.
- `numResults`: Quick `min(maxSources, 100)`; Deep 6 per sub-query, at most 7 requests; Deeper 6 per query, at most 60 searches.
- Snippet from highlights; plus `title`, `url`, `publishedDate`. No `contents.text` or summary.
- `startPublishedDate`/`endPublishedDate` only for recency windows.
- `moderation=true` unless it removes useful results; record the setting.
- `costDollars` is actual when present; otherwise estimated and labelled so.
- `401`/`402`/`403`/`429`/`5xx` map to shared codes; `402` is insufficient credits.

**Shared search rules**

- Clamp queries per provider; 400 characters / 50 words where none is published.
- Budgets: Quick ≤ 8 sources. Deep ≤ 6 results per sub-query, ≤ 20 sources, ≤ 7 searches. Deeper ≤ 60 sources and 60 searches.
- A source needs a URL and a non-empty snippet; with none, return the canned insufficient-sources answer ([pipeline](pipeline.md#stages)).
- Serialize per key (Brave Free 1,100 ms, Brave Paid plan interval, Tavily/Exa per plan). Deep concurrency 2, within the provider limit.
- On `429`, retry once honoring `Retry-After`, then continue.
- Record the provider on every message and in `meta`/`usage`; never switch silently.
- Cost: Brave per request, Tavily per credit, Exa reported dollars. Reported = actual, rate-based = estimated.
- No Serper or SearXNG in Alpha 1.

**Post-alpha:** OpenAI, Anthropic, Gemini, Groq, Mistral, Serper, SearXNG, each once its adapter passes validation, streaming, error-mapping and cost tests.

### Alpha 1 exit criteria (target)

1. A new user signs in with Google and adds an OpenRouter key and a Brave, Tavily or Exa key; both validate.
2. Quick returns a cited answer with ≥ 3 usable sources.
3. Deep plans 3–5 sub-queries, runs ≥ 2 searches, returns a longer cited report flagging thin evidence.
4. Deeper runs several agent-chosen rounds, ≤ 60 searches, and returns a long cited report.
5. Animation starts within 100 ms of submit, moves through `searching` and `reading`, stops search motion at `writing`.
6. Every displayed source was in the prompt; numbering matches citations.
7. OpenRouter and search errors map to stable codes and never expose a plaintext key.
8. A stopped answer keeps its partial text and is marked stopped.
9. Typecheck, lint, citation-parsing and error-mapping unit tests, and the Quick/Deep/Deeper golden-set smoke evaluation pass.

---

## Core User Flows

Plan metadata is Brave-only; see [current implementation](index.md#document-status-and-current-implementation).

### Sign-in and onboarding

1. "Get started" on the welcome page → `/login`, whose only option is **Continue with Google**.
2. `GET /api/auth/login` sets a short-lived signed OIDC transaction cookie (`state`, `nonce`, PKCE verifier, return path) and redirects to Google with `openid email profile`.
3. `GET /api/auth/callback/google` verifies cookie, `state`, `nonce`, PKCE, ID-token signature, issuer, audience, expiry and `email_verified` (else `AUTH_EMAIL_UNVERIFIED`).
4. The server upserts the account by Google `sub` (email, name, avatar URL), creates an opaque session with a hashed token, sets the cookie. A returning `sub` resumes its account.
5. Signed in, `/` redirects to `/onboarding` until a model key and a search key are saved.
6. The user picks **Quick setup** (OpenRouter free model + Brave) or **Use my own providers** and adds a model key, sent once over HTTPS.
7. The server validates it (`GET https://openrouter.ai/api/v1/key`) and stores it encrypted; the client gets only the last four characters, status and validation time.
8. The user adds a search key (Brave on the free path). Brave also takes **Free (1 request/second)** or **Paid / provider plan**, optional expiry and budget. Tavily validates for free; Brave and Exa cost one search, so the key can be saved unverified.
9. "Start asking" saves model and provider as defaults and opens an empty chat.

No guest or anonymous path: `/login` is the only way into the app and `/onboarding`. `/` is the landing page signed out and the app signed in. Target: first cited answer in under three minutes.

### Ask a question

1. Enter: the client enters `queued`, starts the animation, adds the user message optimistically and calls `POST /api/chat`.
2. The server decrypts credentials in memory and emits `meta` (conversation, message and user-message ids, conversations removed by the per-account cap) and `stage: queued`.
3. Query understanding: normalization, language detection. Quick: one research-loop step writes a self-contained query from the question and recent conversation. Deep: planner. Deeper: agent loop.
4. `stage: searching` with real detail ("Planning 4 searches", "Searching 2 of 4").
5. Quick runs one search; Deep 3–5 sub-queries with bounded concurrency; Deeper a search tool with 1–4 queries per step, until it has enough evidence, 60 searches or the time limit. Each query emits `search` (`searching`, then `done`/`failed` with result count) and `progress`.
6. Rank and deduplicate; `stage: reading`, then `sources` with final numbering.
7. `stage: writing`: `reasoning` deltas when available, answer `delta`s with citations parsed live. Invalid indices are removed; valid chips highlight and Beamling pulses per citation.
8. `usage`: tokens, generation cost, search provider and its request/credit cost.
9. `done`. Stored: sources, search trace, reasoning, actual OpenRouter model, upstream when reported, Brave request/cost data. A per-message search-provider field is target.

### Follow-up

- Every question runs fresh retrieval. Earlier turns are context, trimmed to the budget, with citation markers stripped.
- Sources are numbered from 1 per assistant message.
- The UI shows the animation and a "new search" indicator whenever retrieval runs.

### Manage credentials and declared limits

- Settings lists credentials by provider: masked last four (`•••• 7Q2F`), last validation time.
- Brave cards: plan (**Free · 1 req/s** or **Paid**), optional expiry, optional budget with estimated usage and next warning threshold.
- Replace or delete a key; edit plan, expiry and budget without re-entering it.
- Warnings in the key card and a dismissible chat banner at 80%/100% of budget or 14/7/1 days before expiry.
- Deleting a credential irrecoverably deletes the encrypted record and its usage rows.
- The plaintext key is never returned.
- Declared limits are user metadata: "You set a budget of…", never "Brave says…".

### Delete account and data

- Confirm by typing `DELETE`. No email; the Google identity is untouched.
- Conversations, messages, sources, credentials, usage totals and the workspace key are hard-deleted in one transaction.
- Without the workspace key, leftover ciphertext is unreadable through the app. Backups hold only ciphertext under the KMS master key and expire within 30 days.

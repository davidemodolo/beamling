# Scope and user flows

## Scope and Feature Set

### Alpha 1 scope

Alpha 1 is the first end-to-end, BYOK product slice. It is deliberately narrow: OpenRouter or DeepSeek for generation; Brave, Tavily, Exa or DeepSeek for retrieval (one selected provider per answer; one DeepSeek key can serve both); Quick, Deep and Deeper modes; and the animated search experience. The state column records the current checkout against that target.

| Area | Feature | Priority | State |
|---|---|---|---|
| Auth | Google-only OIDC sign-in, database-backed session cookie, no guest workspaces. | P0 | Implemented |
| Onboarding | Add OpenRouter key, choose a search provider and add its key, declare Brave plan and optional key limits, validate both on one screen | P0 | Implemented: provider picker plus Brave key metadata |
| Models | Five curated OpenRouter models; DeepSeek V4.1 Flash is the default | P0 | Implemented |
| Chat | Ask a question, stream the answer, render inline citations | P0 | Implemented |
| Retrieval | Brave, Tavily or Exa; titles, URLs and snippets; one selected provider per answer | P0 | Implemented |
| Sources | Right-hand source panel with title, domain, date, snippet, link | P0 | Implemented |
| Animation | Beamling working state for queued, searching, reading, writing, done and errors | P0 | Implemented |
| Deep mode | Planner, 3–5 sub-queries, optional gap pass, longer cited report | P0 | Implemented |
| Deeper mode | Agentic research loop with a search tool, adaptive rounds and a hard 60-search budget, then a long cited report | P0 | Implemented |
| History | List, open, delete conversations | P0 | Implemented |
| Settings | One modal for keys, key plan/expiry/budget, default model, default search provider and default mode | P0 | Partial: model, mode, provider and Brave limits; no cost ceiling |
| Costs | Per-answer token counts, generation cost and selected search-provider cost | P0 | Implemented: OpenRouter actual + selected-provider estimate |
| Analytics | Server-side PostHog Cloud EU events and internal usage dashboards; metadata only | P0 | Implemented: allowlisted events, HMAC IDs, kill switch and deletion hook; live dashboards are operator setup |
| Errors | Invalid key, insufficient credits, rate limit, provider outage, no sources | P0 | Implemented |
| Account | Delete the account and its data; sign out | P0 | Implemented |
| Files | PDF upload and question answering over the document | P2 | Target |
| Teams | Shared workspaces and roles | P3 | Target |
| API | Public API for programmatic queries | P3 | Target |

### Alpha 1 provider decisions (target)

**Current adapters:** OpenRouter and DeepSeek generation plus Brave, Tavily, Exa and DeepSeek search, registered in one provider registry. DeepSeek is based in China; its key card, onboarding field and Defaults show a notice that Beamling takes no responsibility for how it handles data. The selected provider is stored per answer; there is no fallback. Tavily and Exa use basic search with a single 429 retry; provider-specific concurrency limits and provider-reported search costs remain target work.

**LLM: OpenRouter only.**

- Auth: `Authorization: Bearer <user key>`.
- Validation: `GET /api/v1/key`; this validates the key without spending generation tokens and returns limits, usage and free-tier status.
- Default model: `deepseek/deepseek-v4.1-flash`, verified against OpenRouter on 2026-10-20.
- Alpha allowlist, verified 2026-10-20:
  - `deepseek/deepseek-v4.1-flash` (default)
  - `anthropic/claude-sonnet-4.5`
  - `anthropic/claude-haiku-4.5`
  - `openai/gpt-5.2`
  - `google/gemini-3.8-flash`
- Do not expose OpenRouter's auto-router in Alpha 1; it would hide model selection and break "no silent model switch."
- Model IDs come from the allowlist, not free-text input. Refresh the list from `GET /api/v1/models` at implementation time and remove deprecated IDs.
- The resolved OpenRouter model ID is stored per answer.
- Generation: `POST /api/v1/chat/completions` with `stream: true`.
- Usage and cost: use `usage.prompt_tokens`, `usage.completion_tokens` and `usage.cost` when present. Fall back to catalog pricing only when `usage.cost` is absent.
- Attribution headers: `HTTP-Referer` and `X-OpenRouter-Title`.
- OpenRouter routing is disclosed. Beamling never changes the selected model ID, but OpenRouter may route the same model to an upstream provider. The answer records the model returned by OpenRouter and the upstream provider when available.
- All LLM calls in one answer, including planning and gap review, use the same selected model. There is no hidden utility-model switch.
- Set `max_tokens` to 8,192 for Quick synthesis and 16,384 for Deep synthesis when the model supports it. The budget covers both reasoning and answer tokens, so it must not be sized from the answer alone. Planner calls use 2,000 and gap calls 1,500 for the same reason.
- No direct OpenAI, Anthropic, Gemini, Groq or Mistral adapters in Alpha 1.

**Search target: Brave, Tavily or Exa; one active provider per answer.** The current code implements all three branches and a per-answer picker.

The user picks a default search provider in Settings and can change it between answers. The selected provider is stored with each assistant message. If the selected provider has no saved credential, the request fails with `CREDENTIAL_MISSING` and the UI links to onboarding/settings. Beamling never falls back to another search provider.

A single `SearchProvider` adapter interface normalizes every provider to `{url, title, domain, snippet, publishedAt?, rank}`. Adapters own auth, validation, query clamping, rate limits, error mapping and cost estimation. Only the selected adapter runs for an answer.

**Brave adapter**
- Endpoint: `GET https://api.search.brave.com/res/v1/web/search` (Brave Web Search).
- Auth: `X-Subscription-Token: <user key>`.
- Uses standard Web Search results: title, URL and description snippet. It does not request extra snippets or fetch pages. This removes the page-fetch/SSRF surface from the alpha.
- Validate with one minimal Web Search request (`q` and `count=1`). Do not send optional plan-gated parameters during validation.
- Use only the `description` field for snippets. Do not request `extra_snippets`.
- Query strings are clamped to Brave's documented 600-character / 75-word limit.
- Quick budget: `count=min(maxSources, 20)`.
- Deep budget: `count=6` per sub-query; at most 7 searches per answer including the gap pass.
- Deeper budget: `count=6` per query; the research agent may run up to 60 searches in total.
- Use Brave provider defaults for safe search. Set `search_lang` from the detected question language when known.
- Set `freshness` only when the user asks for recent information: 1 day `pd`, 7 days `pw`, 30 days `pm`, 365 days `py`, otherwise a custom `YYYY-MM-DDtoYYYY-MM-DD` range.
- A source is usable only if it has a URL and a non-empty description snippet. If no usable source remains, skip generation and return the canned insufficient-sources answer.
- At onboarding, the user declares the Brave plan for the key: **Free** (1 request/second) or **Paid / provider plan**. Brave's key-validation response does not expose the plan or its QPS, so this is user-declared metadata, not a provider-verified fact.
- Free keys are serialized per key with a minimum interval of 1,100 ms across all app instances (`BRAVE_MIN_INTERVAL_MS`, default 1,100). Paid keys use the configured plan interval or no extra spacing when the plan is above the app's concurrency. The limiter is keyed by a hash of the credential, not by user or provider alone.
- Deep and Deeper concurrency is 2, so a Free key still runs at most one search at a time.
- The user may declare an optional expiry date and a monthly budget in USD. These are limits set on the provider's website; Beamling cannot verify them from the API. The UI must label them **user-declared**.
- Beamling records requests and estimated cost per credential and warns at 80%/100% of the declared budget and 14/7/1 days before expiry. A warning never blocks a search; the provider remains the authority. If the provider returns `402`, map it to `INSUFFICIENT_CREDITS` as usual.
- Brave request cost is recorded as one search-unit per request at the configured plan rate; the current public Search plan is `$0.005` per request (verified 2026-10-20). Free-plan requests still count toward the monthly allowance even when the list price is covered by credit.
- Replacing a Brave key with the same fingerprint preserves the declared plan, limits and usage period; a different key starts a new usage period.

**Tavily adapter**
- Endpoint: `POST https://api.tavily.com/search`.
- Auth: `Authorization: Bearer <user key>`.
- Validate with `GET https://api.tavily.com/usage`, which reports the key's credits without spending one. Reject `401`; map a usage at or above a non-null limit to `QUOTA_EXCEEDED`. Do not spend a search to validate the key.
- Use `search_depth=basic` in Alpha 1 (1 credit per request). Do not use `advanced` or `auto_parameters`.
- Use `max_results=min(maxSources, 20)` for Quick and `max_results=6` per Deep sub-query; at most 7 Tavily requests per answer including the gap pass. Deeper uses 6 results per query and at most 60 searches.
- Map the result `content` field to the source snippet; use `title`, `url`, `published_date` and `score`. Do not request `include_raw_content`.
- Default to `topic=general`; use `topic=news` only for recency questions. Map recency to `time_range` (`day`, `week`, `month`, `year`) and set `start_date`/`end_date` only when a custom range is needed.
- Set `include_published_date=true` so source dates are available; do not filter out undated results unless the user asks for a strict date window.
- Set `safe_search=true` for the basic depth, which supports it.
- Tavily returns `usage.credits` when `include_usage=true`; record credits and estimate cost from the configured plan rate. The free plan includes 1,000 credits/month; pay-as-you-go is currently `$0.008`/credit, and basic search is 1 credit (verify before publishing).
- Tavily `432` and `433` are plan/limit errors and map to `SEARCH_PLAN_MISSING` and `QUOTA_EXCEEDED`; `401` maps to `CREDENTIAL_INVALID`; `429` to `PROVIDER_RATE_LIMITED`; `5xx` to `PROVIDER_UNAVAILABLE`.

**Exa adapter**
- Endpoint: `POST https://api.exa.ai/search`.
- Auth: `x-api-key: <user key>` (Bearer is also accepted; use `x-api-key` for consistency).
- Validate with one minimal request: a short probe `query`, `numResults=1`, `type="auto"`, and `contents={"highlights": true}`. Do not request full page text.
- Use `type="auto"` in every mode; do not use `deep` or `deep-reasoning` in Alpha 1.
- Use `numResults=min(maxSources, 100)` for Quick and `numResults=6` per Deep sub-query; at most 7 Exa requests per answer including the gap pass. Deeper uses 6 results per query and at most 60 searches.
- Request `contents.highlights=true` and map the returned highlight text to the source snippet; use `title`, `url` and `publishedDate` when present. Do not request `contents.text` or a summary.
- Map recency to `startPublishedDate`/`endPublishedDate` only when the user asks for a recent window; otherwise omit date filters.
- Set `moderation=true` unless it materially removes useful results; record the setting.
- Exa returns `costDollars` when available; record actual cost. Otherwise estimate from the configured plan rate and label it estimated.
- Exa `401`/`402`/`403`/`429`/`5xx` map to the shared search error codes; `402` is insufficient credits.

**Shared search rules**
- Query strings are clamped to each provider's documented limit; Brave is 600 characters / 75 words. For providers without a published cap, clamp to 400 characters / 50 words.
- Quick: at most 8 sources. Deep: at most 6 results per sub-query and at most 20 sources across the answer; at most 7 searches including the gap pass. Deeper: at most 60 sources and 60 searches. These budgets are provider-independent.
- A source is usable only if it has a URL and a non-empty snippet. If no usable source remains, skip generation and return the canned insufficient-sources answer.
- Serialize requests per provider key: Brave Free with a 1,100 ms minimum interval (`BRAVE_MIN_INTERVAL_MS`), Brave Paid at the configured plan interval; Tavily and Exa with provider-specific limits from their current plans. Deep concurrency is 2, but never above the selected provider's limit.
- On `429`, retry once with backoff and respect `Retry-After`, then continue with remaining results.
- Record the selected provider on every message and in the `meta`/`usage` events. Never silently switch providers.
- Cost is per provider: Brave per request, Tavily per credit, Exa provider-reported dollars when available. Label provider-reported values actual and configured-rate estimates estimated.
- No Serper or SearXNG adapter in Alpha 1. Both remain post-alpha.

**Post-alpha provider matrix:** OpenAI, Anthropic, Gemini, Groq, Mistral, Serper and SearXNG. A provider is listed only after its adapter passes validation, streaming, error-mapping and cost-estimation tests.

### Alpha 1 exit criteria (target)

1. A new user signs in with Google, adds an OpenRouter key and one search-provider key (Brave, Tavily or Exa), and both validate with provider-specific results.
2. A Quick question returns a cited answer with at least three usable sources.
3. A Deep question produces 3–5 planned sub-queries, runs at least two searches, and returns a longer cited report with visible uncertainty where evidence is thin.
4. A Deeper question runs multiple agent-chosen search rounds, never exceeds 60 searches, and returns a long cited report from the collected sources.
4. The Beamling mascot enters a working animation within 100 ms of submit, animates through `searching` and `reading`, and stops its search motion when `writing` begins.
5. Every source card displayed was actually used in the prompt; source numbering matches citation numbers.
6. OpenRouter and the selected search provider's errors are mapped to stable codes and never expose a plaintext key.
7. A stopped answer keeps its partial text and marks itself stopped without persisting a false completion.
9. The app passes typecheck, lint, unit tests for citation parsing and provider error mapping, and the Quick/Deep/Deeper golden-set smoke evaluation.

---

## Core User Flows

The current flow is one model provider (OpenRouter or DeepSeek) plus one selected search provider, with encrypted content. Provider-specific plan metadata remains Brave-only; see [Document status and current implementation](index.md#document-status-and-current-implementation).

### Sign-in and onboarding

1. The user lands on the welcome page and clicks "Start free".
2. An unauthenticated visitor is sent to `/login`. The only sign-in option is **Continue with Google**.
3. `GET /api/auth/login` creates a short-lived, signed OIDC transaction cookie containing `state`, `nonce`, PKCE verifier and the post-login return path, then redirects to Google's authorization endpoint with scopes `openid email profile`.
4. Google redirects to `GET /api/auth/callback/google`. The server verifies the transaction cookie, `state`, `nonce`, PKCE, the ID-token signature, issuer, audience, expiry and `email_verified`. An unverified email is rejected with `AUTH_EMAIL_UNVERIFIED`.
5. The server upserts one account by Google subject (`sub`), stores the verified email, display name and avatar URL, creates an opaque session, hashes its token at rest and sets the session cookie. A returning Google subject resumes the same account.
6. The user is redirected to `/onboarding` (or `/chat` when keys are already connected).
7. Onboarding step 1: the user adds an OpenRouter key. The client sends it once to the server over HTTPS.
8. The server validates it with `GET https://openrouter.ai/api/v1/key`, then stores it encrypted. The client receives only the masked last four characters, status and validation time; provider limit/label details are not returned today.
9. On the same screen, the user chooses Brave, Tavily or Exa and adds its key. For Brave, the user also selects **Free (1 request/second)** or **Paid / provider plan** and may declare an optional key expiry date and budget. Tavily is checked through its free usage endpoint. Brave and Exa require one search request to validate, so the user may save the key unverified and validate it later.
10. The user confirms the OpenRouter model (DeepSeek V4.1 Flash by default) and clicks "Start asking".
11. The chat opens empty, ready for the first question. Onboarding is complete.

There is no guest workspace, anonymous session or account-less path. `/login` is the only entry point to `/chat` and `/onboarding`; the landing page remains public.

Target: under three minutes from first visit to first cited answer.

### Ask a question

1. User types a question and presses Enter. The client immediately enters `queued` and starts the Beamling working animation.
2. The client creates a user message optimistically and calls `POST /api/chat`.
3. The server resolves the credentials, decrypts them in memory, and starts the pipeline.
4. The server emits `meta` (conversation, message and user-message ids, plus conversations removed by the per-account cap) and `stage: queued`. The selected model and search provider are shown from the request, stored settings and answer metadata.
5. Query understanding runs: normalization, language detection and, for Deep, a planner call. Deeper starts an agent loop instead. Quick runs the research loop with a one-search budget: one model step writes a single self-contained query from the question and recent conversation.
6. The server emits `stage: searching` with a real detail such as "Planning 4 searches" or "Searching 2 of 4".
7. For Quick, one search runs on the selected provider. For Deep, 3–5 sub-queries run with bounded concurrency. For Deeper, the model calls a search tool with 1–4 queries per step; each query emits `search` with `searching`, then `done`/`failed` and its result count. Each completion emits `progress`. The loop stops when the model says the evidence is sufficient, when it reaches 60 searches, or when the time limit stops the run.
8. The server ranks and deduplicates the returned results, emits `stage: reading`, then `sources` with the final, stable numbering.
9. The context is assembled with numbered `<source>` blocks and sent to OpenRouter.
10. The server emits `stage: writing`. Reasoning deltas, when the model provides them, stream as `reasoning`. Answer text streams as `delta`; citation markers are parsed as they arrive.
11. Invalid citation indices are removed. The client highlights valid citation chips and pulses Beamling on each new citation.
12. The server emits `usage` with token counts, provider-reported generation cost, the selected search provider and its request/credit cost.
13. The server emits `done`. The message is persisted with its sources, search trace, model reasoning, actual OpenRouter model, upstream provider when reported, and the Brave request/cost data. A per-message search-provider field is target behavior.

### Follow-up

- Every Alpha 1 question runs a fresh retrieval on the selected provider, including follow-ups. Earlier turns are included as conversation context, but their citation markers are stripped before prompt assembly so source numbers cannot collide.
- The conversation context includes the previous answer and question, trimmed to the model budget.
- New sources are numbered from 1 for each assistant message.
- The UI shows the working animation and a "new search" indicator whenever retrieval runs again.

### Manage credentials and declared limits

- The settings modal lists credentials by provider, with the masked last four characters (for example, `•••• 7Q2F`) and last validation time.
- Brave cards show the declared plan (**Free · 1 req/s** or **Paid**), the optional expiry date and the optional budget with estimated usage and the next warning threshold.
- The user can replace or delete a credential, change the Brave plan, or edit the expiry and budget without re-entering the key.
- Warnings are shown inline in the key card and as a dismissible banner in chat when a search would exceed 80%/100% of the declared budget or the key expires within 14/7/1 days.
- Deleting a credential immediately deletes the encrypted record and its usage rows. It cannot be recovered.
- The plaintext key is never sent back to the client after creation.
- Declared limits are metadata, not provider facts. The UI never says "Brave says your budget is…"; it says "You set a budget of…".

### Delete account and data

- The user confirms by typing `DELETE` in the deletion dialog. No email is sent; the Google identity is not deleted.
- Conversations, messages, sources, credentials and usage totals are hard-deleted in the same request. The account workspace key is deleted in the same transaction.
- Destroying the workspace data key makes deleted content ciphertext undecryptable through the application. Backups retain ciphertext, are protected by the KMS master key, and expire within 30 days.

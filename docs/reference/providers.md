# Provider behavior

## Registry and shared model layer

`lib/server/providers/index.ts` maps each provider id to an adapter. A mapped type makes the compiler require a key check for every provider, a model adapter for every model provider and a search function for every search provider. To add a provider: list it in `contracts.ts`, describe it in `provider-catalog.ts`, register its adapter. Removing is the reverse. Each catalog model declares `vision` (reads images).

A model adapter (`LlmAdapter` in `providers/llm.ts`) supplies only:

- `model(key, apiModel)`: an AI SDK language model.
- `providerOptions`: per-request options (OpenRouter: usage accounting).
- `stepUsage(step)`: the step's USD cost and upstream host.

The rest is shared. `streamChat` (planner, gap review, final answer) and the research loop call the AI SDK with `maxRetries: 0`; system prompts go in `instructions`.

- Text and reasoning deltas are forwarded as they arrive; usage, cost and resolved model are summed per step.
- A stream ending without a finish reason is `PROVIDER_UNAVAILABLE`, so a cut-off answer is never stored as complete.
- A caller abort stays an abort; network failures are `PROVIDER_UNAVAILABLE`.
- HTTP errors and in-stream error codes map as follows:

| Status/condition | Beamling code |
|---|---|
| `400` with context-length wording | `CONTEXT_TOO_LARGE` |
| `401`, `403` | `CREDENTIAL_INVALID` (HTTP 400 to the browser) |
| `402` | `INSUFFICIENT_CREDITS` |
| `404` | `MODEL_NOT_FOUND`, or `MODEL_PRIVACY_SETTING` when the message names the data policy |
| `429` | `PROVIDER_RATE_LIMITED` |
| `408`, `5xx` | `PROVIDER_UNAVAILABLE` |
| Other `4xx` | `PROVIDER_ERROR` |

Provider auth failures return HTTP 400, so a browser 401 always means the Beamling session is missing.

## Search adapters

Shared rules for Brave, Tavily, Exa and DeepSeek search:

- Errors: `401`/`403` `CREDENTIAL_INVALID`, `402` `INSUFFICIENT_CREDITS`, `429` `PROVIDER_RATE_LIMITED`, `408`/`5xx` `PROVIDER_UNAVAILABLE`, other `4xx` `PROVIDER_ERROR`. Provider-specific codes are listed per provider.
- A `429` is retried once if the requested wait is at most 5 seconds (1 second when no `Retry-After`); otherwise the `429` is returned.
- Snippets are tag-stripped and capped at 1,800 characters; results without a usable snippet are dropped.
- Each successful search records one request and a list-price estimate in `credential_usage` (`searchCostUsd` in `provider-catalog.ts`):

| Provider | Estimate per search |
|---|---|
| Brave | `$0.005` |
| Tavily | `$0.008` |
| Exa | `$0.005` |
| DeepSeek | `$0.00075` |

## OpenRouter

Validation spends no tokens and times out after 15 seconds:

```http
GET https://openrouter.ai/api/v1/key
Authorization: Bearer <key>
HTTP-Referer: <APP_URL>
X-Title: Beamling
```

Models run through `@openrouter/ai-sdk-provider` (`compatibility: "strict"`, app name Beamling, `HTTP-Referer: <APP_URL>`) with `usage: { include: true }`. Each step reports billed cost and upstream host in `providerMetadata.openrouter`; the answer stores both.

## Brave

Validation and retrieval use only the base Web Search endpoint. No LLM-context endpoint, extra snippets or result-URL fetches.

Spacing per key, across instances:

- `free` plan: `BRAVE_MIN_INTERVAL_MS` (default 1,100 ms).
- `paid` plan: `BRAVE_PAID_MIN_INTERVAL_MS` (default 0).
- The plan comes from the saved credential, not from Brave.

A `429` retry waits for `Retry-After`, else the first `X-RateLimit-Reset` value. Fixture searches record the same usage.

Response mapping (`web.results[]`: `title`, `url`, `description`, `age`):

- Title and description are tag-stripped and entity-decoded.
- Results without a description are dropped.
- `age` is used only with a parseable `YYYY-MM-DD` prefix.
- Provider order is kept; positions are assigned by ranking.

Extra error: error detail "not included in the plan" or code `OPTION_NOT_IN_PLAN` (any status) → `BRAVE_PLAN_MISSING_SEARCH`. An invalid subscription token is `CREDENTIAL_INVALID`.

## Tavily

Retrieval: `POST https://api.tavily.com/search`, `Authorization: Bearer <key>`. Never requests raw content, images or a generated answer.

- Validation: `GET https://api.tavily.com/usage` (spends nothing). `401` → `CREDENTIAL_INVALID`; `key.usage` at or above a non-null `key.limit` → `QUOTA_EXCEEDED`.
- Parameters: `search_depth=basic`, `max_results=1–20`, `include_published_date=true`, `safe_search=true`, `topic=news` only for recent-information questions.
- Freshness maps to `time_range`: `day`, `week`, `month` or `year`.
- Maps `title`, `url`, `content`, `published_date`.
- Extra errors: `432` → `SEARCH_PLAN_MISSING`, `433` → `QUOTA_EXCEEDED`.

## Exa

Validation and retrieval: `POST https://api.exa.ai/search`, `x-api-key: <key>`.

- Validation: a probe with `numResults=1`, `type="auto"`, `contents={"highlights":true}`.
- Retrieval: `type="auto"`, `numResults=1–100`, `moderation=true`, `contents.highlights=true`.
- Freshness maps to `startPublishedDate`. Never requests full text or a summary.
- Maps `title`, `url`, `publishedDate` and the joined `highlights`.

## DeepSeek

One key serves model and search. It is stored as `llm` and read once when an answer uses DeepSeek for both.

Model:

- `@ai-sdk/deepseek` 3.0.80; catalog entry `deepseek:deepseek-flash` ("DeepSeek V4.1 Flash · direct", API model `deepseek-flash`).
- Research requests (planner, gap review, tool loop) send `thinking: { type: "disabled" }`: those prompts expect direct replies, and thinking mode rejects the forced tool choice of the research loop's first step. The request that writes the answer sends `thinking: { type: "enabled" }`, so its reasoning is streamed and stored like any other model's.
- DeepSeek reports tokens but no price. Cost is estimated from `PEAK_PRICES` in `deepseek.ts`; off-peak is half. Peak is 01:00–04:00 and 06:00–10:00 UTC on weekdays. Chinese holidays are priced as peak, so the estimate can only be high.
- Validation: `GET https://api.deepseek.com/user/balance` (spends nothing). `is_available: false` → `INSUFFICIENT_CREDITS`.

Search:

```http
POST https://api.deepseek.com/v1/tools/search
Authorization: Bearer <key>
Content-Type: application/json

{ "query": "<at most 128 characters>", "count": 8 }
```

- `count` is the mode's results per query (8 Quick, 6 Deep and Deeper), clamped to 1–50.
- The query is shortened to 128 characters. Recent-information questions get an `after:YYYY-MM-DD` operator within the limit.
- `summary` is the snippet, with `snippet` as fallback; `date` is the publication date.

## Provider notices

Catalog notices show on the provider's card in Settings → Models and under the onboarding key field:

- DeepSeek: "DeepSeek is based in China and may process your questions there. Beamling does not control DeepSeek or how it handles your data."
- OpenRouter: "Some OpenRouter hosts are in China; you can exclude them in OpenRouter's settings. Beamling does not control these hosts or how they handle your data."

## Fixtures

`lib/server/providers/fake.ts` mirrors the chat, search and validation interfaces. Selected by `isFakeProviders()`; used by local tests and Playwright. Output is deterministic, with marker-triggered failures for planner repair, plan failure, partial search and no sources.

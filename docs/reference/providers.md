# Provider behavior

## Registry and shared model layer

`lib/server/providers/index.ts` maps every provider id to an adapter. A mapped type makes the compiler require a key check for every provider, a model adapter for every model provider and a search function for every search provider. Adding a provider means listing it in `contracts.ts`, describing it in `provider-catalog.ts` and registering its adapter; removing one is the reverse.

A model adapter (`LlmAdapter` in `providers/llm.ts`) supplies only:

- `model(key, apiModel)`: an AI SDK language model;
- `providerOptions`: per-request options (OpenRouter: usage accounting);
- `stepUsage(step)`: the step's cost in USD and the upstream host.

Everything else is shared. `streamChat` (planner, gap review and the final answer) and the research loop call the model through the AI SDK with `maxRetries: 0`; system prompts are passed as `instructions`. Shared behavior:

- Text and reasoning deltas are forwarded as they arrive; usage, cost and the resolved model are summed per step.
- A stream that ends without a provider finish reason is `PROVIDER_UNAVAILABLE`, so a cut-off answer is never stored as complete.
- A caller abort stays an abort; network failures are `PROVIDER_UNAVAILABLE`.
- HTTP errors (and in-stream error codes) map to stable codes:

| Status/condition | Beamling code |
|---|---|
| `400` with context-length wording | `CONTEXT_TOO_LARGE` |
| `401`, `403` | `CREDENTIAL_INVALID` (HTTP 400 to the browser) |
| `402` | `INSUFFICIENT_CREDITS` |
| `404` | `MODEL_NOT_FOUND` |
| `429` | `PROVIDER_RATE_LIMITED` |
| `408`, `5xx` | `PROVIDER_UNAVAILABLE` |
| Other `4xx` | `PROVIDER_ERROR` |

Provider auth failures are deliberately returned as HTTP 400 by the Beamling API, so the browser's 401 always means “workspace session missing,” not “provider key rejected.”

## OpenRouter

Validation:

```http
GET https://openrouter.ai/api/v1/key
Authorization: Bearer <key>
HTTP-Referer: <APP_URL>
X-Title: Beamling
```

Validation spends no generation tokens. It uses a 15-second timeout.

Models run through `@openrouter/ai-sdk-provider` (`compatibility: "strict"`, app name Beamling, `HTTP-Referer: <APP_URL>`) with `usage: { include: true }`, so each step reports the billed cost and the upstream host in `providerMetadata.openrouter`. The answer stores both.

## Brave

Validation and retrieval use the base Web Search endpoint only. The adapter does not call Brave's LLM-context endpoint, request extra snippets, or fetch any result URL.

Plan-aware spacing:

- `free` keys use `BRAVE_MIN_INTERVAL_MS` (default 1,100 ms) per key across instances.
- `paid` keys use `BRAVE_PAID_MIN_INTERVAL_MS` (default 0).
- The plan comes from the saved credential, not from Brave. Validation and retrieval both use it.
- Every successful search records one request and the `$0.005` list-price estimate in `credential_usage` for that credential. Fixture searches record the same usage.

Response mapping:

```json
{
  "web": {
    "results": [
      {
        "title": "…",
        "url": "https://…",
        "description": "…",
        "age": "2026-10-01"
      }
    ]
  }
}
```

- Title and description are tag-stripped and entity-decoded.
- A result without a description is unusable and is dropped.
- `age` is used only when it has a `YYYY-MM-DD` prefix and is parseable.
- The first usable result gets position 1, then 2, and so on within that query batch.
- Final positions are assigned by the ranking step, not by the provider.

Error mapping:

| Status/condition | Beamling code |
|---|---|
| `401`, `403`, invalid subscription token | `CREDENTIAL_INVALID` |
| `402` | `INSUFFICIENT_CREDITS` |
| `422` / “not included in plan” | `BRAVE_PLAN_MISSING_SEARCH` |
| `429` | `PROVIDER_RATE_LIMITED` |
| `408`, `5xx` | `PROVIDER_UNAVAILABLE` |
| Other `4xx` | `PROVIDER_ERROR` |

## Tavily

Retrieval uses `POST https://api.tavily.com/search` with `Authorization: Bearer <key>`. The adapter never requests raw page content, images or a generated answer.

- Validation calls `GET https://api.tavily.com/usage` with the same header, which reports credits without spending one. `401` maps to `CREDENTIAL_INVALID`; a `key.usage` at or above a non-null `key.limit` maps to `QUOTA_EXCEEDED`.
- Retrieval uses `search_depth=basic`, `max_results=1–20`, `include_published_date=true`, `safe_search=true`, and `topic=news` only for a recent-information question.
- A freshness window maps to `time_range`: `day`, `week`, `month` or `year`.
- Results map `title`, `url`, `content` and `published_date`; `content` is tag-stripped and capped at 1,800 characters. Results without a usable snippet are dropped.
- Every successful request records one request and the `$0.008` list-price estimate in `credential_usage`.

| Status | Beamling code |
|---|---|
| `401`, `403` | `CREDENTIAL_INVALID` |
| `432` | `SEARCH_PLAN_MISSING` |
| `433` | `QUOTA_EXCEEDED` |
| `402` | `INSUFFICIENT_CREDITS` |
| `429` | `PROVIDER_RATE_LIMITED` |
| `408`, `5xx` | `PROVIDER_UNAVAILABLE` |
| Other `4xx` | `PROVIDER_ERROR` |

A `429` is retried once with the same short-wait policy as Brave.

## Exa

Validation and retrieval use `POST https://api.exa.ai/search` with `x-api-key: <key>`.

- Validation sends a short probe with `numResults=1`, `type="auto"` and `contents={"highlights":true}`.
- Retrieval uses `type="auto"`, `numResults=1–100`, `moderation=true` and `contents.highlights=true`.
- A freshness window maps to `startPublishedDate`; the adapter never requests full page text or a summary.
- Results map `title`, `url`, `publishedDate` and the joined `highlights` array. Highlights are tag-stripped and capped at 1,800 characters. Results without a usable highlight are dropped.
- Every successful request records one request and the `$0.005` list-price estimate in `credential_usage`.

| Status | Beamling code |
|---|---|
| `401`, `403` | `CREDENTIAL_INVALID` |
| `402` | `INSUFFICIENT_CREDITS` |
| `429` | `PROVIDER_RATE_LIMITED` |
| `408`, `5xx` | `PROVIDER_UNAVAILABLE` |
| Other `4xx` | `PROVIDER_ERROR` |

A `429` is retried once with the same short-wait policy as Brave.

## DeepSeek

One key serves both capabilities; it is stored as `llm` and read once when the same answer uses DeepSeek for the model and for search.

Models run through `@ai-sdk/deepseek` 3.0.80. The catalog offers `deepseek:deepseek-flash` ("DeepSeek V4.1 Flash · direct", API model `deepseek-flash`). Every request sends `thinking: { type: "disabled" }`: the prompts expect direct replies, and DeepSeek rejects a forced tool choice (the research loop's first step) in thinking mode. DeepSeek reports tokens but no price, so the adapter estimates each step's cost from the list price (Flash: $0.30 per million cache-miss input tokens, $0.006 cache-hit, $1.20 output at peak; half off-peak). Peak is 01:00–04:00 and 06:00–10:00 UTC on weekdays; Chinese public holidays are off-peak at DeepSeek but are priced as peak, so the estimate can only be high.

Search:

```http
POST https://api.deepseek.com/v1/tools/search
Authorization: Bearer <key>
Content-Type: application/json
```

```json
{ "query": "<at most 128 characters>", "count": 8 }
```

- The query is shortened to fit DeepSeek's 128-character limit. When the question asks for recent information, an `after:YYYY-MM-DD` operator is appended within the limit.
- Each result's `summary` (600–800 characters, written for models) is the source snippet; the short `snippet` is the fallback. `date` is the publication date.
- The list-price estimate is `$0.00075` per successful search, recorded in `credential_usage`.
- Errors: `401`/`403` `CREDENTIAL_INVALID`, `402` `INSUFFICIENT_CREDITS`, `429` `PROVIDER_RATE_LIMITED` after one retry, `408`/`5xx` `PROVIDER_UNAVAILABLE`, other `4xx` `PROVIDER_ERROR`.

The catalog notice says DeepSeek is based in China, that its models and search may process questions there, and that Beamling takes no responsibility for how it handles data. It is shown on the DeepSeek key card, under its onboarding key field and in Defaults when DeepSeek is selected. OpenRouter's notice says some of its hosts, such as DeepSeek's own, are in China and can be excluded in OpenRouter's settings.

## Fixtures

`lib/server/providers/fake.ts` mirrors the `chat`, `search` and validation interfaces. It is selected by `isFakeProviders()` and is used by local tests and Playwright. Fixture content is deterministic, with marker-based failure modes for planner repair, plan failure, partial search and no-source behavior.

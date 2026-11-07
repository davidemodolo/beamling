# Answer pipeline

## Request preparation

`POST /api/chat` validates:

- `mode` is `quick`, `deep` or `deeper`. `searchProvider` is optional and must be `brave`, `tavily`, `exa` or `deepseek`; it defaults to the workspace default.
- Exactly one of `question` or `retryOf` is present.
- A retry includes `conversationId`.
- A question is at most 4,000 characters after control characters are removed and whitespace is trimmed.

It then applies:

- 30 chat requests per user per fixed hour.
- 120 chat requests per hashed IP per fixed hour.
- A 64 KB request-body limit.

`prepareChat()`:

1. Loads settings, falling back to the default model if the stored model is no longer allowlisted.
2. Resolves the model (the saved model, else the default) and the selected search provider (`searchProvider`, else the workspace default), then loads the key of the model's provider and of the search provider. When one provider serves both, its key is read once.
3. Returns `CREDENTIAL_MISSING` for the missing provider; returns `CREDENTIAL_UNREADABLE` when a stored row cannot be decrypted.
4. Reuses the requested conversation after an ownership check, or creates a new conversation.
5. Calls `createExchange()`.
6. Loads the six messages immediately before the current question. These are the prompt's conversation history; the current question is not repeated in that history.

Errors before the SSE response are normal JSON responses with the stable error envelope.

## Quick mode

```text
question + recent conversation
  → research loop with the Quick budget (one step, forced search tool, exactly one query)
  → one search on the selected provider (count 8)
  → rank/dedupe/cap by site (2 per site)
  → if zero usable sources: canned insufficient-sources answer
  → otherwise prompt + model stream
  → sanitize citations and persist
```

Quick is the same loop as Deeper ([Deeper mode](#deeper-mode)) with `QUICK_BUDGET`: 1 step, 1 search, 1 query per call, 8 sources, 400 output tokens. The single step writes a self-contained search query from the question and the last six messages, so follow-ups such as "and in Germany?" are searched in context. There is no fallback to the raw question: a failed step fails the answer like any model error. The step's tokens and cost are added to the answer usage.

## Deep mode

```text
question
  → planner call (JSON, 3–5 sub-queries)
  → up to one repair call if JSON is unusable
  → if still unusable: degraded Deep, search the original question
  → search sub-queries with concurrency 2 (6 results each)
  → rank, cap at 20 sources
  → if fewer than 4 sources: gap review + up to 2 follow-up searches
  → final ranking and stable source numbering
  → synthesis prompt + model stream
```

Planner behavior:

- Temperature 0.2, `max_tokens: 2000`, same selected model as the answer. The cap includes reasoning tokens.
- The reply is parsed by taking the first `{` through the last `}` and calling `JSON.parse`.
- Queries are whitespace-normalized to 180 characters, lower-case deduplicated, and capped at 5.
- Fewer than 3 queries triggers one repair attempt with the assistant reply and a fixed repair instruction.
- If the repair still yields fewer than 3 queries, or the planner call throws, the run is marked `degraded` and searches the original question as one query.

Evidence-gap behavior:

- Runs only in Deep and only when the current source count is below 4.
- Makes one `gap` model call with `max_tokens: 1500`. The cap includes reasoning tokens.
- Accepts at most 2 follow-up query strings.
- Runs the follow-up searches sequentially.
- Appends new sources after existing ones without renumbering; max 20 total.
- A failed planner/gap model call is ignored; a terminal credential/plan/quota search error is propagated.

## Deeper mode

Deeper is an agentic research loop (`answer/research.ts`), implemented with AI SDK `ToolLoopAgent` and the selected model's provider adapter. Quick uses the same loop with a one-search budget; Deep keeps its planned pipeline.

```text
question + recent conversation
  → ToolLoopAgent (the selected model)
      tool: search({ queries: string[1..4] })
      → selected provider with concurrency 2, 6 results per query
      → rank/dedupe/append, stable positions, max 60 sources
      → compact tool result (8 source summaries + counts)
      ← model decides: search again or finish
  → stop when the model returns text, 60 searches, 60 sources, or 24 steps
  → synthesis prompt over all collected sources + model stream
```

Loop controls:

- The first step forces `toolChoice: { type: "tool", toolName: "search" }`, so the model cannot answer without searching.
- Each step accepts 1–4 queries. Repeated queries (compared case-insensitively after whitespace normalization) are filtered in the tool; the prompt also asks the model to avoid near-duplicates.
- `stopWhen` combines `isStepCount(24)` with a closure that stops at 60 searches or 60 sources.
- Search budget is reserved synchronously before launching each query, so parallel tool calls cannot exceed 60. The tool refuses new searches once the budget is exhausted and tells the model to finish.
- A terminal credential/plan/quota error is retained and rethrown instead of being replaced by a generic `SEARCH_FAILED`.
- Every search emits the normal `search` and `progress` SSE events. The final writer uses the existing citation and `truncated` contract.
- Agent output text is not shown as the answer; it only signals that research is complete. A separate synthesis call writes the cited report.
- Research-agent tokens are read from each AI SDK step; cost and the upstream host come from the provider adapter's `stepUsage` (OpenRouter: `providerMetadata.openrouter`). Both are added to the answer usage.
- Timeout is 360 seconds. A stop, timeout or shutdown keeps partial synthesis text exactly like Deep.

`[fixture:...]` behavior does not apply to Deeper. With `BEAMLING_FAKE_PROVIDERS=1`, the research loop skips the AI SDK network path: Quick searches the question itself and Deeper runs three deterministic fixture searches.

## Retrieval and ranking

The selected adapter receives the normalized query, result count, optional freshness window and caller abort signal. Brave uses its Web Search endpoint; Tavily uses `POST /search` with `search_depth=basic`; Exa uses `POST /search` with `type=auto` and `contents.highlights=true`. None fetches the result pages.

Brave request:

```http
GET https://api.search.brave.com/res/v1/web/search
Accept: application/json
X-Subscription-Token: <user key>
```

Query parameters:

- `q`: at most 50 words and 400 characters.
- `count`: 1–20; Quick uses 8, Deep and Deeper use 6 per query.
- `freshness`: omitted unless the question looks recent. Mapping: `pd` (1 day), `pw` (7 days), `pm` (30 days), `py` (365 days).

Freshness detection is lexical and multilingual. It recognizes today/tonight/oggi/stasera/hoy/aujourd'hui/heute (1 day), this week variants (7 days), and latest/recent/news/currently/ultime/notizie/últimas/dernières/aktuell/nachrichten variants (30 days). Ambiguous questions get no freshness filter.

Result filtering:

- Only `http:` and `https:` URLs.
- A result needs a non-empty description after tag stripping and entity decoding.
- The description becomes the snippet and is capped at 1,800 characters.
- The title falls back to the domain.
- `age` is accepted only when it starts with `YYYY-MM-DD` and parses as a date.
- `www.` is stripped from the displayed domain.
- Exact URLs and unsafe URLs are dropped.

Per-key spacing:

- Each Brave key reserves a future slot in `provider_slots` using the database clock.
- Default interval: 1,100 ms (`BRAVE_MIN_INTERVAL_MS`).
- Spacing holds across every app instance and survives restarts because the slot is in PostgreSQL.
- The key is stored in the slot key as a SHA-256 prefix, not as the raw key.

Retry behavior:

- A `429` is retried once if `Retry-After` or the per-second `X-RateLimit-Reset` asks for at most 5 seconds.
- Longer waits and repeated `429`s surface `PROVIDER_RATE_LIMITED`.
- A request timeout is 30 seconds and converts to `PROVIDER_UNAVAILABLE`.

Ranking:

- Canonical URL: lower-case host, strip `www.`, drop fragment, remove common tracking parameters, sort remaining query parameters, remove a trailing slash when there is no query.
- Exact canonical duplicates are dropped.
- Results are taken round-robin by provider rank across query batches.
- A site cap is applied: Quick 2 per registrable domain, Deep 3.
- If room remains after the cap, capped results fill it in rank order, so diversity is a preference rather than a hard filter.
- `siteOf` treats common two-level public suffixes (`co.uk`, `com.au`, etc.) as one site.
- Gap sources are appended with `exclude` set to the existing sources and numbering starting after the current count.

If every search fails, the run throws `SEARCH_FAILED` and no answer is written. If at least one search succeeds, failed searches increment `search_failures` and the answer proceeds with available sources.

## No-source path

When ranking produces zero sources:

- The server emits `stage: no-sources`.
- It emits a `delta` containing the fixed cautious answer.
- It stores the message as `complete` with `no_sources = true`.
- It emits `usage` and `done`; no model answer call is made.

The fixed answer is:

> I could not find reliable sources for this question, so I am not going to guess. Try rephrasing it, naming a specific entity, or widening the time window.

## Prompt construction

Both modes use:

- A system message with Beamling's identity, current date and local timezone, and answer language.
- A user message containing optional conversation history, the question, and numbered `<source>` blocks.

Language:

- `detectLanguage()` uses stop-word lists for English, Italian, Spanish, French, German and Portuguese.
- A language is selected only with at least two hits and a strict lead over the second language.
- Otherwise the prompt says “Answer in the language of the user's question.”

Source blocks:

```text
<source id="1" url="https://example.org/page" domain="example.org" title="Page title" published="2026-08-01">
Snippet text, capped at 2,200 characters.
</source>
```

- `<source` and `</source` sequences inside the snippet are removed.
- Attribute values escape `&`, `"`, `<` and `>`.
- Only the provider snippet is sent; page text is never fetched.
- Source content is explicitly labeled untrusted data, not instructions.

History:

- The last six messages before the current question.
- The first 1,200 characters of each message.
- Citation markers are stripped, except inside code spans, code fences and URLs.
- Previous-turn citation numbers therefore cannot collide with the current source list.

Prompt families:

- Quick: direct answer first, 150–350 words, citations on source-derived claims, no separate sources section.
- Deep: direct opening, then 500–900 words (up to 1,200), 3–6 sections, uncertainty only for material gaps.
- Deeper: direct opening, then 1,200–2,000 words (up to 2,500), 5–9 sections, contradictions and material gaps.
- Planner: JSON only, 3–5 keyword queries, 12 words each.
- Gap: JSON only, sufficient flag plus at most two follow-ups.
- Research agent: tool-use instructions; it never writes the final answer.

The system prompts also instruct the model to ignore instructions inside sources, not to invent source numbers, not to quote more than 25 consecutive words, and not to add a references section.

## Synthesis and citations

- Quick synthesis: `max_tokens: 8192`.
- Deep synthesis: `max_tokens: 16384`.
- Deeper synthesis: `max_tokens: 24576`.
- Deeper research agent steps: `max_tokens: 4000`.
- These caps include reasoning tokens when the model emits them, so they are deliberately larger than the answer length alone requires.
- The selected model's provider is called through the AI SDK, streaming, with temperature `0.2`.
- Deltas are forwarded to the SSE client and accumulated in memory. The browser batches React updates to one animation frame instead of re-parsing Markdown per token.
- On a delta containing `]`, the server scans the accumulated content for new valid citation positions and emits one `citation` event per new position.
- On completion, `sanitizeCitations()` removes out-of-range markers while preserving markers inside code fences, inline code, URLs and Markdown link targets.
- `uncited` is true when the final answer has no valid in-range citation.
- `truncated` is true when the model stops at its token limit (AI SDK finish reason `length`).
- `resolved_model` and `upstream_provider` are recorded from the synthesis stream when the provider reports them (OpenRouter does).
- Usage from planner, repair, gap, Deeper research-agent steps and synthesis calls is summed into one answer record.

The client renders valid `[n]` markers as buttons; invalid markers stay as text. Clicking a citation highlights the matching source card or opens the mobile source sheet.

## Stop, timeout, disconnect and shutdown

| Event | Server behavior | Stored status |
|---|---|---|
| User stops from the same instance | The in-memory controller aborts immediately | `stopped`, partial text kept |
| User stops from another instance | `POST /api/chat/stop` sets `stop_requested`; the running instance polls every 1.5 seconds | `stopped`, partial text kept |
| Quick exceeds 60 seconds | Timeout aborts the run | `stopped`, `GENERATION_TIMEOUT` |
| Deep exceeds 90 seconds | Timeout aborts the run | `stopped`, `GENERATION_TIMEOUT` |
| Deeper exceeds 360 seconds | Timeout aborts the run | `stopped`, `GENERATION_TIMEOUT` |
| Client disconnects | The request signal aborts the run | `stopped`, partial text kept, `error_code = CLIENT_DISCONNECT` |
| Conversation or account deleted | Local abort; other instances see the missing/non-streaming row on the next poll | Outcome storage becomes a no-op |
| Server shutdown | `SIGTERM`/`SIGINT` aborts active chats with `ShutdownError`; the server waits up to 8 seconds for outcomes, then marks leftovers interrupted | `error`, `INTERRUPTED` |

A user stop and a timeout end with `stage: stopped`. A shutdown or provider failure after streaming begins ends with an `error` event. Usage is persisted on stop/timeout/error, but the `usage` SSE event is emitted only on the successful path (including the no-source path).

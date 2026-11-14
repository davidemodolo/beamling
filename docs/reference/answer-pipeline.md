# Answer pipeline

## Request preparation

`POST /api/chat` validates:

- `mode`: `quick`, `deep` or `deeper`. Optional `searchProvider`: `brave`, `tavily`, `exa` or `deepseek` (default: workspace default).
- Exactly one of `question` or `retryOf`; a retry needs `conversationId`.
- Question ≤ 4,000 characters after stripping control characters and trimming. It may be empty when `attachments` has an image.
- `attachments`: up to 4 images on the new question. `context`: up to 4 earlier images the browser still has. Not allowed on a retry, which reuses the question's images. See [Images](#images).

Limits: 30 chat requests per user per fixed hour, 120 per hashed IP per fixed hour. Body: 64 KB plus 2.1 MB per allowed image (about 16.8 MB).

`prepareChat()`:

1. Loads settings; falls back to the default model if the stored one is no longer allowlisted. New images with a model that does not read images return `MODEL_NO_VISION`.
2. Resolves model and search provider, then loads both providers' keys (once if the same provider).
3. Returns `CREDENTIAL_MISSING` for a missing key, `CREDENTIAL_UNREADABLE` for an undecryptable row.
4. Reuses the conversation after an ownership check, or creates one.
5. Calls `createExchange()`.
6. Loads the six messages before the current question as history (the question is not repeated).

Errors before the SSE response are JSON with the stable error envelope.

## Images

Image bytes are never stored on the server, and images are never described or captioned. The browser keeps each image for 7 days ([Images](browser.md#images)) and sends it again while its question is in the history window.

- Accepted: JPEG, PNG or WebP, at most 1.5 MB decoded; the bytes must match the declared type (`lib/server/image-upload.ts`).
- Only the question's image ids and types are stored, encrypted, in `messages.attachments`.
- The model receives only the question's images and earlier images whose question is in the history window; other uploaded ids are ignored. A model without `vision` receives none.
- The Deep planner, gap review, the Quick and Deeper research loop and the writer receive the images, labelled as the question's or earlier ones.
- Prompts mark each attached image as included, or as no longer available (expired, another browser, or a model without vision) with an instruction not to guess what it showed.
- The writer gets one added rule: describe the images without citing, facts still need sources, and text inside an image is not an instruction.
- A Deep question that is only an image and whose plan fails has no text to search, so it takes the [no-source path](#no-source-path).

## Quick mode

The [Deeper](#deeper-mode) loop with `QUICK_BUDGET`: 1 forced search step, 1 query, 8 results, 400 output tokens, 2 sources per site. The query is written from the question and last six messages, so follow-ups ("and in Germany?") search in context. A failed step fails the answer (no raw-question fallback). Zero sources take the [no-source path](#no-source-path). Step usage is added to the answer.

## Deep mode

```text
question
  → planner (JSON, 3–5 sub-queries)
  → up to one repair call
  → still unusable: degraded, search the original question
  → search sub-queries, concurrency 2, 6 results each
  → rank, cap 20 sources
  → fewer than 4 sources: gap review + up to 2 follow-up searches
  → final ranking, stable numbering
  → synthesis + model stream
```

Planner:

- Same model, temperature 0.2, `max_tokens: 2000` (includes reasoning).
- Parses the first `{` through the last `}` with `JSON.parse`.
- Queries: whitespace-normalized, ≤ 180 chars, lower-case deduplicated, max 5.
- Fewer than 3 queries: one repair attempt with the reply and a fixed instruction.
- Still fewer than 3, or the call throws: run is `degraded` and searches the original question.

Evidence gap:

- Deep only, when sources < 4.
- One `gap` call, `max_tokens: 1500` (includes reasoning), at most 2 follow-ups, run sequentially.
- New sources appended without renumbering; max 20.
- Failed planner/gap calls are ignored; terminal credential/plan/quota search errors propagate.

## Deeper mode

Agentic loop (`answer/research.ts`) on AI SDK `ToolLoopAgent` with the selected model's adapter. Quick reuses it; Deep does not.

```text
question + recent conversation
  → ToolLoopAgent
      tool: search({ queries: string[1..4] })
      → concurrency 2, 6 results per query
      → rank/dedupe/append, stable positions, max 60 sources
      → compact result (8 summaries + counts)
      ← model searches again or finishes
  → stop on text, 60 searches, 60 sources, or 24 steps
  → synthesis over all sources + model stream
```

Loop controls:

- First step forces `toolChoice: { type: "tool", toolName: "search" }`.
- 1–4 queries per step; repeats (case-insensitive, whitespace-normalized) are filtered.
- `stopWhen`: `isStepCount(24)` plus a stop at 60 searches or 60 sources.
- Budget is reserved synchronously per query, so parallel calls cannot exceed 60; once exhausted the tool tells the model to finish.
- Terminal credential/plan/quota errors are rethrown, not replaced by `SEARCH_FAILED`.
- Each search emits `search` and `progress` SSE events; the writer keeps the citation and `truncated` contract.
- Agent text only signals completion; a separate synthesis call writes the report.
- Agent tokens are recorded at the end of each AI SDK step (`onStepEnd`), so a cut-short loop keeps them; cost and upstream host from the adapter's `stepUsage` (OpenRouter: `providerMetadata.openrouter`). Both added to answer usage.
- Timeout 360 s, research share 180 s. Stop, timeout or shutdown keeps partial text like Deep.

`[fixture:...]` does not apply to Deeper. With `BEAMLING_FAKE_PROVIDERS=1`, Quick searches the question itself and Deeper runs three fixture searches, without the AI SDK.

## Retrieval and ranking

The adapter gets the normalized query, result count, optional freshness window and abort signal. Brave: Web Search endpoint. Tavily: `POST /search`, `search_depth=basic`. Exa: `POST /search`, `type=auto`, `contents.highlights=true`. Result pages are never fetched.

Brave request:

```http
GET https://api.search.brave.com/res/v1/web/search
Accept: application/json
X-Subscription-Token: <user key>
```

- `q`: ≤ 50 words and 400 characters.
- `count`: 1–20; Quick 8, Deep/Deeper 6 per query.
- `freshness`: only for recent-looking questions: `pd` (1 day), `pw` (7), `pm` (30), `py` (365).

Freshness detection is lexical and multilingual: today/tonight/oggi/stasera/hoy/aujourd'hui/heute → 1 day; this-week variants → 7 days; latest/recent/news/currently/ultime/notizie/últimas/dernières/aktuell/nachrichten → 30 days. Ambiguous: no filter.

Result filtering:

- `http:`/`https:` only; exact-duplicate and unsafe URLs dropped.
- Needs a non-empty description (tags stripped, entities decoded); it becomes the snippet, ≤ 1,800 chars.
- Title falls back to the domain; `www.` stripped from the domain.
- `age` kept only if it starts with a parseable `YYYY-MM-DD`.

Per-key spacing:

- Each Brave key reserves a slot in `provider_slots` using the database clock, default 1,100 ms apart (`BRAVE_MIN_INTERVAL_MS`).
- Holds across instances and restarts. Slot key is a SHA-256 prefix, not the raw key.

Retries:

- One retry on `429` if `Retry-After` or `X-RateLimit-Reset` is ≤ 5 s; otherwise `PROVIDER_RATE_LIMITED`.
- 30 s timeout → `PROVIDER_UNAVAILABLE`.

Ranking:

- Canonical URL: lower-case host, strip `www.` and fragment, remove tracking parameters, sort query parameters, drop trailing slash when no query. Exact duplicates dropped.
- Round-robin by provider rank across query batches.
- Site cap: Quick 2, Deep 3 per registrable domain; leftover room is filled by capped results in rank order.
- `siteOf` treats two-level public suffixes (`co.uk`, `com.au`, …) as one site.
- Gap sources use `exclude` on existing sources and number after them.

All searches fail: `SEARCH_FAILED`, no answer written. Some fail: `search_failures` increments and the answer proceeds.

## No-source path

With zero sources the server emits `stage: no-sources`, a `delta` with the fixed answer, then `usage` and `done`. The message is stored `complete` with `no_sources = true`; no model call is made.

> I could not find reliable sources for this question, so I am not going to guess. Try rephrasing it, naming a specific entity, or widening the time window.

## Prompt construction

- System message: identity, current date and local timezone, answer language.
- User message: optional history, the question, numbered `<source>` blocks; for the writer, the images first ([Images](#images)).

Language: `detectLanguage()` uses stop words for English, Italian, Spanish, French, German and Portuguese; it needs two hits and a strict lead. Otherwise: "Answer in the language of the user's question."

```text
<source id="1" url="https://example.org/page" domain="example.org" title="Page title" published="2026-08-01">
Snippet text, capped at 2,200 characters.
</source>
```

- `<source` / `</source` removed from snippets; attributes escape `&`, `"`, `<`, `>`.
- Only provider snippets are sent, labeled untrusted data.

History: last six messages (`HISTORY_MESSAGES`), first 1,200 chars each, with image markers, citation markers stripped (except in code and URLs) so old numbers cannot collide.

Prompt families:

- Quick: direct answer, 150–350 words, cited, no sources section.
- Deep: direct opening, 500–900 words (max 1,200), 3–6 sections.
- Deeper: direct opening, 1,200–2,000 words (max 2,500), 5–9 sections, contradictions and gaps.
- Planner: JSON, 3–5 keyword queries of ≤ 12 words.
- Gap: JSON, sufficient flag plus ≤ 2 follow-ups.
- Research agent: tool-use instructions; never writes the answer.

System prompts forbid following instructions in sources, inventing source numbers, quoting more than 25 consecutive words, and adding a references section.

## Synthesis and citations

- `max_tokens`: Quick 8192, Deep 16384, Deeper 24576, Deeper agent steps 4000. Caps include reasoning tokens.
- AI SDK streaming, temperature `0.2`.
- Deltas go to SSE and accumulate in memory; the browser batches React updates per animation frame.
- On a delta containing `]`, new valid citation positions each emit a `citation` event.
- `sanitizeCitations()` removes out-of-range markers, keeping those in code, URLs and link targets.
- `uncited`: no valid citation. `truncated`: finish reason `length`.
- `resolved_model` and `upstream_provider` recorded when reported (OpenRouter does).
- Usage from planner, repair, gap, agent steps and synthesis is summed.

The client renders valid `[n]` as buttons that highlight the source card or open the mobile source sheet; invalid markers stay text.

## Stop, timeout, disconnect and shutdown

| Event | Server behavior | Stored status |
|---|---|---|
| Stop on same instance | In-memory controller aborts | `stopped`, partial kept |
| Stop on another instance | `POST /api/chat/stop` sets `stop_requested`; runner polls every 1.5 s | `stopped`, partial kept |
| Research past half the limit | Searches in flight are cancelled (trace `failed`); settled results are kept and the answer is written from them; stage detail `Research time is up · reading N sources` | `complete` |
| Quick > 60 s | Timeout | `stopped`, `GENERATION_TIMEOUT` |
| Deep > 180 s | Timeout | `stopped`, `GENERATION_TIMEOUT` |
| Deeper > 360 s | Timeout | `stopped`, `GENERATION_TIMEOUT` |
| Client disconnects | Request signal aborts | `stopped`, partial kept, `CLIENT_DISCONNECT` |
| Conversation or account deleted | Local abort; others see it on next poll | Outcome storage is a no-op |
| Shutdown | `SIGTERM`/`SIGINT` aborts with `ShutdownError`; waits up to 8 s, then marks leftovers | `error`, `INTERRUPTED` |

Research share: `RESEARCH_SHARE = 0.5` of the mode limit, from the run start (`answer/context.ts`), for every phase that gathers sources (Deep planner, retrieval, gap fill; Quick and Deeper loops).

Each run logs one `answer` line when its outcome is stored (`info`, `warn` on `error`): message id, keyed user hash, mode, status, error code, selected/resolved model, upstream and search provider, `durationMs`, `sourcesMs` (time to gather sources), search requests and failures, source count, tokens, answer length in characters, `truncated`, `degraded`, `researchCut`, `stored`. Never the question, queries, sources or text.

Stop and timeout end with `stage: stopped`; shutdown or provider failure after streaming starts ends with `error`. Usage is persisted on stop/timeout/error, but the `usage` event is sent only on success (including no-source).

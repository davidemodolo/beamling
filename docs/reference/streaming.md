# Streaming protocol

`POST /api/chat` returns `text/event-stream; charset=utf-8` with:

```http
Cache-Control: private, no-store, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

A comment heartbeat (`: ping`) is written every 15 seconds.

## Events

Server and client share `lib/stream-events.ts`; the client validates each payload and ignores unknown or malformed events.

| Event | Data | When |
|---|---|---|
| `meta` | `{ conversationId, messageId, userMessageId, removed }` | Before pipeline work; `removed` lists conversations deleted by the 100-conversation cap ([Pagination and deletion](conversations.md#pagination-and-deletion)) |
| `stage` | `{ stage, detail? }` | State changes; details are display strings |
| `plan` | `{ queries: string[] }` | Deep only, after planning |
| `search` | `{ query, status: "searching" \| "done" \| "failed", results? }` | When each search starts and settles; feeds the search trace |
| `progress` | `{ completed, total }` | After each search in a batch completes (Quick and Deeper research batches, Deep's planned searches; not Deep's gap-review searches) |
| `sources` | `Source[]` | Once, before writing |
| `delta` | `{ text }` | Streamed answer text |
| `reasoning` | `{ text }` | Model-provided reasoning, when the provider emits it |
| `citation` | `{ position }` | First time a valid citation appears |
| `usage` | `{ tokensIn, tokensOut, costUsd, searchCostUsd, latencyMs, searchRequests, searchProvider?, resolvedModel?, upstreamProvider? }` | Successful completion (including no sources) |
| `done` | `{ noSources, truncated?, degraded?, searchFailures? }` | Successful terminal event |
| `error` | `{ code, message, provider? }` | Terminal error after the stream started |

The client's `ChatStage` type includes `done`, `stopped`, `no-sources` and `error`. Over the wire, the server emits `stage` values `queued`, `searching`, `reading`, `writing`, `no-sources`, `stopped` and `error`; successful completion is the separate `done` event, not a `stage: done` event.

Normal order:

```text
meta
stage queued
[stage searching]      (Deep: "Planning 3–5 sub-queries")
[plan]                 (Deep)
stage searching
search searching × N
search done|failed × N
progress × N
stage reading
sources
stage writing
reasoning × N          (only when the model returns reasoning)
delta × N
citation × N
usage
done
```

No-source order:

```text
meta
stage queued
stage searching
search searching × N
search done|failed × N
progress × N
stage reading
sources (empty)
stage no-sources
delta (canned answer)
usage
done
```

Error/stop order ends with `error` or `stage stopped`; there is no `done` after those.

## Client stream handling

- The client posts JSON to `/api/chat` with the session cookie.
- It parses SSE with `eventsource-parser`.
- `meta` supplies the stored ids used by stop and by the provisional UI.
- `search` updates the visible search trace; the panel is collapsed by default.
- `reasoning` accumulates separately from the answer and is rendered in its own collapsed panel.
- `delta` text accumulates in the live answer.
- `citation` positions increment a counter that pulses the mascot.
- `done`, `error`, or `stage stopped` settles the stream.
- If the stream closes without a terminal event, the client shows `STREAM_ENDED` unless a stop was requested.
- `onStopped` distinguishes a server-confirmed stop from a dropped connection.
- The client's stop flow first calls `/api/chat/stop` when a message id is known, waits up to 6 seconds for confirmation, then aborts the connection.
- A stream started in the chat shell survives client-side conversation switches because the stream manager owns it above the conversation view. A full page navigation disconnects it; the server stores a stopped answer.

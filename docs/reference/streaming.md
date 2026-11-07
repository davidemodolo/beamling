# Streaming protocol

`POST /api/chat` returns `text/event-stream; charset=utf-8` with:

```http
Cache-Control: private, no-store, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Heartbeat: a `: ping` comment every 15 seconds.

## Events

Defined in `lib/stream-events.ts`, shared by server and client. The client ignores unknown or malformed events.

| Event | Data | When |
|---|---|---|
| `meta` | `{ conversationId, messageId, userMessageId, removed }` | First; `removed` lists conversations trimmed by the [100-conversation cap](conversations.md#pagination-and-deletion) |
| `stage` | `{ stage, detail? }` | State changes; `detail` is display text |
| `plan` | `{ queries: string[] }` | Deep, after planning |
| `search` | `{ query, status: "searching" \| "done" \| "failed", results? }` | Each search start and end; feeds the search trace |
| `progress` | `{ completed, total }` | After each batch search (not Deep's gap-review searches) |
| `sources` | `Source[]` | Once, before writing |
| `delta` | `{ text }` | Answer text |
| `reasoning` | `{ text }` | Provider reasoning, if emitted |
| `citation` | `{ position }` | First occurrence of a valid citation |
| `usage` | `{ tokensIn, tokensOut, costUsd, searchCostUsd, latencyMs, searchRequests, searchProvider?, resolvedModel?, upstreamProvider? }` | Success, including no sources |
| `done` | `{ noSources, truncated?, degraded?, searchFailures? }` | Terminal success |
| `error` | `{ code, message, provider? }` | Terminal error |

Wire `stage` values: `queued`, `searching`, `reading`, `writing`, `no-sources`, `stopped`, `error`. Success is the `done` event, never `stage: done` (the client's `ChatStage` type also has `done`).

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

No sources: same up to `stage reading`, then `sources` (empty), `stage no-sources`, `delta` (canned answer), `usage`, `done`.

Errors and stops end with `error` or `stage stopped`, with no `done`.

## Client stream handling

- Posts JSON to `/api/chat` with the session cookie; parses SSE with `eventsource-parser`.
- `meta` ids drive stop and the provisional UI.
- `search` and `reasoning` fill their own collapsed panels; `delta` builds the answer.
- `citation` pulses the mascot.
- `done`, `error` or `stage stopped` settles the stream. A close without one shows `STREAM_ENDED`, unless a stop was requested.
- `onStopped` tells a server-confirmed stop from a dropped connection.
- Stop calls `/api/chat/stop` when the message id is known, waits up to 6 seconds for confirmation, then aborts.
- The stream manager sits above the conversation view, so streams survive client-side conversation switches. A full page navigation disconnects; the server stores a stopped answer.

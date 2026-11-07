# Conversation and message model

## Tables

```text
users
  id, google_sub (unique), email, email_verified, name, avatar_url,
  terms_version, terms_accepted_at, last_seen_at, shutdown_notified_at,
  created_at, updated_at

auth_sessions
  id, user_id → users, token_hash, expires_at, created_at

user_data_keys
  user_id → users (primary key), key_id, wrapped_key,
  wrap_nonce, wrap_tag, created_at, rotated_at

credentials
  id, user_id → users, kind, provider,
  key_id, wrapped_dek, dek_nonce, dek_tag,
  nonce, ciphertext, tag, fingerprint, last4,
  status, plan, expires_on, budget_usd, budget_period,
  budget_started_at, last_validated_at, created_at, updated_at

credential_usage
  credential_id → credentials, day, requests, estimated_cost_usd

settings
  user_id → users (primary key), llm_model, default_search_provider, default_mode,
  analytics_opt_out, updated_at

conversations
  id, user_id → users, title, mode, pinned, created_at, updated_at

messages
  id, conversation_id → conversations, user_id → users,
  role, content, status, mode,
  uncited, no_sources, truncated, degraded,
  searches (encrypted JSON trace), reasoning (encrypted),
  llm_model, resolved_model, upstream_provider,
  search_requests, search_failures,
  search_provider, tokens_in, tokens_out, cost_usd, search_cost_usd,
  latency_ms, error_code, error_message, stop_requested,
  created_at

sources
  id, message_id → messages, position,
  url, title, domain, snippet, published_at

rate_limits
  key (primary key), window_start, count, expires_at

system_flags
  key (primary key), enabled, reason, scheduled_at, updated_at

provider_slots
  key (primary key), next_at

analytics_erasures
  distinct_id (primary key), passes_left, attempts, next_attempt_at, created_at
```

Important indexes and constraints:

- `auth_sessions.token_hash` and `users.google_sub` are unique.
- `credentials(user_id, kind, provider)` is unique.
- `credential_usage(credential_id, day)` is the primary key.
- `conversations(user_id, pinned, updated_at, id)` orders pinned chats first and supports keyset pagination; `conversations(user_id, updated_at, id)` remains for the total count.
- `messages(conversation_id, created_at, id)` supports message pagination.
- A partial unique index allows at most one `messages.status = 'streaming'` row per conversation.
- `sources(message_id, position)` is unique.
- `rate_limits.expires_at`, `provider_slots.next_at`, `analytics_erasures.next_attempt_at` and `users.last_seen_at` are indexed for cleanup.
- `users.terms_version` is the accepted `LEGAL_VERSION` (null until first acceptance); `users.last_seen_at` is set on sign-in and on the daily session renewal; `settings.analytics_opt_out` defaults to `false`; `users.shutdown_notified_at` records when the shutdown notice reached the mail server (null until sent, reset when a shutdown is scheduled).
- `system_flags` holds the database killswitch ([Operational killswitch](operations.md#operational-killswitch)) and the `shutdown` row, whose `scheduled_at` is the closing date ([Scheduled shutdown](#scheduled-shutdown)).
- `conversations.updated_at` is the last activity: it is set by a new exchange and by a mode change, and drives sidebar order, the 100-conversation cap and 60-day expiry ([Pagination and deletion](#pagination-and-deletion), [Cleanup](#cleanup)).
- Users cascade to sessions, workspace keys, credentials, settings, conversations, messages and sources.

The migration also creates a `beamling_migrations(filename, checksum, applied_at)` ledger in the migration script. Applied files are checksummed; editing one fails the next migration run. Existing rows without a checksum are baselined on the next run.

## Message lifecycle

```text
user question  → insert row with status complete
assistant      → insert row with status streaming
                 ↓
              complete | stopped | error
```

Assistant rows are inserted one millisecond after the question to keep deterministic thread order. `mode` is stored on both the user and assistant row.

Conversation titles and message content are encrypted before insert. The repository generates row ids in the application so the AAD can bind to them. The first question titles the conversation with the first 48 characters of the normalized question if the decrypted title is still `New conversation`.

## Starting an exchange

`createExchange()` runs in one transaction:

1. Take a transaction-scoped PostgreSQL advisory lock (`7314002918`) so every instance checks concurrency in the same order.
2. Lock the conversation row with `SELECT … FOR UPDATE` and verify ownership.
3. Mark any streaming answer older than eight minutes as `error` / `INTERRUPTED`. The threshold covers Deeper's six-minute limit plus recovery grace; the previous three-minute value cut off healthy Deeper runs.
4. Count all non-stale streaming messages. If the count is at or above `MAX_CONCURRENT_CHATS`, return `SERVER_BUSY` (503).
5. For a Deeper request, count non-stale streaming Deeper messages. If the count is at or above half of `MAX_CONCURRENT_CHATS` (rounded down, at least 1), return `SERVER_BUSY` (503) with copy suggesting Deep.
6. Count the account's non-stale streaming messages against `MAX_CONCURRENT_CHATS_PER_USER`.
7. For a retry, validate that the target is the latest assistant answer, is `error` or `stopped` (or stale-streaming), and that a preceding user question exists. Delete the old assistant row and reuse the original question. No duplicate user message is stored.
8. For a new question, insert the user message with control characters removed.
9. Insert the assistant placeholder with status `streaming`.
10. Update the conversation title (first question only), mode and `updated_at`.

The partial unique index turns a second concurrent answer in one conversation into `GENERATION_IN_PROGRESS` (409). A lock timeout (5 seconds) or an advisory-lock wait timeout maps to `SERVER_BUSY`.

## Finishing an answer

`completeAssistant()` runs in one transaction:

1. Update the assistant row with final content, status, flags, usage, cost, resolved model/provider and error fields, scoped to the owner and `status = streaming`. A late completion after a reaper/shutdown marked the row `INTERRUPTED` updates zero rows and is not announced as success.
2. If the row no longer exists, return `false` (its conversation or account was deleted).
3. Delete any previous sources for the message.
4. Insert the final sources with their positions.

On retry, the old answer is deleted before a new placeholder is created, so its sources cascade with it.

## Pagination and deletion

- Conversation summaries: 50 per page, newest first by `(updated_at, id)`.
- Conversation messages: 60 per page, returned oldest first, selected newest first by `(created_at, id)`.
- `GET /api/conversations/:id` returns the newest message page plus `hasMoreMessages`.
- `GET /api/conversations/:id/messages?before=<messageId>` returns the page before an anchor message.
- Cursors are base64url JSON tuples. Invalid cursors return `INVALID_CURSOR`.
- Deleting a conversation deletes its messages and sources through foreign-key cascades and aborts local active answers for that conversation.
- An account keeps at most 100 conversations (`MAX_CONVERSATIONS`). After `/api/chat` stores a question (so a request that fails earlier, or an empty conversation, never costs an older one), `trimConversations` deletes every other conversation beyond the first 99 in sidebar order (pinned first, then most recently active), so the least recently active unpinned ones go first and pinned ones only when more than 99 are pinned. The asked conversation is never removed. The `meta` event lists the deleted ids in `removed`; the client store drops them from the list, the count and loaded threads. A trim failure is logged and does not block the answer.
- Deleting an account deletes sessions, per-user rate-limit keys and the user row; cascades remove the workspace key, credentials, usage, conversations, messages, sources and settings.

## Cleanup

`startServer()` runs cleanup immediately and every hour (on Cloud Run only while the instance has CPU, i.e. during requests):

- Delete retired accounts, at most 50 per run, through the same path as a user deletion (including the queued PostHog erasure), logging an `inactive_account_deleted` audit event for each:
  - accounts whose `last_seen_at` (last sign-in or daily session renewal) is more than 24 months old;
  - accounts created more than 7 days ago that never accepted the terms (`terms_accepted_at` is null).
- Delete conversations whose `updated_at` is more than 60 days old (`CONVERSATION_RETENTION_DAYS`), pinned or not, at most 1,000 per run; messages and sources cascade.
- Delete expired sessions.
- Delete expired rate-limit rows.
- Delete provider slots whose `next_at` is more than one hour in the past.
- Delete empty conversations older than one hour.
- Mark stale streaming answers as `error` / `INTERRUPTED`.
- Run due PostHog erasures ([Data deletion](security.md#data-deletion)), up to 20 per run.
- Advance a scheduled shutdown ([Scheduled shutdown](#scheduled-shutdown)).

Each step runs even if another fails; failures are logged. The process continues serving requests if cleanup fails.

## Scheduled shutdown

The operator can close the whole service with `POST /api/internal/shutdown` ([Endpoints](api.md#endpoints), runbook [Incident runbook](operations.md#incident-runbook)). State lives in the `system_flags` row `shutdown` (`enabled = true`, `scheduled_at`, optional `reason`, `notify`); deleting the row cancels.

- Scheduling sets `scheduled_at` to now plus `days` (at least `SHUTDOWN_NOTICE_DAYS = 14`, at most 365, default 14) and, in the same transaction, clears every `users.shutdown_notified_at`, so a rescheduled date is announced again.
- While a shutdown is scheduled: new accounts are refused with `SERVICE_CLOSING`; existing users can sign in and export their data; `/chat` shows a banner with the date (Europe/Rome time) and a "Download my data" button that opens Settings → Account; `/login` and `/status` show the date.
- `processShutdown()` runs right after scheduling (when `notify` is true) and from every cleanup tick. It holds a session-scoped Postgres advisory lock on a dedicated connection, so only one instance works at a time (others skip the tick); both steps are idempotent.
  - Before the date it emails the notice to accounts with a null `shutdown_notified_at`, oldest first in batches of 50, 250 ms between messages, marking each account after the SMTP server accepts it. A send failure stops the run; the next tick retries the rest. Nothing is sent when the shutdown was scheduled with `notify: false` (stored in `system_flags.notify`) or without `SMTP_URL`/`MAIL_FROM`.
  - From the date on it deletes every account in batches of 50 through `deleteAccount` (same path as a user deletion, including the queued PostHog erasure), logging a `shutdown_account_deleted` audit event for each.
- After the date every sign-in is refused with `SERVICE_CLOSED`, and `/login` hides the sign-in button.
- The notice is one English plain-text message: closing date (Europe/Rome, with CET/CEST), what is deleted, that provider accounts are unaffected and keys may be revoked, how to download data, the optional operator reason, and the contact address. Beamling sends no other email.

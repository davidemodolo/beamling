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
  attachments (encrypted JSON image ids and types; never bytes),
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
  key (primary key), enabled, reason, scheduled_at, notify, updated_at

provider_slots
  key (primary key), next_at

analytics_erasures
  distinct_id (primary key), passes_left, attempts, next_attempt_at, created_at
```

Indexes and constraints:

- Unique: `auth_sessions.token_hash`, `users.google_sub`, `credentials(user_id, kind, provider)`, `sources(message_id, position)`.
- `credential_usage(credential_id, day)` is the primary key.
- `conversations(user_id, pinned, updated_at, id)` puts pinned first and supports keyset pagination; `conversations(user_id, updated_at, id)` serves the total count.
- `messages(conversation_id, created_at, id)` supports message pagination.
- A partial unique index allows at most one `streaming` message per conversation.
- Indexed for cleanup: `rate_limits.expires_at`, `provider_slots.next_at`, `analytics_erasures.next_attempt_at`, `users.last_seen_at`.
- Deleting a user cascades to all their rows.

Columns worth knowing:

- `users.terms_version`: accepted `LEGAL_VERSION` (null until accepted). `users.last_seen_at`: set on sign-in and daily session renewal. `users.shutdown_notified_at`: when the shutdown notice was accepted by SMTP (reset on scheduling).
- `settings.analytics_opt_out`: default `false`.
- `system_flags`: the [killswitch](operations.md#operational-killswitch) and the `shutdown` row ([Scheduled shutdown](#scheduled-shutdown)).
- `conversations.updated_at`: last activity (new exchange or mode change); drives sidebar order, the 100 cap and 60-day expiry.

Migrations are recorded in `beamling_migrations(filename, checksum, applied_at)`. Editing an applied file fails the next run; rows without a checksum are baselined.

## Message lifecycle

```text
user question  → insert row with status complete
assistant      → insert row with status streaming
                 ↓
              complete | stopped | error
```

- The assistant row is inserted 1 ms after the question, for stable order. Both store `mode`.
- Titles and content are encrypted; ids are generated in the app so the AAD can bind to them.
- A title still `New conversation` becomes the first 48 normalized characters of the first question.

## Starting an exchange

`createExchange()` runs in one transaction:

1. Take transaction-scoped advisory lock `7314002918` (serializes concurrency checks across instances).
2. `SELECT … FOR UPDATE` the conversation and verify ownership.
3. Mark this conversation's streaming answers older than 8 minutes `error` / `INTERRUPTED`.
4. If non-stale streaming messages ≥ `MAX_CONCURRENT_CHATS`, return `SERVER_BUSY` (503).
5. Deeper only: if streaming Deeper messages ≥ half of `MAX_CONCURRENT_CHATS` (floor, min 1), return `SERVER_BUSY` suggesting Deep.
6. Check the account's streaming messages against `MAX_CONCURRENT_CHATS_PER_USER`.
7. Retry: the target must be the latest answer, `error`/`stopped` (or stale), with a preceding question. Delete it and reuse the question.
8. New question: insert it with control characters removed.
9. Insert the `streaming` assistant placeholder.
10. Update title (first question only), mode and `updated_at`.

A second concurrent answer in one conversation hits the partial unique index: `GENERATION_IN_PROGRESS` (409). A 5-second lock timeout or advisory-lock wait timeout maps to `SERVER_BUSY`.

## Finishing an answer

`completeAssistant()` runs in one transaction:

1. Update content, status, flags, usage and error fields where owner matches and `status = streaming`. An answer already marked `INTERRUPTED` updates nothing and no success is announced.
2. Row gone (conversation or account deleted): return `false`.
3. Replace the message's sources.

## Pagination and deletion

- Conversation summaries: 50 per page, newest first by `(updated_at, id)`.
- Messages: 60 per page, selected newest first by `(created_at, id)`, returned oldest first.
- `GET /api/conversations/:id` returns the newest page plus `hasMoreMessages`.
- `GET /api/conversations/:id/messages?before=<messageId>` returns the previous page.
- Cursors are base64url JSON tuples; invalid ones return `INVALID_CURSOR`.
- Deleting a conversation cascades to messages and sources and aborts its local active answers. `POST /api/conversations/delete { ids }` deletes up to 100 at once, ignores ids of other accounts and returns `{ deleted }`.
- Max 100 conversations per account (`MAX_CONVERSATIONS`). After `/api/chat` stores a question, `trimConversations` keeps the current one plus the first 99 others in sidebar order (pinned first, then most recent) and deletes the rest. Deleted ids are sent in the `meta` event's `removed`. Trim failures are logged, not fatal.
- Database guard: before a new question, if `pg_database_size` ≥ `DATABASE_SIZE_LIMIT_MB` (default 850, below the Neon Free plan's 1 GB) `prepareChat` returns `SERVICE_FULL` (503) for everyone.
- Per-account storage limit: 10 MB (`STORAGE_LIMIT_MB`), measured on demand as `pg_column_size` of the account's conversation, message and source rows (ciphertext). Nothing about usage is stored. `prepareChat` checks it before a new question (not a retry) and returns `STORAGE_FULL` at the limit.
- Max 100 questions per conversation (`MAX_QUESTIONS_PER_CONVERSATION`); the next returns `CONVERSATION_FULL`.
- Source snippets are stored truncated to 2,200 characters, the length the prompt reads.
- Deleting an account deletes sessions, per-user rate-limit keys and the user row; the rest cascades.

## Cleanup

`runCleanup()` (`lib/server/cleanup.ts`) runs at start and hourly, one run at a time per process. `GET /api/health` starts a run when the last one is over an hour old and waits up to 20 s for the run in flight, so on Cloud Run the hourly watchdog probe gives it CPU. Each run:

- Delete accounts unseen for 24 months, or older than 7 days without accepted terms (max 50 per run, `inactive_account_deleted` audit event).
- Delete conversations with `updated_at` older than 60 days (`CONVERSATION_RETENTION_DAYS`), pinned or not, max 1,000 per run.
- Delete expired sessions and rate-limit rows.
- Delete provider slots with `next_at` over an hour past.
- Delete empty conversations older than an hour.
- Mark stale streaming answers `error` / `INTERRUPTED`.
- Run due PostHog erasures ([Data deletion](security.md#data-deletion)), max 20 per run.
- Advance a scheduled shutdown ([Scheduled shutdown](#scheduled-shutdown)).

Steps run independently; failures are logged and serving continues.

## Scheduled shutdown

Scheduled with `POST /api/internal/shutdown` ([runbook](operations.md#incident-runbook)). State is the `system_flags` row `shutdown` (`scheduled_at`, optional `reason`, `notify`); deleting it cancels.

- `scheduled_at` = now + `days` (min `SHUTDOWN_NOTICE_DAYS = 14`, max 365, default 14). Scheduling clears every `users.shutdown_notified_at`, so a new date is re-announced.
- While scheduled: new accounts get `SERVICE_CLOSING`; existing users can sign in and export. the app, `/login` and `/status` show the date (Europe/Rome); the chat banner links to data export.
- `processShutdown()` runs after scheduling (if `notify`) and every cleanup tick, under a session advisory lock (other instances skip). Idempotent.
  - Before the date: email unnotified accounts, oldest first, batches of 50, 250 ms apart. A failure stops the run until the next tick. No mail with `notify: false` or without `SMTP_URL`/`MAIL_FROM`.
  - From the date: delete every account in batches of 50 (`shutdown_account_deleted` audit event).
- After the date every sign-in gets `SERVICE_CLOSED` and `/login` hides the button.
- The notice is one English plain-text email: date, what is deleted, how to export, the reason and contact. Beamling sends no other email.

# Data Model

## Schema

Alpha 1 auth is Google-only OIDC: store the Google subject, verified email, name, avatar URL and a hashed opaque session token. No passwords, guests or other identity providers.

The DDL below is the **target logical schema**, not a migration. The current schema is `packages/web/drizzle/0000_init.sql`. Content columns store `enc:v1:` envelopes ([Workspace data encryption (public-launch target)](keys.md#workspace-data-encryption-public-launch-target)): `conversations.title`; `messages.content`, `error_message`, `searches`, `reasoning`; `sources.url`, `title`, `domain`, `snippet`. Other columns are minimal operational metadata.

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  google_sub text not null unique,
  email text not null,
  email_verified boolean not null default false,
  name text,
  avatar_url text,
  terms_version text,
  terms_accepted_at timestamptz,
  last_seen_at timestamptz not null default now(),
  shutdown_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table user_data_keys (
  user_id uuid primary key references users(id) on delete cascade,
  key_id text not null,
  wrapped_key text not null,
  wrap_nonce text,
  wrap_tag text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('llm','search')),
  provider text not null,
  key_id text not null,
  wrapped_dek text not null,
  dek_nonce text not null,
  dek_tag text not null,
  nonce text not null,
  ciphertext text not null,
  tag text not null,
  fingerprint text not null,
  last4 text,
  status text not null default 'unverified' check (status in ('unverified','active','invalid','rate_limited')),
  plan text check (plan in ('free','paid')),
  expires_on date,
  budget_usd numeric(12,2),
  budget_period text check (budget_period = 'month'),
  budget_started_at timestamptz,
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, provider)
);

create table credential_usage (
  credential_id uuid not null references credentials(id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  primary key (credential_id, day)
);

create table settings (
  user_id uuid primary key references users(id) on delete cascade,
  llm_model text not null default 'nvidia/nemotron-3.5-super-vl:free',
  search_provider text not null default 'brave' check (search_provider in ('brave','tavily','exa')),
  default_mode text not null default 'quick',
  updated_at timestamptz not null default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null default 'New conversation',
  mode text not null default 'quick' check (mode in ('quick','deep','deeper')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null default '',
  status text not null default 'complete' check (status in ('pending','streaming','complete','stopped','error')),
  mode text check (mode in ('quick','deep','deeper')),
  uncited boolean not null default false,
  no_sources boolean not null default false,
  truncated boolean not null default false,
  degraded boolean not null default false,
  searches text,
  reasoning text,
  llm_model text,
  resolved_model text,
  upstream_provider text,
  search_provider text check (search_provider in ('brave','tavily','exa')),
  search_requests integer not null default 0,
  search_failures integer not null default 0,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(12,6),
  search_cost_usd numeric(12,6),
  latency_ms integer,
  error_code text,
  error_message text,
  stop_requested boolean not null default false,
  created_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  position integer not null,
  url text not null,
  title text,
  domain text,
  snippet text,
  published_at timestamptz
);

create table rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null default 0,
  expires_at timestamptz not null
);

create table system_flags (
  key text primary key,
  enabled boolean not null,
  reason text,
  scheduled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index conversations_user_updated_idx on conversations (user_id, updated_at desc);
create index messages_conversation_created_idx on messages (conversation_id, created_at);
create index credentials_user_idx on credentials (user_id);
create index credential_usage_day_idx on credential_usage (day);
create index auth_sessions_user_idx on auth_sessions (user_id);
create index auth_sessions_expires_idx on auth_sessions (expires_at);
create unique index sources_message_position_idx on sources (message_id, position);
create unique index messages_one_streaming_per_conversation_idx on messages (conversation_id) where status = 'streaming';
create index messages_streaming_created_idx on messages (created_at) where status = 'streaming';
create table provider_slots (
  key text primary key,
  next_at timestamptz not null
);
```

## Retention

| Data | Default retention | On account deletion |
|---|---|---|
| Users | Until deleted; auto-deleted after 24 months inactive, or 7 days without terms acceptance | Hard delete, including workspace key |
| Auth sessions | 30-day sliding, 90-day absolute; revoked deleted immediately | Hard delete |
| Rate-limit counters | Until the window expires | Hashed identifiers; cleaned on expiry |
| Credentials and declared limits | Until deleted or replaced | Hard delete |
| Conversations, messages, sources | 60 days after last activity, pinned or not; max 100 per account (oldest unpinned deleted first) | Hard delete |
| Workspace data keys | Until account deletion | Wrapped key destroyed ([encryption](keys.md#workspace-data-encryption-public-launch-target)) |
| Message and search-usage fields | Until the conversation or credential is deleted | Hard delete |
| Application logs | `LEGAL_LOG_RETENTION_DAYS` (default 30), secrets redacted, set at the host | Not user-linked beyond the window |
| Backups | `LEGAL_BACKUP_RETENTION_DAYS` (default 7), set at the database provider | Expire within the window |

Log and backup retention are stated in the privacy notice. Account deletion destroys the wrapped data key, so backed-up content can't be decrypted through the app; the ciphertext stays KMS-protected until backups expire. On service closure all accounts are deleted on the announced date (FR-75); destroying the KMS key then makes every backup unreadable.

# Data Model

## Schema

Auth in Alpha 1 is Google-only OIDC. Store the Google subject, verified email, display name and avatar URL, plus an opaque session token hash. There is no password, guest flag or alternative identity provider.

The DDL below is the **target logical schema**. It is not the current migration and not a migration source. The current schema is the single starting migration `packages/web/drizzle/0000_init.sql`; content-bearing columns store `enc:v1:` envelope payloads as specified in [Workspace data encryption (public-launch target)](keys.md#workspace-data-encryption-public-launch-target). In particular: `conversations.title`; `messages.content`, `messages.error_message`, `messages.searches` and `messages.reasoning`; and `sources.url`, `sources.title`, `sources.domain` and `sources.snippet`. The other columns are the minimal operational metadata listed in [Workspace data encryption (public-launch target)](keys.md#workspace-data-encryption-public-launch-target).

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
  budget_period text check (budget_period in ('month','total')),
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

create table credential_usage (
  credential_id uuid not null references credentials(id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  primary key (credential_id, day)
);

create table settings (
  user_id uuid primary key references users(id) on delete cascade,
  llm_model text not null default 'deepseek/deepseek-v4.1-flash',
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
| Users | Until deleted; automatically deleted after 24 months without sign-in or session renewal, or 7 days after creation without terms acceptance | Hard delete in the same request; workspace key deletion included |
| Auth sessions | 30-day sliding expiry, 90-day absolute lifetime; revoked sessions deleted immediately | Hard delete in the same request |
| Rate-limit counters | Until the window expires | Hashed identifiers; counters cleaned on expiry |
| Credentials and declared limits | Until deleted or replaced | Hard delete in the same request |
| Conversations, messages, sources | 60 days after the conversation's last activity, pinned or not; at most 100 conversations per account (least recently active unpinned deleted first) | Hard delete in the same request |
| Workspace data keys | Until the account is deleted | Wrapped key destroyed; backup ciphertext is useless without the master key ([Workspace data encryption (public-launch target)](keys.md#workspace-data-encryption-public-launch-target)) |
| Message and search-usage fields | Until the conversation or credential is deleted | Hard delete in the same request |
| Application logs | `LEGAL_LOG_RETENTION_DAYS` (default 30), secrets redacted; retention is configured at the host and stated in the privacy notice | Not user-linked beyond the log window |
| Backups | `LEGAL_BACKUP_RETENTION_DAYS` (default 7), configured at the database provider and stated in the privacy notice | Expire within the backup window |

If the service closes, every account is deleted on the announced date (FR-75), and destroying the KMS key afterwards makes every backup unreadable.

Deleting an account removes its wrapped data key, so content retained in backups cannot be decrypted through the application. Backups still contain ciphertext and remain protected by the KMS master key until they expire.

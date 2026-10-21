import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DEFAULT_CONVERSATION_TITLE } from "../data";
import { DEFAULT_LLM_MODEL, DEFAULT_SEARCH_PROVIDER } from "../providers";

// Millisecond precision matches JavaScript dates, so timestamps round-trip exactly as pagination cursors.
const timestampMs = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    googleSub: text("google_sub").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_google_sub_idx").on(table.googleSub)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_idx").on(table.tokenHash),
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expires_idx").on(table.expiresAt),
  ],
);

export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    // Identifies the master key that wrapped the DEK, so the master key can be rotated.
    keyId: text("key_id").notNull(),
    wrappedDek: text("wrapped_dek").notNull(),
    dekNonce: text("dek_nonce").notNull(),
    dekTag: text("dek_tag").notNull(),
    nonce: text("nonce").notNull(),
    ciphertext: text("ciphertext").notNull(),
    tag: text("tag").notNull(),
    fingerprint: text("fingerprint").notNull(),
    last4: text("last4"),
    status: text("status").notNull().default("unverified"),
    plan: text("plan"),
    expiresOn: date("expires_on", { mode: "string" }),
    budgetUsd: numeric("budget_usd", { precision: 12, scale: 2 }),
    budgetPeriod: text("budget_period"),
    budgetStartedAt: timestamp("budget_started_at", { withTimezone: true }),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("credentials_user_kind_provider_idx").on(table.userId, table.kind, table.provider),
    index("credentials_user_idx").on(table.userId),
  ],
);


export const userDataKeys = pgTable("user_data_keys", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  keyId: text("key_id").notNull(),
  wrappedKey: text("wrapped_key").notNull(),
  wrapNonce: text("wrap_nonce"),
  wrapTag: text("wrap_tag"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
});

export const credentialUsage = pgTable(
  "credential_usage",
  {
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    requests: integer("requests").notNull().default(0),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  },
  (table) => [
    primaryKey({ columns: [table.credentialId, table.day] }),
    index("credential_usage_day_idx").on(table.day),
  ],
);

export const settings = pgTable("settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  llmModel: text("llm_model").notNull().default(DEFAULT_LLM_MODEL),
  defaultSearchProvider: text("default_search_provider").notNull().default(DEFAULT_SEARCH_PROVIDER),
  defaultMode: text("default_mode").notNull().default("quick"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(DEFAULT_CONVERSATION_TITLE),
    mode: text("mode").notNull().default("quick"),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestampMs("created_at").notNull().defaultNow(),
    updatedAt: timestampMs("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("conversations_user_updated_idx").on(table.userId, table.updatedAt, table.id),
    // Pinned chats sort first, so the sidebar page order is (pinned, updated_at, id).
    index("conversations_user_pinned_updated_idx").on(table.userId, table.pinned, table.updatedAt, table.id),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    status: text("status").notNull().default("complete"),
    mode: text("mode"),
    uncited: boolean("uncited").notNull().default(false),
    noSources: boolean("no_sources").notNull().default(false),
    truncated: boolean("truncated").notNull().default(false),
    // Deep planner output was unusable, so the run searched the question directly.
    degraded: boolean("degraded").notNull().default(false),
    // Encrypted JSON search trace and model-provided reasoning.
    searches: text("searches"),
    reasoning: text("reasoning"),
    // The model and search provider the user selected for this answer.
    llmModel: text("llm_model"),
    searchProvider: text("search_provider").notNull().default(DEFAULT_SEARCH_PROVIDER),
    resolvedModel: text("resolved_model"),
    upstreamProvider: text("upstream_provider"),
    searchRequests: integer("search_requests").notNull().default(0),
    searchFailures: integer("search_failures").notNull().default(0),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    // Generation cost reported by OpenRouter (actual).
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    // Search cost estimated from the selected provider's list price.
    searchCostUsd: numeric("search_cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    stopRequested: boolean("stop_requested").notNull().default(false),
    createdAt: timestampMs("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt, table.id),
    // Deleting a user cascades to its messages; without this index every delete scans the table.
    index("messages_user_idx").on(table.userId),
    // One in-flight answer per conversation; the insert fails atomically across instances.
    uniqueIndex("messages_one_streaming_per_conversation_idx")
      .on(table.conversationId)
      .where(sql`"status" = 'streaming'`),
    index("messages_streaming_created_idx").on(table.createdAt).where(sql`"status" = 'streaming'`),
  ],
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    domain: text("domain"),
    snippet: text("snippet"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("sources_message_position_idx").on(table.messageId, table.position)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("rate_limits_expires_idx").on(table.expiresAt)],
);

/**
 * Next free request slot per provider key (hashed), shared by every instance. Spaces requests
 * for plans with a per-second limit.
 */
export const providerSlots = pgTable(
  "provider_slots",
  {
    key: text("key").primaryKey(),
    nextAt: timestamp("next_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("provider_slots_next_at_idx").on(table.nextAt)],
);

/**
 * PostHog persons still to erase after an account deletion. Holds only the keyed hash, never the
 * account id. Each row runs twice on success, the second pass catching events that were in flight.
 */
export const analyticsErasures = pgTable(
  "analytics_erasures",
  {
    distinctId: text("distinct_id").primaryKey(),
    passesLeft: integer("passes_left").notNull().default(2),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("analytics_erasures_next_attempt_idx").on(table.nextAttemptAt)],
);

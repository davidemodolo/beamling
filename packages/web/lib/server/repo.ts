import { and, asc, count, desc, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";
import { DEFAULT_SETTINGS } from "../data";
import { isAllowedModel } from "../providers";
import type {
  AppState,
  Conversation,
  Credential,
  CredentialStatus,
  Message,
  Mode,
  Settings,
  Source,
  Usage,
} from "../types";
import { db } from "./db";
import { maxConcurrentChats } from "./env";
import { ApiError, pgErrorCode } from "./http";
import {
  authSessions,
  conversations,
  credentials,
  messages,
  settings,
  rateLimits,
  sources,
  users,
} from "./schema";

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type SourceRow = typeof sources.$inferSelect;
type CredentialRow = typeof credentials.$inferSelect;
type SettingsRow = typeof settings.$inferSelect;

/** A streaming answer older than this outlived the route's maxDuration and was interrupted. */
const STALE_STREAMING_MS = 3 * 60_000;
const UNIQUE_VIOLATION = "23505";
const DEFAULT_TITLE = "New conversation";
const CREDENTIAL_STATUSES: CredentialStatus[] = ["active", "invalid", "rate_limited", "unverified"];

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function staleBefore(): Date {
  return new Date(Date.now() - STALE_STREAMING_MS);
}

function mapSettings(row: SettingsRow | undefined): Settings {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    llmModel: row.llmModel,
    defaultMode: row.defaultMode === "deep" ? "deep" : "quick",
  };
}

function mapSource(row: SourceRow): Source {
  return {
    id: row.id,
    position: row.position,
    title: row.title ?? row.domain ?? "Untitled source",
    url: row.url,
    domain: row.domain ?? "",
    snippet: row.snippet ?? "",
    publishedAt: row.publishedAt ? iso(row.publishedAt) : undefined,
  };
}

function mapMessage(row: MessageRow, sourceRows: SourceRow[]): Message {
  const usage: Usage | undefined =
    row.tokensIn != null || row.tokensOut != null || row.costUsd != null
      ? {
          tokensIn: row.tokensIn ?? 0,
          tokensOut: row.tokensOut ?? 0,
          costUsd: row.costUsd ? Number(row.costUsd) : 0,
          latencyMs: row.latencyMs ?? undefined,
          searchRequests: row.searchRequests,
        }
      : undefined;

  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    status:
      row.status === "pending" ||
      row.status === "streaming" ||
      row.status === "stopped" ||
      row.status === "error"
        ? row.status
        : "complete",
    createdAt: iso(row.createdAt),
    mode: row.mode === "deep" ? "deep" : row.mode === "quick" ? "quick" : undefined,
    sources: sourceRows.map(mapSource),
    llmModel: row.llmModel ?? undefined,
    usage,
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    noSources: row.noSources,
    uncited: row.uncited,
  };
}

function mapCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    kind: row.kind === "search" ? "search" : "llm",
    provider: row.provider,
    last4: row.last4 ?? "0000",
    status: CREDENTIAL_STATUSES.includes(row.status as CredentialStatus)
      ? (row.status as CredentialStatus)
      : "unverified",
    lastValidatedAt: row.lastValidatedAt ? iso(row.lastValidatedAt) : iso(row.createdAt),
  };
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const list = groups.get(key(row));
    if (list) list.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

/** Loads messages and sources for the given conversation rows with two queries and maps them in one pass. */
async function loadConversations(rows: ConversationRow[]): Promise<Conversation[]> {
  if (!rows.length) return [];
  const messageRows = await db
    .select()
    .from(messages)
    .where(inArray(messages.conversationId, rows.map((row) => row.id)))
    .orderBy(asc(messages.createdAt));
  const sourceRows = messageRows.length
    ? await db
        .select()
        .from(sources)
        .where(inArray(sources.messageId, messageRows.map((row) => row.id)))
        .orderBy(asc(sources.position))
    : [];
  const sourcesByMessage = groupBy(sourceRows, (row) => row.messageId);
  const messagesByConversation = groupBy(messageRows, (row) => row.conversationId);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    mode: row.mode === "deep" ? "deep" : "quick",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    messages: (messagesByConversation.get(row.id) ?? []).map((message) =>
      mapMessage(message, sourcesByMessage.get(message.id) ?? []),
    ),
  }));
}

export async function ensureSettings(userId: string): Promise<Settings> {
  const [existing] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
  if (existing) return mapSettings(existing);
  const [created] = await db.insert(settings).values({ userId }).onConflictDoNothing().returning();
  return created ? mapSettings(created) : ensureSettings(userId);
}

export async function updateSettings(userId: string, patch: Partial<Settings>): Promise<Settings> {
  const current = await ensureSettings(userId);
  const next: Settings = {
    ...current,
    ...patch,
    llmModel: patch.llmModel && isAllowedModel(patch.llmModel) ? patch.llmModel : current.llmModel,
  };
  const [row] = await db
    .update(settings)
    .set({
      llmModel: next.llmModel,
      defaultMode: next.defaultMode,
      updatedAt: new Date(),
    })
    .where(eq(settings.userId, userId))
    .returning();
  return mapSettings(row);
}

async function listConversations(userId: string): Promise<Conversation[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt));
  return loadConversations(rows);
}

async function getConversationRow(userId: string, id: string): Promise<ConversationRow | null> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function conversationExists(userId: string, id: string): Promise<boolean> {
  return (await getConversationRow(userId, id)) !== null;
}

export async function getConversation(userId: string, id: string): Promise<Conversation | null> {
  const row = await getConversationRow(userId, id);
  if (!row) return null;
  const [conversation] = await loadConversations([row]);
  return conversation;
}

export async function createConversation(userId: string, mode: Mode): Promise<Conversation> {
  const [row] = await db
    .insert(conversations)
    .values({ userId, mode, title: DEFAULT_TITLE })
    .returning();
  const [conversation] = await loadConversations([row]);
  return conversation;
}

export async function setConversationMode(
  userId: string,
  id: string,
  mode: Mode,
): Promise<Conversation | null> {
  const [row] = await db
    .update(conversations)
    .set({ mode, updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();
  return row ? getConversation(userId, row.id) : null;
}

export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return result.length > 0;
}

export async function getHistory(userId: string, conversationId: string, before: Date): Promise<Message[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.userId, userId),
        lt(messages.createdAt, before),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(6);
  return rows.reverse().map((row) => mapMessage(row, []));
}

/**
 * Stores the question and a streaming assistant placeholder. Rejects a second concurrent answer
 * for the same conversation (enforced by a partial unique index) and enforces the global cap.
 */
export async function createExchange(input: {
  userId: string;
  conversationId: string;
  question: string;
  mode: Mode;
  llmModel: string;
}): Promise<{ userMessage: MessageRow; assistantMessage: MessageRow }> {
  const now = new Date();
  try {
    return await db.transaction(async (tx) => {
      const [conversation] = await tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)))
        .limit(1)
        .for("update");
      if (!conversation) throw new ApiError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);

      // An answer left streaming by a crashed instance must not block the conversation forever.
      await tx
        .update(messages)
        .set(interruptedFields())
        .where(
          and(
            eq(messages.conversationId, conversation.id),
            eq(messages.status, "streaming"),
            lte(messages.createdAt, staleBefore()),
          ),
        );

      const [{ value: inFlight }] = await tx
        .select({ value: count() })
        .from(messages)
        .where(and(eq(messages.status, "streaming"), gt(messages.createdAt, staleBefore())));
      if (inFlight >= maxConcurrentChats()) {
        throw new ApiError("SERVER_BUSY", "Beamling is busy right now. Try again in a minute.", 503);
      }

      const [userMessage] = await tx
        .insert(messages)
        .values({
          conversationId: conversation.id,
          userId: input.userId,
          role: "user",
          content: input.question,
          status: "complete",
          mode: input.mode,
          createdAt: now,
        })
        .returning();

      const [assistantMessage] = await tx
        .insert(messages)
        .values({
          conversationId: conversation.id,
          userId: input.userId,
          role: "assistant",
          content: "",
          status: "streaming",
          mode: input.mode,
          llmModel: input.llmModel,
          createdAt: new Date(now.getTime() + 1),
        })
        .returning();

      const title =
        conversation.title === DEFAULT_TITLE
          ? input.question.replace(/\s+/g, " ").trim().slice(0, 48) || DEFAULT_TITLE
          : conversation.title;

      await tx
        .update(conversations)
        .set({ title, mode: input.mode, updatedAt: now })
        .where(eq(conversations.id, conversation.id));

      return { userMessage, assistantMessage };
    });
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ApiError(
        "GENERATION_IN_PROGRESS",
        "An answer is already being written in this conversation. Stop it or wait for it to finish.",
        409,
      );
    }
    throw error;
  }
}

function interruptedFields() {
  return {
    status: "error",
    errorCode: "INTERRUPTED",
    errorMessage: "The answer was interrupted.",
  } as const;
}

export async function completeAssistant(input: {
  userId: string;
  messageId: string;
  content: string;
  status: "complete" | "stopped" | "error";
  sources?: Source[];
  usage?: Usage;
  uncited?: boolean;
  noSources?: boolean;
  errorCode?: string;
  errorMessage?: string;
  searchRequests?: number;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(messages)
      .set({
        content: input.content,
        status: input.status,
        noSources: input.noSources ?? false,
        uncited: input.uncited ?? false,
        searchRequests: input.searchRequests ?? 0,
        tokensIn: input.usage?.tokensIn ?? null,
        tokensOut: input.usage?.tokensOut ?? null,
        costUsd: input.usage ? input.usage.costUsd.toFixed(6) : null,
        latencyMs: input.usage?.latencyMs ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      })
      .where(and(eq(messages.id, input.messageId), eq(messages.userId, input.userId)));

    if (input.sources?.length) {
      await tx.delete(sources).where(eq(sources.messageId, input.messageId));
      await tx.insert(sources).values(
        input.sources.map((source) => ({
          messageId: input.messageId,
          position: source.position,
          url: source.url,
          title: source.title,
          domain: source.domain,
          snippet: source.snippet,
          publishedAt: parseDate(source.publishedAt),
        })),
      );
    }
  });
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Flags a streaming answer for cancellation; the instance running it polls this flag. */
export async function requestStop(userId: string, messageId: string): Promise<boolean> {
  const rows = await db
    .update(messages)
    .set({ stopRequested: true })
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId), eq(messages.status, "streaming")))
    .returning({ id: messages.id });
  return rows.length > 0;
}

export async function isStopRequested(messageId: string): Promise<boolean> {
  const [row] = await db
    .select({ stopRequested: messages.stopRequested })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  return row?.stopRequested ?? false;
}

async function listCredentials(userId: string): Promise<Credential[]> {
  const rows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.userId, userId))
    .orderBy(asc(credentials.createdAt));
  return rows.map(mapCredential);
}

export async function getCredentialRow(userId: string, kind: string, provider: string) {
  const [row] = await db
    .select()
    .from(credentials)
    .where(
      and(eq(credentials.userId, userId), eq(credentials.kind, kind), eq(credentials.provider, provider)),
    )
    .limit(1);
  return row ?? null;
}

export async function getCredentialById(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
    .limit(1);
  return row ?? null;
}

type CredentialKindValue = "llm" | "search";

/**
 * Inserts or atomically replaces the user's credential for this kind and provider. The id is
 * replaced too, because the ciphertext's AAD is bound to the id it was encrypted with.
 */
export async function saveCredential(input: {
  userId: string;
  id: string;
  kind: CredentialKindValue;
  provider: string;
  encrypted: {
    wrappedDek: string;
    dekNonce: string;
    dekTag: string;
    nonce: string;
    ciphertext: string;
    tag: string;
    fingerprint: string;
    last4: string;
  };
  status: CredentialStatus;
}): Promise<Credential> {
  const now = new Date();
  const values = {
    id: input.id,
    ...input.encrypted,
    status: input.status,
    lastValidatedAt: now,
    updatedAt: now,
  };
  const [row] = await db
    .insert(credentials)
    .values({ ...values, userId: input.userId, kind: input.kind, provider: input.provider })
    .onConflictDoUpdate({
      target: [credentials.userId, credentials.kind, credentials.provider],
      set: { ...values, createdAt: now },
    })
    .returning();
  return mapCredential(row);
}

export async function updateCredentialValidation(
  userId: string,
  id: string,
  status: CredentialStatus,
): Promise<Credential | null> {
  const now = new Date();
  const [row] = await db
    .update(credentials)
    .set({ status, lastValidatedAt: now, updatedAt: now })
    .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
    .returning();
  return row ? mapCredential(row) : null;
}

export async function deleteCredential(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
    .returning({ id: credentials.id });
  return rows.length > 0;
}

export async function getState(user: { id: string; isGuest: boolean; createdAt: Date }): Promise<AppState> {
  const [conversationList, credentialList, userSettings] = await Promise.all([
    listConversations(user.id),
    listCredentials(user.id),
    ensureSettings(user.id),
  ]);
  return {
    user: { id: user.id, isGuest: user.isGuest, createdAt: iso(user.createdAt) },
    conversations: conversationList,
    credentials: credentialList,
    settings: userSettings,
  };
}

/** Fixed-window counter in a single atomic upsert, so concurrent requests cannot both pass the limit. */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowSeconds * 1000);
  const expired = sql`${rateLimits.expiresAt} <= ${now}`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: now, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then ${now} else ${rateLimits.windowStart} end`,
        expiresAt: sql`case when ${expired} then ${expiresAt} else ${rateLimits.expiresAt} end`,
      },
    })
    .returning({ count: rateLimits.count });
  if (row.count > limit) {
    throw new ApiError("RATE_LIMITED", "Too many requests. Try again later.", 429);
  }
}

export async function deleteAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await tx
      .delete(rateLimits)
      .where(inArray(rateLimits.key, [`chat:${userId}`, `credentials:${userId}`, `conversations:${userId}`]));
    await tx.delete(users).where(eq(users.id, userId));
  });
}

/** Retention housekeeping: expired sessions and counters, and answers orphaned by a crash or restart. */
export async function cleanupExpired(): Promise<void> {
  const now = new Date();
  await db.delete(authSessions).where(lte(authSessions.expiresAt, now));
  await db.delete(rateLimits).where(lte(rateLimits.expiresAt, now));
  await db
    .update(messages)
    .set(interruptedFields())
    .where(and(eq(messages.status, "streaming"), lte(messages.createdAt, staleBefore())));
}

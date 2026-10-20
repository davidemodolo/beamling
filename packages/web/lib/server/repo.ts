import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
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
import { ApiError } from "./http";
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

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

function mapConversation(row: ConversationRow, messageRows: MessageRow[], sourceRows: SourceRow[]): Conversation {
  const byMessage = new Map<string, SourceRow[]>();
  for (const source of sourceRows) {
    const list = byMessage.get(source.messageId) ?? [];
    list.push(source);
    byMessage.set(source.messageId, list);
  }
  return {
    id: row.id,
    title: row.title,
    mode: row.mode === "deep" ? "deep" : "quick",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    messages: messageRows.map((message) => mapMessage(message, byMessage.get(message.id) ?? [])),
  };
}

function mapCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    kind: row.kind === "search" ? "search" : "llm",
    provider: row.provider,
    last4: row.last4 ?? "0000",
    status: (["active", "invalid", "rate_limited", "unverified"] as CredentialStatus[]).includes(
      row.status as CredentialStatus,
    )
      ? (row.status as CredentialStatus)
      : "unverified",
    lastValidatedAt: row.lastValidatedAt ? iso(row.lastValidatedAt) : iso(row.createdAt),
  };
}

export async function ensureSettings(userId: string): Promise<Settings> {
  const [existing] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
  if (existing) return mapSettings(existing);
  const [created] = await db.insert(settings).values({ userId }).returning();
  return mapSettings(created);
}

export async function getSettings(userId: string): Promise<Settings> {
  return ensureSettings(userId);
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
  const conversationRows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt));

  if (!conversationRows.length) return [];
  const ids = conversationRows.map((row) => row.id);
  const messageRows = await db
    .select()
    .from(messages)
    .where(inArray(messages.conversationId, ids))
    .orderBy(asc(messages.createdAt));
  const messageIds = messageRows.map((row) => row.id);
  const sourceRows = messageIds.length
    ? await db.select().from(sources).where(inArray(sources.messageId, messageIds)).orderBy(asc(sources.position))
    : [];
  return conversationRows.map((row) =>
    mapConversation(
      row,
      messageRows.filter((message) => message.conversationId === row.id),
      sourceRows,
    ),
  );
}

export async function getConversation(userId: string, id: string): Promise<Conversation | null> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  if (!row) return null;
  const messageRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));
  const messageIds = messageRows.map((message) => message.id);
  const sourceRows = messageIds.length
    ? await db.select().from(sources).where(inArray(sources.messageId, messageIds)).orderBy(asc(sources.position))
    : [];
  return mapConversation(row, messageRows, sourceRows);
}

export async function createConversation(userId: string, mode: Mode): Promise<Conversation> {
  const [row] = await db
    .insert(conversations)
    .values({ userId, mode, title: "New conversation" })
    .returning();
  return mapConversation(row, [], []);
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

export async function createExchange(input: {
  userId: string;
  conversationId: string;
  question: string;
  mode: Mode;
  llmModel: string;
}): Promise<{ userMessage: MessageRow; assistantMessage: MessageRow }> {
  const now = new Date();
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)))
    .limit(1);
  if (!conversation) throw new Error("Conversation not found");

  const [userMessage] = await db
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

  const [assistantMessage] = await db
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
    conversation.title === "New conversation"
      ? input.question.replace(/\s+/g, " ").trim().slice(0, 48) || "New conversation"
      : conversation.title;

  await db
    .update(conversations)
    .set({
      title,
      mode: input.mode,
      updatedAt: now,
    })
    .where(eq(conversations.id, conversation.id));

  return { userMessage, assistantMessage };
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
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
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
          publishedAt: (() => {
            if (!source.publishedAt) return null;
            const date = new Date(source.publishedAt);
            return Number.isNaN(date.getTime()) ? null : date;
          })(),
        })),
      );
    }
  });
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
  const [row] = await db
    .insert(credentials)
    .values({
      id: input.id,
      userId: input.userId,
      kind: input.kind,
      provider: input.provider,
      ...input.encrypted,
      status: input.status,
      lastValidatedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [credentials.userId, credentials.kind, credentials.provider],
      set: {
        wrappedDek: input.encrypted.wrappedDek,
        dekNonce: input.encrypted.dekNonce,
        dekTag: input.encrypted.dekTag,
        nonce: input.encrypted.nonce,
        ciphertext: input.encrypted.ciphertext,
        tag: input.encrypted.tag,
        fingerprint: input.encrypted.fingerprint,
        last4: input.encrypted.last4,
        status: input.status,
        lastValidatedAt: now,
        updatedAt: now,
      },
    })
    .returning();
  return mapCredential(row);
}

type CredentialKindValue = "llm" | "search";

export async function updateCredentialValidation(
  userId: string,
  id: string,
  status: CredentialStatus,
): Promise<Credential | null> {
  const [row] = await db
    .update(credentials)
    .set({ status, lastValidatedAt: new Date(), updatedAt: new Date() })
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

export async function getState(userId: string, userCreatedAt = new Date()): Promise<AppState> {
  const [conversationList, credentialList, userSettings] = await Promise.all([
    listConversations(userId),
    listCredentials(userId),
    ensureSettings(userId),
  ]);
  return {
    user: { id: userId, isGuest: true, createdAt: iso(userCreatedAt) },
    conversations: conversationList,
    credentials: credentialList,
    settings: userSettings,
  };
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const now = new Date();
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);
  if (!row || row.expiresAt <= now) {
    await db
      .insert(rateLimits)
      .values({
        key,
        windowStart: now,
        count: 1,
        expiresAt: new Date(now.getTime() + windowSeconds * 1000),
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          windowStart: now,
          count: 1,
          expiresAt: new Date(now.getTime() + windowSeconds * 1000),
        },
      });
    return;
  }
  if (row.count >= limit) {
    throw new ApiError("RATE_LIMITED", "Too many requests. Try again later.", 429);
  }
  await db
    .update(rateLimits)
    .set({ count: row.count + 1 })
    .where(eq(rateLimits.key, key));
}

export async function deleteAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await tx.delete(rateLimits).where(inArray(rateLimits.key, [`chat:${userId}`, `credentials:${userId}`]));
    await tx.delete(users).where(eq(users.id, userId));
  });
}

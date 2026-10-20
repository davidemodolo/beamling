import { and, asc, count, desc, eq, inArray, lt, or } from "drizzle-orm";
import { CONVERSATION_PAGE_SIZE, DEFAULT_CONVERSATION_TITLE, MESSAGE_PAGE_SIZE } from "../../data";
import type { Conversation, ConversationPage, ConversationSummary, Message, Mode } from "../../types";
import { db } from "../db";
import { ApiError } from "../http";
import { conversations, messages, sources } from "../schema";
import { groupBy, mapMessage, mapSummary, type ConversationRow, type MessageRow } from "./shared";

/** Opaque keyset cursor over (updated_at, id), newest first. */
function encodeCursor(row: ConversationRow): string {
  return Buffer.from(JSON.stringify([row.updatedAt.toISOString(), row.id])).toString("base64url");
}

function decodeCursor(cursor: string): { updatedAt: Date; id: string } {
  try {
    const [updatedAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];
    const date = new Date(updatedAt);
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(date.getTime())) throw new Error();
    return { updatedAt: date, id };
  } catch {
    throw new ApiError("INVALID_CURSOR", "Invalid page cursor.", 400);
  }
}

export async function listConversationPage(userId: string, cursor?: string): Promise<ConversationPage> {
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        after
          ? or(
              lt(conversations.updatedAt, after.updatedAt),
              and(eq(conversations.updatedAt, after.updatedAt), lt(conversations.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(CONVERSATION_PAGE_SIZE + 1);
  const page = rows.slice(0, CONVERSATION_PAGE_SIZE);
  return {
    conversations: page.map(mapSummary),
    nextCursor: rows.length > CONVERSATION_PAGE_SIZE ? encodeCursor(page[page.length - 1]) : null,
  };
}

export async function countConversations(userId: string): Promise<number> {
  const [{ value }] = await db.select({ value: count() }).from(conversations).where(eq(conversations.userId, userId));
  return value;
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

/** Attaches sources to a bounded page of messages (at most MESSAGE_PAGE_SIZE ids per query). */
async function withSources(rows: MessageRow[]): Promise<Message[]> {
  const ids = rows.filter((row) => row.role === "assistant").map((row) => row.id);
  const sourceRows = ids.length
    ? await db.select().from(sources).where(inArray(sources.messageId, ids)).orderBy(asc(sources.position))
    : [];
  const byMessage = groupBy(sourceRows, (row) => row.messageId);
  return rows.map((row) => mapMessage(row, byMessage.get(row.id) ?? []));
}

/** The newest page of messages older than `before` (or the newest overall), returned oldest first. */
async function messagePage(
  userId: string,
  conversationId: string,
  before?: { createdAt: Date; id: string },
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.userId, userId),
        before
          ? or(
              lt(messages.createdAt, before.createdAt),
              and(eq(messages.createdAt, before.createdAt), lt(messages.id, before.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(MESSAGE_PAGE_SIZE + 1);
  const page = rows.slice(0, MESSAGE_PAGE_SIZE).reverse();
  return { messages: await withSources(page), hasMore: rows.length > MESSAGE_PAGE_SIZE };
}

export async function getConversation(userId: string, id: string): Promise<Conversation | null> {
  const row = await getConversationRow(userId, id);
  if (!row) return null;
  const page = await messagePage(userId, row.id);
  return { ...mapSummary(row), messages: page.messages, hasMoreMessages: page.hasMore };
}

/** Messages older than `beforeMessageId`, or null when the conversation or message is not the user's. */
export async function getEarlierMessages(
  userId: string,
  conversationId: string,
  beforeMessageId: string,
): Promise<{ messages: Message[]; hasMore: boolean } | null> {
  const [anchor] = await db
    .select({ createdAt: messages.createdAt, id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.id, beforeMessageId),
        eq(messages.conversationId, conversationId),
        eq(messages.userId, userId),
      ),
    )
    .limit(1);
  if (!anchor) return null;
  return messagePage(userId, conversationId, anchor);
}

export async function createConversation(userId: string, mode: Mode): Promise<ConversationSummary> {
  const [row] = await db
    .insert(conversations)
    .values({ userId, mode, title: DEFAULT_CONVERSATION_TITLE })
    .returning();
  return mapSummary(row);
}

export async function setConversationMode(
  userId: string,
  id: string,
  mode: Mode,
): Promise<ConversationSummary | null> {
  const [row] = await db
    .update(conversations)
    .set({ mode, updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();
  return row ? mapSummary(row) : null;
}

export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return result.length > 0;
}

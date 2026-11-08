import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { CONVERSATION_PAGE_SIZE, DEFAULT_CONVERSATION_TITLE, MESSAGE_PAGE_SIZE } from "../../data";
import { CONVERSATION_RETENTION_DAYS, MAX_CONVERSATIONS } from "../../legal";
import type { Conversation, ConversationPage, ConversationSummary, Message, Mode } from "../../types";
import { db } from "../db";
import { ApiError, isUuid } from "../http";
import { conversations, messages, sources } from "../schema";
import { encryptText } from "../workspace-key";
import { groupBy, mapMessage, mapSummary, type ConversationRow, type MessageRow } from "./shared";

/** Opaque keyset cursor over (pinned, updated_at, id). */
function encodeCursor(row: ConversationRow): string {
  return Buffer.from(JSON.stringify([row.pinned, row.updatedAt.toISOString(), row.id])).toString("base64url");
}

function decodeCursor(cursor: string): { pinned: boolean; updatedAt: Date; id: string } {
  try {
    const [pinned, updatedAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [
      boolean,
      string,
      string,
    ];
    const date = new Date(updatedAt);
    if (
      typeof pinned !== "boolean" ||
      typeof id !== "string" ||
      !isUuid(id) ||
      Number.isNaN(date.getTime())
    ) {
      throw new Error();
    }
    return { pinned, updatedAt: date, id };
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
              lt(conversations.pinned, after.pinned),
              and(
                eq(conversations.pinned, after.pinned),
                or(
                  lt(conversations.updatedAt, after.updatedAt),
                  and(eq(conversations.updatedAt, after.updatedAt), lt(conversations.id, after.id)),
                ),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(conversations.pinned), desc(conversations.updatedAt), desc(conversations.id))
    .limit(CONVERSATION_PAGE_SIZE + 1);
  const page = rows.slice(0, CONVERSATION_PAGE_SIZE);
  return {
    conversations: await Promise.all(page.map((row) => mapSummary(userId, row))),
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

/** Attaches sources to a bounded batch of messages (one query for the whole batch). */
async function withSources(rows: MessageRow[]): Promise<Message[]> {
  const ids = rows.filter((row) => row.role === "assistant").map((row) => row.id);
  const sourceRows = ids.length
    ? await db.select().from(sources).where(inArray(sources.messageId, ids)).orderBy(asc(sources.position))
    : [];
  const byMessage = groupBy(sourceRows, (row) => row.messageId);
  const userId = rows[0]?.userId;
  if (!userId) return [];
  return Promise.all(rows.map((row) => mapMessage(userId, row, byMessage.get(row.id) ?? [])));
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
  return { ...(await mapSummary(userId, row)), messages: page.messages, hasMoreMessages: page.hasMore };
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

/**
 * Keeps at most MAX_CONVERSATIONS per account by deleting the ones that sort last in the sidebar:
 * unpinned before pinned, then least recently active. `keepId` (the conversation just created) is
 * never removed. Returns the ids that were deleted.
 */
export async function trimConversations(userId: string, keepId: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    delete from conversations
    where id in (
      select id from conversations
      where user_id = ${userId} and id <> ${keepId}
      order by pinned desc, updated_at desc, id desc
      offset ${MAX_CONVERSATIONS - 1}
    )
    returning id
  `);
  return result.rows.map((row) => row.id);
}

/** Conversations deleted per cleanup run, so a backlog cannot hold the pool. */
const EXPIRY_BATCH = 1000;

/** Deletes conversations whose last activity is older than CONVERSATION_RETENTION_DAYS. */
export async function deleteExpiredConversations(): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    delete from conversations
    where id in (
      select id from conversations
      where updated_at < clock_timestamp() - make_interval(days => ${CONVERSATION_RETENTION_DAYS})
      limit ${EXPIRY_BATCH}
    )
    returning id
  `);
  return result.rows.length;
}

export async function createConversation(userId: string, mode: Mode): Promise<ConversationSummary> {
  const id = randomUUID();
  const [row] = await db
    .insert(conversations)
    .values({
      id,
      userId,
      mode,
      title: await encryptText(userId, "conversations", id, "title", DEFAULT_CONVERSATION_TITLE),
    })
    .returning();
  return mapSummary(userId, row);
}

export async function updateConversation(
  userId: string,
  id: string,
  patch: { mode?: Mode; pinned?: boolean },
): Promise<ConversationSummary | null> {
  const values: { mode?: Mode; pinned?: boolean; updatedAt?: Date } = {};
  if (patch.mode !== undefined) {
    values.mode = patch.mode;
    values.updatedAt = new Date();
  }
  if (patch.pinned !== undefined) values.pinned = patch.pinned;
  const [row] = await db
    .update(conversations)
    .set(values)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning();
  return row ? mapSummary(userId, row) : null;
}

/** Reclaims an empty conversation left behind by a failed first question. */
export async function deleteConversationIfEmpty(userId: string, id: string): Promise<boolean> {
  const [row] = await db
    .select({ value: count() })
    .from(messages)
    .where(and(eq(messages.conversationId, id), eq(messages.userId, userId)));
  if (Number(row?.value ?? 0) > 0) return false;
  return deleteConversation(userId, id);
}

/** Removes abandoned empty conversations after an hour, without breaking an immediate retry. */
export async function cleanupEmptyConversations(): Promise<void> {
  await db.execute(sql`
    delete from conversations c
    where c.updated_at < clock_timestamp() - interval '1 hour'
      and not exists (select 1 from messages m where m.conversation_id = c.id)
  `);
}

/** Deletes the account's conversations among `ids` (messages and sources cascade); returns the deleted ids. */
export async function deleteConversations(userId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const result = await db
    .delete(conversations)
    .where(and(inArray(conversations.id, ids), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return result.map((row) => row.id);
}

export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  return (await deleteConversations(userId, [id])).length > 0;
}

// Messages whose sources are read in one query during export.
const EXPORT_SOURCE_BATCH = 500;

/**
 * Every conversation of the account with all its messages and sources, oldest first, for data export.
 * Reads all messages in one query and sources in large batches, instead of one query per conversation.
 */
export async function exportConversations(userId: string): Promise<(ConversationSummary & { messages: Message[] })[]> {
  const [rows, messageRows] = await Promise.all([
    db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(asc(conversations.createdAt), asc(conversations.id)),
    db.select().from(messages).where(eq(messages.userId, userId)).orderBy(asc(messages.createdAt), asc(messages.id)),
  ]);
  const mapped: Message[] = [];
  for (let start = 0; start < messageRows.length; start += EXPORT_SOURCE_BATCH) {
    mapped.push(...(await withSources(messageRows.slice(start, start + EXPORT_SOURCE_BATCH))));
  }
  // mapMessage keeps the row order, so each conversation's messages stay oldest first.
  const byConversation = groupBy(
    mapped.map((message, index) => ({ message, conversationId: messageRows[index]!.conversationId })),
    (item) => item.conversationId,
  );
  return Promise.all(
    rows.map(async (row) => ({
      ...(await mapSummary(userId, row)),
      messages: (byConversation.get(row.id) ?? []).map((item) => item.message),
    })),
  );
}

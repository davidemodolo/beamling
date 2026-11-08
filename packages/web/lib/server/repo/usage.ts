import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import type { UsageReport } from "../../types";
import { MAX_QUESTIONS_PER_CONVERSATION, STORAGE_LIMIT_BYTES, STORAGE_LIMIT_MB } from "../../legal";
import { db } from "../db";
import { databaseSizeLimitBytes } from "../env";
import { ApiError } from "../http";
import { conversations, messages, rateLimits } from "../schema";
import { decryptText } from "../workspace-key";

/** Rate-limit keys of the per-account question budgets, shared with the chat route. */
export const questionLimitKeys = (userId: string) => ({ hour: `chat:${userId}`, day: `chat-day:${userId}` });

/**
 * Bytes the account's chats take in the database: conversation, message and source rows as stored
 * (encrypted). Measured on demand, so nothing about usage is stored separately.
 */
export async function storageUsedBytes(userId: string): Promise<number> {
  const result = await db.execute<{ bytes: string | null }>(sql`
    select
      coalesce((select sum(pg_column_size(c.*)) from conversations c where c.user_id = ${userId}), 0)
      + coalesce((select sum(pg_column_size(m.*)) from messages m where m.user_id = ${userId}), 0)
      + coalesce((
          select sum(pg_column_size(s.*)) from sources s
          join messages m on m.id = s.message_id
          where m.user_id = ${userId}
        ), 0) as bytes
  `);
  return Number(result.rows[0]?.bytes ?? 0);
}

/** Questions already asked in a conversation. */
async function questionCount(userId: string, conversationId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.userId, userId), eq(messages.role, "user")));
  return value;
}

/** Bytes the whole database takes on disk, tables, indexes and all. */
async function databaseSizeBytes(): Promise<number> {
  const result = await db.execute<{ bytes: string }>(sql`select pg_database_size(current_database()) as bytes`);
  return Number(result.rows[0]?.bytes ?? 0);
}

/**
 * Refuses a new question when the database is near its plan's cap, the account's storage is full
 * or the conversation has reached its question cap.
 */
export async function assertCanAsk(userId: string, conversationId: string | undefined): Promise<void> {
  if ((await databaseSizeBytes()) >= databaseSizeLimitBytes()) {
    throw new ApiError("SERVICE_FULL", "Beamling is out of storage for now. New questions are paused; existing chats still open.", 503);
  }
  if ((await storageUsedBytes(userId)) >= STORAGE_LIMIT_BYTES) {
    throw new ApiError(
      "STORAGE_FULL",
      `Your chats use the full ${STORAGE_LIMIT_MB} MB. Delete some to keep asking.`,
      403,
    );
  }
  if (conversationId && (await questionCount(userId, conversationId)) >= MAX_QUESTIONS_PER_CONVERSATION) {
    throw new ApiError(
      "CONVERSATION_FULL",
      `This chat has reached ${MAX_QUESTIONS_PER_CONVERSATION} questions. Start a new one.`,
      409,
    );
  }
}


const LARGEST_COUNT = 5;

/** The account's own usage for the limits page. */
export async function usageReport(userId: string): Promise<UsageReport> {
  const keys = questionLimitKeys(userId);
  const [storageBytes, [{ value: conversationCount }], counters, sizes] = await Promise.all([
    storageUsedBytes(userId),
    db.select({ value: count() }).from(conversations).where(eq(conversations.userId, userId)),
    db
      .select({ key: rateLimits.key, count: rateLimits.count })
      .from(rateLimits)
      .where(and(inArray(rateLimits.key, [keys.hour, keys.day]), gt(rateLimits.expiresAt, sql`clock_timestamp()`))),
    db.execute<{ id: string; title: string; bytes: string; questions: string }>(sql`
      select c.id, c.title,
        pg_column_size(c.*)
          + coalesce(sum(pg_column_size(m.*)), 0)
          + coalesce((
              select sum(pg_column_size(s.*)) from sources s
              join messages sm on sm.id = s.message_id
              where sm.conversation_id = c.id
            ), 0) as bytes,
        count(m.id) filter (where m.role = 'user') as questions
      from conversations c
      left join messages m on m.conversation_id = c.id
      where c.user_id = ${userId}
      group by c.id
      order by bytes desc
      limit ${LARGEST_COUNT}
    `),
  ]);
  const counter = (key: string) => counters.find((row) => row.key === key)?.count ?? 0;
  const largest = await Promise.all(
    sizes.rows.map(async (row) => ({
      id: row.id,
      title: await decryptText(userId, "conversations", row.id, "title", row.title).catch(() => "Untitled"),
      bytes: Number(row.bytes),
      questions: Number(row.questions),
    })),
  );
  return {
    storageBytes,
    conversations: conversationCount,
    questionsThisHour: counter(keys.hour),
    questionsToday: counter(keys.day),
    largest,
  };
}

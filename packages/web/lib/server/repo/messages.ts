import { and, count, desc, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";
import { DEFAULT_CONVERSATION_TITLE, titleFromQuestion } from "../../data";
import type { Message, Mode, Source, Usage } from "../../types";
import { db } from "../db";
import { maxConcurrentChats } from "../env";
import { ApiError, pgErrorCode, storableText } from "../http";
import { conversations, messages, sources } from "../schema";
import { interruptedFields, mapMessage, staleBefore, type MessageRow } from "./shared";

const UNIQUE_VIOLATION = "23505";
const LOCK_NOT_AVAILABLE = "55P03";
const HISTORY_MESSAGES = 6;
// Serializes the global concurrency check across instances (transaction-scoped advisory lock).
const CHAT_SLOT_LOCK_ID = 7_314_002_918;

/** The messages before `before` that form the prompt's conversation context, oldest first. */
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
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(HISTORY_MESSAGES);
  return rows.reverse().map((row) => mapMessage(row, []));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The failed or stopped answer being retried, with the question it answered. */
async function retryTarget(tx: Tx, input: { userId: string; conversationId: string; messageId: string }) {
  const [target] = await tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.id, input.messageId),
        eq(messages.conversationId, input.conversationId),
        eq(messages.userId, input.userId),
        eq(messages.role, "assistant"),
      ),
    )
    .limit(1);
  if (!target) throw new ApiError("MESSAGE_NOT_FOUND", "That answer no longer exists.", 404);
  // A stale streaming row reads as interrupted, so it can be retried too.
  if (mapMessage(target, []).status !== "error" && target.status !== "stopped") {
    throw new ApiError("RETRY_NOT_ALLOWED", "Only a failed or stopped answer can be retried.", 409);
  }
  const [newer] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, input.conversationId), gt(messages.createdAt, target.createdAt)))
    .limit(1);
  if (newer) throw new ApiError("RETRY_NOT_ALLOWED", "Only the latest answer can be retried.", 409);

  const [question] = await tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, input.conversationId),
        eq(messages.role, "user"),
        lte(messages.createdAt, target.createdAt),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(1);
  if (!question) throw new ApiError("MESSAGE_NOT_FOUND", "The question for that answer no longer exists.", 404);
  return { target, question };
}

/**
 * Stores the question (or reuses it, when retrying a failed or stopped answer, which is replaced) and
 * a streaming assistant placeholder. Rejects a second concurrent answer for the same conversation
 * (enforced by a partial unique index) and enforces the global concurrency cap.
 */
export async function createExchange(input: {
  userId: string;
  conversationId: string;
  mode: Mode;
  llmModel: string;
  question?: string;
  retryOf?: string;
}): Promise<{ userMessage: MessageRow; assistantMessage: MessageRow }> {
  try {
    return await db.transaction(async (tx) => {
      // Taken first so every exchange acquires its locks in the same order.
      await tx.execute(sql`select pg_advisory_xact_lock(${CHAT_SLOT_LOCK_ID})`);

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

      // Counted under the advisory lock, so concurrent exchanges see each other's committed rows.
      const [{ value: inFlight }] = await tx
        .select({ value: count() })
        .from(messages)
        .where(and(eq(messages.status, "streaming"), gt(messages.createdAt, staleBefore())));
      if (inFlight >= maxConcurrentChats()) {
        throw new ApiError("SERVER_BUSY", "Beamling is busy right now. Try again in a minute.", 503);
      }

      const now = new Date();
      let userMessage: MessageRow;
      if (input.retryOf) {
        const { target, question } = await retryTarget(tx, {
          userId: input.userId,
          conversationId: conversation.id,
          messageId: input.retryOf,
        });
        await tx.delete(messages).where(eq(messages.id, target.id));
        userMessage = question;
      } else {
        const question = storableText(input.question ?? "");
        [userMessage] = await tx
          .insert(messages)
          .values({
            conversationId: conversation.id,
            userId: input.userId,
            role: "user",
            content: question,
            status: "complete",
            mode: input.mode,
            createdAt: now,
          })
          .returning();
      }

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
          // Strictly after the question, so the thread order never depends on the clock's resolution.
          createdAt: new Date(Math.max(now.getTime(), userMessage.createdAt.getTime()) + 1),
        })
        .returning();

      const title =
        conversation.title === DEFAULT_CONVERSATION_TITLE ? titleFromQuestion(userMessage.content) : conversation.title;

      await tx
        .update(conversations)
        .set({ title, mode: input.mode, updatedAt: now })
        .where(eq(conversations.id, conversation.id));

      return { userMessage, assistantMessage };
    });
  } catch (error) {
    // Waiting too long for the concurrency lock means a burst of answers is starting.
    if (pgErrorCode(error) === LOCK_NOT_AVAILABLE) {
      throw new ApiError("SERVER_BUSY", "Beamling is busy right now. Try again in a minute.", 503);
    }
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

export interface AssistantOutcome {
  userId: string;
  messageId: string;
  content: string;
  status: "complete" | "stopped" | "error";
  sources?: Source[];
  usage?: Usage;
  uncited?: boolean;
  noSources?: boolean;
  truncated?: boolean;
  degraded?: boolean;
  searchFailures?: number;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Records the outcome of an answer. Returns false when the message no longer exists, e.g. its
 * conversation was deleted while the answer was being written.
 */
export async function completeAssistant(input: AssistantOutcome): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(messages)
      .set({
        content: storableText(input.content),
        status: input.status,
        noSources: input.noSources ?? false,
        uncited: input.uncited ?? false,
        truncated: input.truncated ?? false,
        degraded: input.degraded ?? false,
        searchRequests: input.usage?.searchRequests ?? 0,
        searchFailures: input.searchFailures ?? 0,
        tokensIn: input.usage?.tokensIn ?? null,
        tokensOut: input.usage?.tokensOut ?? null,
        costUsd: input.usage ? input.usage.costUsd.toFixed(6) : null,
        searchCostUsd: input.usage?.searchCostUsd != null ? input.usage.searchCostUsd.toFixed(6) : null,
        resolvedModel: input.usage?.resolvedModel ?? null,
        upstreamProvider: input.usage?.upstreamProvider ?? null,
        latencyMs: input.usage?.latencyMs ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      })
      .where(and(eq(messages.id, input.messageId), eq(messages.userId, input.userId)))
      .returning({ id: messages.id });
    // The update holds the row lock, so a concurrent delete cannot remove it before the sources land.
    if (!updated.length) return false;

    if (input.sources?.length) {
      await tx.delete(sources).where(eq(sources.messageId, input.messageId));
      await tx.insert(sources).values(
        input.sources.map((source) => ({
          messageId: input.messageId,
          position: source.position,
          url: storableText(source.url),
          title: storableText(source.title),
          domain: storableText(source.domain),
          snippet: storableText(source.snippet),
          publishedAt: parseDate(source.publishedAt),
        })),
      );
    }
    return true;
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

/**
 * True when the running answer should stop: the user asked for it from any instance, the message
 * was deleted with its conversation or account, or it is no longer streaming.
 */
export async function isStopRequested(messageId: string): Promise<boolean> {
  const [row] = await db
    .select({ stopRequested: messages.stopRequested, status: messages.status })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  return !row || row.stopRequested || row.status !== "streaming";
}

/** Marks answers abandoned by a crash or restart as interrupted. */
export async function interruptStaleAnswers(messageIds?: string[]): Promise<void> {
  await db
    .update(messages)
    .set(interruptedFields())
    .where(
      and(
        eq(messages.status, "streaming"),
        messageIds ? inArray(messages.id, messageIds) : lte(messages.createdAt, staleBefore()),
      ),
    );
}

import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";
import { DEFAULT_CONVERSATION_TITLE, titleFromQuestion } from "../../data";
import { DEFAULT_SEARCH_PROVIDER } from "../../provider-catalog";
import type { Message, Mode, SearchProvider, SearchTrace, Source, Usage } from "../../types";
import { plural } from "../../utils";
import { db } from "../db";
import { maxConcurrentChats, maxConcurrentChatsPerUser } from "../env";
import { ApiError, pgErrorCode, storableText } from "../http";
import { conversations, messages, sources } from "../schema";
import { decryptText, encryptText } from "../workspace-key";
import { interruptedFields, mapMessage, staleBefore, staleBeforeSql, type MessageRow } from "./shared";

const UNIQUE_VIOLATION = "23505";
const LOCK_NOT_AVAILABLE = "55P03";
const HISTORY_MESSAGES = 6;
// Serializes the global concurrency check across instances (transaction-scoped advisory lock).
const CHAT_SLOT_LOCK_ID = 7_314_002_918;

/** At most half of the global answer slots may run Deeper at once. */
function deeperSlots(): number {
  return Math.max(1, Math.floor(maxConcurrentChats() / 2));
}

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
  return Promise.all(rows.reverse().map((row) => mapMessage(userId, row, [])));
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
  const stale = target.status === "streaming" && target.createdAt.getTime() <= staleBefore().getTime();
  // A stale streaming row reads as interrupted, so it can be retried too.
  if (target.status !== "error" && target.status !== "stopped" && !stale) {
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
  return { target, question, questionText: await decryptText(input.userId, "messages", question.id, "content", question.content) };
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
  searchProvider?: SearchProvider;
  question?: string;
  retryOf?: string;
}): Promise<{ userMessage: MessageRow; assistantMessage: MessageRow; questionText: string }> {
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
            lte(messages.createdAt, staleBeforeSql()),
          ),
        );

      // Counted under the advisory lock, so concurrent exchanges see each other's committed rows.
      const [{ value: inFlight }] = await tx
        .select({ value: count() })
        .from(messages)
        .where(and(eq(messages.status, "streaming"), gt(messages.createdAt, staleBeforeSql())));
      if (inFlight >= maxConcurrentChats()) {
        throw new ApiError("SERVER_BUSY", "Beamling is busy right now. Try again in a minute.", 503);
      }

      // Deeper answers run for minutes; capping their share keeps a few accounts from holding every slot.
      if (input.mode === "deeper") {
        const [{ value: deeperInFlight }] = await tx
          .select({ value: count() })
          .from(messages)
          .where(
            and(eq(messages.status, "streaming"), eq(messages.mode, "deeper"), gt(messages.createdAt, staleBeforeSql())),
          );
        if (deeperInFlight >= deeperSlots()) {
          throw new ApiError("SERVER_BUSY", "Deeper answers are busy right now. Try Deep, or try again in a minute.", 503);
        }
      }

      const [{ value: userInFlight }] = await tx
        .select({ value: count() })
        .from(messages)
        .where(
          and(
            eq(messages.userId, input.userId),
            eq(messages.status, "streaming"),
            gt(messages.createdAt, staleBeforeSql()),
          ),
        );
      const perUserLimit = maxConcurrentChatsPerUser();
      if (userInFlight >= perUserLimit) {
        throw new ApiError(
          "SERVER_BUSY",
          `You already have ${plural(perUserLimit, "answer")} running. Wait for one to finish or stop it.`,
          503,
        );
      }

      const now = new Date();
      let userMessage: MessageRow;
      let questionText: string;
      if (input.retryOf) {
        const { target, question, questionText: storedQuestion } = await retryTarget(tx, {
          userId: input.userId,
          conversationId: conversation.id,
          messageId: input.retryOf,
        });
        await tx.delete(messages).where(eq(messages.id, target.id));
        userMessage = question;
        questionText = storedQuestion;
      } else {
        questionText = storableText(input.question ?? "");
        const id = randomUUID();
        [userMessage] = await tx
          .insert(messages)
          .values({
            id,
            conversationId: conversation.id,
            userId: input.userId,
            role: "user",
            content: await encryptText(input.userId, "messages", id, "content", questionText),
            status: "complete",
            mode: input.mode,
            createdAt: now,
          })
          .returning();
      }

      const assistantId = randomUUID();
      const [assistantMessage] = await tx
        .insert(messages)
        .values({
          id: assistantId,
          conversationId: conversation.id,
          userId: input.userId,
          role: "assistant",
          content: await encryptText(input.userId, "messages", assistantId, "content", ""),
          status: "streaming",
          mode: input.mode,
          llmModel: input.llmModel,
          searchProvider: input.searchProvider ?? DEFAULT_SEARCH_PROVIDER,
          // Strictly after the question, so the thread order never depends on the clock's resolution.
          createdAt: new Date(Math.max(now.getTime(), userMessage.createdAt.getTime()) + 1),
        })
        .returning();

      const currentTitle = await decryptText(input.userId, "conversations", conversation.id, "title", conversation.title);
      const nextTitle =
        currentTitle === DEFAULT_CONVERSATION_TITLE ? titleFromQuestion(questionText) : currentTitle;
      await tx
        .update(conversations)
        .set({
          title: nextTitle === currentTitle
            ? conversation.title
            : await encryptText(input.userId, "conversations", conversation.id, "title", nextTitle),
          mode: input.mode,
          updatedAt: now,
        })
        .where(eq(conversations.id, conversation.id));

      return { userMessage, assistantMessage, questionText };
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
  searches?: SearchTrace[];
  reasoning?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Records the outcome of an answer. Returns false when the message no longer exists, e.g. its
 * conversation was deleted while the answer was being written.
 */
export async function completeAssistant(input: AssistantOutcome): Promise<boolean> {
  const content = await encryptText(
    input.userId,
    "messages",
    input.messageId,
    "content",
    storableText(input.content),
  );
  const errorMessage = input.errorMessage
    ? await encryptText(input.userId, "messages", input.messageId, "error_message", storableText(input.errorMessage))
    : null;
  const searches = input.searches?.length
    ? await encryptText(input.userId, "messages", input.messageId, "searches", JSON.stringify(input.searches))
    : null;
  const reasoning = input.reasoning
    ? await encryptText(input.userId, "messages", input.messageId, "reasoning", storableText(input.reasoning))
    : null;
  const encryptedSources = await Promise.all(
    (input.sources ?? []).map(async (source) => {
      const id = randomUUID();
      return {
        id,
        messageId: input.messageId,
        position: source.position,
        url: await encryptText(input.userId, "sources", id, "url", storableText(source.url)),
        title: source.title ? await encryptText(input.userId, "sources", id, "title", storableText(source.title)) : null,
        domain: source.domain ? await encryptText(input.userId, "sources", id, "domain", storableText(source.domain)) : null,
        snippet: source.snippet ? await encryptText(input.userId, "sources", id, "snippet", storableText(source.snippet)) : null,
        publishedAt: parseDate(source.publishedAt),
      };
    }),
  );
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(messages)
      .set({
        content,
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
        errorMessage,
        searches,
        reasoning,
      })
      .where(
        and(
          eq(messages.id, input.messageId),
          eq(messages.userId, input.userId),
          // A reaper or shutdown may already have marked this run interrupted. First writer wins.
          eq(messages.status, "streaming"),
        ),
      )
      .returning({ id: messages.id });
    // The update holds the row lock, so a concurrent delete cannot remove it before the sources land.
    if (!updated.length) return false;

    if (encryptedSources.length) {
      await tx.delete(sources).where(eq(sources.messageId, input.messageId));
      await tx.insert(sources).values(encryptedSources);
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
        messageIds ? inArray(messages.id, messageIds) : lte(messages.createdAt, staleBeforeSql()),
      ),
    );
}

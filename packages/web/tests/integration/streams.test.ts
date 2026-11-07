import assert from "node:assert/strict";
import { test } from "node:test";
import { withEnv } from "../helpers";
import { closePoolAfterTests, configureIntegrationEnv, skip, OTHER_USER_ID, type ChatEvents, createAccount, eventData, storedAnswer } from "./helpers";

configureIntegrationEnv();
closePoolAfterTests();

test("a conversation accepts only one streaming answer at a time", { skip }, async (t) => {
  const { createConversation, createExchange } = await import("../../lib/server/repo");
  const { ApiError } = await import("../../lib/server/http");
  const userId = await createAccount(t);
  const conversation = await createConversation(userId, "quick");
  const exchange = { userId, conversationId: conversation.id, question: "First", mode: "quick" as const, llmModel: "m" };

  await createExchange(exchange);
  await assert.rejects(
    createExchange({ ...exchange, question: "Second" }),
    (error) => error instanceof ApiError && error.code === "GENERATION_IN_PROGRESS",
  );
});

test("the global concurrency cap holds under concurrent requests", { skip }, async (t) => {
  const { createConversation, createExchange } = await import("../../lib/server/repo");
  const { ApiError } = await import("../../lib/server/http");
  const { db } = await import("../../lib/server/db");
  const { sql } = await import("drizzle-orm");
  // Answers left in flight by other suites sharing this database count towards the cap too.
  const { rows } = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from messages where status = 'streaming' and created_at > now() - interval '3 minutes'`,
  );
  withEnv(t, { MAX_CONCURRENT_CHATS: String(rows[0].n + 1) });
  const userId = await createAccount(t);
  const conversations = await Promise.all(Array.from({ length: 8 }, () => createConversation(userId, "quick")));

  const results = await Promise.allSettled(
    conversations.map((conversation) =>
      createExchange({ userId, conversationId: conversation.id, question: "Go", mode: "quick", llmModel: "m" }),
    ),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of results) {
    if (result.status === "rejected") assert.ok(result.reason instanceof ApiError && result.reason.code === "SERVER_BUSY");
  }
});

test("waiting too long for the concurrency lock reads as busy, not as a crash", { skip }, async (t) => {
  const { createConversation, createExchange } = await import("../../lib/server/repo");
  const { ApiError } = await import("../../lib/server/http");
  const { pool } = await import("../../lib/server/db");
  const userId = await createAccount(t);
  const conversation = await createConversation(userId, "quick");
  const holder = await pool.connect();
  try {
    await holder.query("begin");
    await holder.query("select pg_advisory_xact_lock(7314002918)");
    await assert.rejects(
      createExchange({ userId, conversationId: conversation.id, question: "Q", mode: "quick", llmModel: "m" }),
      (error) => error instanceof ApiError && error.code === "SERVER_BUSY" && error.status === 503,
    );
  } finally {
    await holder.query("rollback");
    holder.release();
  }
});

test("a stop request reaches the answer through the database", { skip }, async (t) => {
  const { createConversation, createExchange, isStopRequested, requestStop } = await import("../../lib/server/repo");
  const userId = await createAccount(t);
  const conversation = await createConversation(userId, "quick");
  const { assistantMessage } = await createExchange({
    userId,
    conversationId: conversation.id,
    question: "Stop me",
    mode: "quick",
    llmModel: "m",
  });

  assert.equal(await requestStop(OTHER_USER_ID, assistantMessage.id), false);
  assert.equal(await isStopRequested(assistantMessage.id), false);
  assert.equal(await requestStop(userId, assistantMessage.id), true);
  assert.equal(await isStopRequested(assistantMessage.id), true);
});

test("deleting a conversation mid-answer stops it without a database error", { skip }, async (t) => {
  const { abortChats, watchChat } = await import("../../lib/server/active-chats");
  const { prepareChat, runChat } = await import("../../lib/server/answer-pipeline");
  const { completeAssistant, deleteConversation, isStopRequested } = await import("../../lib/server/repo");
  withEnv(t, { BEAMLING_FAKE_DELAY_MS: "30" });
  const userId = await createAccount(t);
  const prepared = await prepareChat({ userId, question: "Long answer", mode: "quick" });

  const controller = new AbortController();
  const events: ChatEvents = [];
  let markDone!: () => void;
  const unwatch = watchChat(
    prepared.messageId,
    { userId, conversationId: prepared.conversationId },
    controller,
    new Promise<void>((resolve) => {
      markDone = resolve;
    }),
  );
  const run = runChat(prepared, { signal: controller.signal, emit: (name, data) => events.push({ name, data }) }).finally(
    () => {
      unwatch();
      markDone();
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(await deleteConversation(userId, prepared.conversationId), true);
  abortChats({ userId, conversationId: prepared.conversationId });
  await run; // resolves: the outcome of a deleted message is simply not stored
  assert.equal(eventData<{ stage: string }>(events.filter((e) => e.name === "stage").reverse(), "stage").stage, "stopped");

  // Another instance learns about the deletion from the stop-flag poll.
  assert.equal(await isStopRequested(prepared.messageId), true);
  // Storing an outcome for a deleted message is a no-op, even with sources.
  const stored = await completeAssistant({
    userId,
    messageId: prepared.messageId,
    content: "late",
    status: "complete",
    sources: [{ id: "s", position: 1, url: "https://example.org", title: "t", domain: "example.org", snippet: "s" }],
  });
  assert.equal(stored, false);
});

test("an answer abandoned by a crashed instance reads as interrupted", { skip }, async (t) => {
  const { db } = await import("../../lib/server/db");
  const { messages } = await import("../../lib/server/schema");
  const { createConversation, createExchange } = await import("../../lib/server/repo");
  const { eq } = await import("drizzle-orm");
  const userId = await createAccount(t);
  const conversation = await createConversation(userId, "quick");
  const { assistantMessage } = await createExchange({ userId, conversationId: conversation.id, question: "Q", mode: "quick", llmModel: "m" });
  // Deeper has a six-minute route limit, so a five-minute answer is still healthy.
  await db
    .update(messages)
    .set({ createdAt: new Date(Date.now() - 5 * 60_000) })
    .where(eq(messages.id, assistantMessage.id));
  const running = await storedAnswer(userId, conversation.id);
  assert.equal(running.answer?.status, "streaming");

  await db
    .update(messages)
    .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
    .where(eq(messages.id, assistantMessage.id));

  const { answer } = await storedAnswer(userId, conversation.id);
  assert.equal(answer?.status, "error");
  assert.equal(answer?.errorCode, "INTERRUPTED");
});

test("one account cannot exceed its per-user in-flight cap", { skip }, async (t) => {
  const { createConversation, createExchange } = await import("../../lib/server/repo");
  withEnv(t, { MAX_CONCURRENT_CHATS_PER_USER: "2", MAX_CONCURRENT_CHATS: "50" });
  const userId = await createAccount(t, { keys: false });
  const conversations = await Promise.all([
    createConversation(userId, "quick"),
    createConversation(userId, "quick"),
    createConversation(userId, "quick"),
  ]);
  await createExchange({ userId, conversationId: conversations[0].id, question: "one", mode: "quick", llmModel: "m" });
  await createExchange({ userId, conversationId: conversations[1].id, question: "two", mode: "quick", llmModel: "m" });
  await assert.rejects(
    () => createExchange({ userId, conversationId: conversations[2].id, question: "three", mode: "quick", llmModel: "m" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "SERVER_BUSY",
  );
});

test("a failed first question keeps a client-created conversation for retry, then cleanup removes it", { skip }, async (t) => {
  const { prepareChat } = await import("../../lib/server/answer-pipeline");
  const { cleanupEmptyConversations, conversationExists, createConversation } = await import("../../lib/server/repo");
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../../lib/server/db");
  const { conversations } = await import("../../lib/server/schema");
  const userId = await createAccount(t, { keys: false });
  const conversation = await createConversation(userId, "quick");
  await assert.rejects(
    () => prepareChat({ userId, conversationId: conversation.id, question: "No keys", mode: "quick" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CREDENTIAL_MISSING",
  );
  assert.equal(await conversationExists(userId, conversation.id), true, "the client can retry");
  await db
    .update(conversations)
    .set({ updatedAt: new Date(Date.now() - 2 * 60 * 60_000) })
    .where(eq(conversations.id, conversation.id));
  await cleanupEmptyConversations();
  assert.equal(await conversationExists(userId, conversation.id), false);
});

test("a late completion cannot overwrite an interrupted outcome", { skip }, async (t) => {
  const { completeAssistant, createConversation, createExchange, getConversation, interruptStaleAnswers } = await import(
    "../../lib/server/repo"
  );
  const userId = await createAccount(t, { keys: false });
  const conversation = await createConversation(userId, "quick");
  const exchange = await createExchange({
    userId,
    conversationId: conversation.id,
    question: "Interrupt me",
    mode: "quick",
    llmModel: "m",
  });
  await interruptStaleAnswers([exchange.assistantMessage.id]);
  const stored = await completeAssistant({
    userId,
    messageId: exchange.assistantMessage.id,
    content: "late",
    status: "complete",
  });
  assert.equal(stored, false);
  const after = await getConversation(userId, conversation.id);
  assert.equal(after?.messages.at(-1)?.status, "error");
  assert.equal(after?.messages.at(-1)?.errorCode, "INTERRUPTED");
});


test("the new-stream flag defaults open and can be blocked explicitly", { skip }, async (t) => {
  const { ACCEPTING_NEW_STREAMS, acceptingNewStreams, setAcceptingNewStreams } = await import("../../lib/server/repo");
  const { db } = await import("../../lib/server/db");
  const { systemFlags } = await import("../../lib/server/schema");
  const { eq } = await import("drizzle-orm");
  t.after(() => db.delete(systemFlags).where(eq(systemFlags.key, ACCEPTING_NEW_STREAMS)));

  await db.delete(systemFlags).where(eq(systemFlags.key, ACCEPTING_NEW_STREAMS));
  assert.equal((await acceptingNewStreams()).enabled, true);
  t.after(() => setAcceptingNewStreams(true));

  const blocked = await setAcceptingNewStreams(false, "maintenance test");
  assert.equal(blocked.enabled, false);
  assert.equal(blocked.reason, "maintenance test");
  assert.equal((await acceptingNewStreams()).enabled, false);

  const reopened = await setAcceptingNewStreams(true);
  assert.equal(reopened.enabled, true);
  assert.equal(reopened.reason, null);
});

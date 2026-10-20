import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";

process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");
process.env.BEAMLING_FAKE_PROVIDERS = "1";
process.env.BEAMLING_FAKE_DELAY_MS = "1";
process.env.BRAVE_MIN_INTERVAL_MS = "0";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const skip = hasDatabase ? undefined : "DATABASE_URL is required for integration tests";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000000";

type ChatEvents = { name: string; data: unknown }[];

function withEnv(t: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function saveKey(userId: string, kind: "llm" | "search", provider: string, plaintext: string) {
  const { encryptCredential } = await import("../lib/server/crypto");
  const { saveCredential } = await import("../lib/server/repo");
  return saveCredential({ userId, kind, provider, encrypted: encryptCredential(userId, kind, provider, plaintext), status: "active" });
}

/** Creates a guest with fixture keys and deletes it when the test ends. */
async function createGuest(t: TestContext, options: { keys?: boolean } = {}): Promise<string> {
  const { db } = await import("../lib/server/db");
  const { users } = await import("../lib/server/schema");
  const { deleteAccount, ensureSettings } = await import("../lib/server/repo");
  const [user] = await db.insert(users).values({ isGuest: true }).returning();
  t.after(() => deleteAccount(user.id));
  await ensureSettings(user.id);
  if (options.keys !== false) {
    await saveKey(user.id, "llm", "openrouter", "test-openrouter");
    await saveKey(user.id, "search", "brave", "test-brave");
  }
  return user.id;
}

async function ask(
  userId: string,
  input: { question?: string; retryOf?: string; conversationId?: string; mode: "quick" | "deep" },
  signal = new AbortController().signal,
) {
  const { prepareChat, runChat } = await import("../lib/server/chat");
  const events: ChatEvents = [];
  const prepared = await prepareChat({ userId, ...input });
  await runChat(prepared, { signal, emit: (name, data) => events.push({ name, data }) });
  return { events, prepared };
}

function eventData<T>(events: ChatEvents, name: string): T {
  return events.find((event) => event.name === name)?.data as T;
}

async function storedAnswer(userId: string, conversationId: string) {
  const { getConversation } = await import("../lib/server/repo");
  const conversation = await getConversation(userId, conversationId);
  assert.ok(conversation);
  return { conversation, answer: conversation.messages.findLast((message) => message.role === "assistant") };
}

test("guest chat persists a cited Quick answer with its cost breakdown", { skip }, async (t) => {
  const userId = await createGuest(t);
  const { events, prepared } = await ask(userId, { question: "What is Beamling?", mode: "quick" });

  const names = events.map((event) => event.name);
  assert.ok(names.indexOf("meta") < names.indexOf("sources"));
  assert.ok(names.indexOf("sources") < names.indexOf("delta"));
  assert.equal(names.at(-1), "done");
  const meta = eventData<{ conversationId: string; messageId: string; userMessageId: string }>(events, "meta");
  assert.equal(meta.userMessageId, prepared.userMessageId);
  const sources = eventData<unknown[]>(events, "sources");
  assert.ok(sources.length >= 3);
  const usage = eventData<{ costUsd: number; searchCostUsd: number; searchRequests: number; resolvedModel: string }>(
    events,
    "usage",
  );
  assert.equal(usage.searchRequests, 1);
  assert.equal(usage.searchCostUsd, 0.005);
  assert.ok(usage.costUsd > 0 && usage.costUsd < 0.005, "generation cost is reported separately");
  assert.equal(usage.resolvedModel, "deepseek/deepseek-v4.1-flash");

  const { conversation, answer } = await storedAnswer(userId, meta.conversationId);
  assert.equal(conversation.title, "What is Beamling?");
  assert.equal(answer?.status, "complete");
  assert.match(answer?.content ?? "", /\[1\]/);
  assert.equal(answer?.sources?.length, sources.length);
  assert.equal(answer?.usage?.searchCostUsd, 0.005);
  assert.equal(answer?.usage?.upstreamProvider, "fixture");
});

test("Deep mode plans sub-queries and emits progress", { skip }, async (t) => {
  const userId = await createGuest(t);
  const { events } = await ask(userId, { question: "Compare the evidence", mode: "deep" });

  assert.equal(eventData<{ queries: string[] }>(events, "plan").queries.length, 3);
  assert.equal(events.filter((event) => event.name === "progress").length, 3);
  assert.equal(events.at(-1)?.name, "done");
  assert.equal(eventData<{ degraded: boolean }>(events, "done").degraded, false);
});

test("an invalid plan is repaired once, then the run degrades instead of failing", { skip }, async (t) => {
  const userId = await createGuest(t);
  const repaired = await ask(userId, { question: "Plan this [fixture:bad-plan]", mode: "deep" });
  assert.equal(eventData<{ queries: string[] }>(repaired.events, "plan").queries.length, 3);
  assert.equal(eventData<{ degraded: boolean }>(repaired.events, "done").degraded, false);

  const degraded = await ask(userId, { question: "Plan this [fixture:broken-plan]", mode: "deep" });
  assert.deepEqual(eventData<{ queries: string[] }>(degraded.events, "plan").queries, ["Plan this [fixture:broken-plan]"]);
  assert.equal(eventData<{ degraded: boolean }>(degraded.events, "done").degraded, true);
  const { answer } = await storedAnswer(userId, degraded.prepared.conversationId);
  assert.equal(answer?.degraded, true);
  assert.equal(answer?.status, "complete");
});

test("a failed sub-query is reported as a partial search", { skip }, async (t) => {
  const userId = await createGuest(t);
  const { events, prepared } = await ask(userId, { question: "Partial [fixture:partial-search]", mode: "deep" });
  assert.equal(eventData<{ searchFailures: number }>(events, "done").searchFailures, 1);
  const { answer } = await storedAnswer(userId, prepared.conversationId);
  assert.equal(answer?.status, "complete");
  assert.equal(answer?.searchFailures, 1);
  assert.equal(answer?.usage?.searchRequests, 2);
});

test("missing keys use the stable CREDENTIAL_MISSING code", { skip }, async (t) => {
  const { ApiError } = await import("../lib/server/http");
  const userId = await createGuest(t, { keys: false });
  await assert.rejects(
    ask(userId, { question: "Hi", mode: "quick" }),
    (error) => error instanceof ApiError && error.code === "CREDENTIAL_MISSING" && error.provider === "openrouter",
  );
});

test("a conversation accepts only one streaming answer at a time", { skip }, async (t) => {
  const { createConversation, createExchange } = await import("../lib/server/repo");
  const { ApiError } = await import("../lib/server/http");
  const userId = await createGuest(t);
  const conversation = await createConversation(userId, "quick");
  const exchange = { userId, conversationId: conversation.id, question: "First", mode: "quick" as const, llmModel: "m" };

  await createExchange(exchange);
  await assert.rejects(
    createExchange({ ...exchange, question: "Second" }),
    (error) => error instanceof ApiError && error.code === "GENERATION_IN_PROGRESS",
  );
});

test("the global concurrency cap holds under concurrent requests", { skip }, async (t) => {
  const { createConversation, createExchange } = await import("../lib/server/repo");
  const { ApiError } = await import("../lib/server/http");
  const { db } = await import("../lib/server/db");
  const { sql } = await import("drizzle-orm");
  // Answers left in flight by other suites sharing this database count towards the cap too.
  const { rows } = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from messages where status = 'streaming' and created_at > now() - interval '3 minutes'`,
  );
  withEnv(t, { MAX_CONCURRENT_CHATS: String(rows[0].n + 1) });
  const userId = await createGuest(t);
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
  const { createConversation, createExchange } = await import("../lib/server/repo");
  const { ApiError } = await import("../lib/server/http");
  const { pool } = await import("../lib/server/db");
  const userId = await createGuest(t);
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
  const { createConversation, createExchange, isStopRequested, requestStop } = await import("../lib/server/repo");
  const userId = await createGuest(t);
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
  const { abortChats, watchChat } = await import("../lib/server/active-chats");
  const { prepareChat, runChat } = await import("../lib/server/chat");
  const { completeAssistant, deleteConversation, isStopRequested } = await import("../lib/server/repo");
  withEnv(t, { BEAMLING_FAKE_DELAY_MS: "30" });
  const userId = await createGuest(t);
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

test("the time limit keeps partial text and records GENERATION_TIMEOUT", { skip }, async (t) => {
  withEnv(t, { BEAMLING_FAKE_DELAY_MS: "40" });
  const userId = await createGuest(t);
  const { events, prepared } = await ask(userId, { question: "Slow", mode: "quick" }, AbortSignal.timeout(400));
  assert.equal(events.at(-1)?.name, "stage");
  const { answer } = await storedAnswer(userId, prepared.conversationId);
  assert.equal(answer?.status, "stopped");
  assert.equal(answer?.errorCode, "GENERATION_TIMEOUT");
});

test("NUL characters never reach Postgres", { skip }, async (t) => {
  const { createConversation, createExchange } = await import("../lib/server/repo");
  const userId = await createGuest(t);
  const conversation = await createConversation(userId, "quick");
  const { userMessage } = await createExchange({
    userId,
    conversationId: conversation.id,
    question: "a\u0000b",
    mode: "quick",
    llmModel: "m",
  });
  assert.equal(userMessage.content, "ab");
});

test("retrying a failed answer replaces it and reuses the question", { skip }, async (t) => {
  const { completeAssistant, createConversation, createExchange, getConversation } = await import("../lib/server/repo");
  const { ApiError } = await import("../lib/server/http");
  const userId = await createGuest(t);
  const conversation = await createConversation(userId, "quick");
  const first = await createExchange({ userId, conversationId: conversation.id, question: "Retry me", mode: "quick", llmModel: "m" });
  await completeAssistant({ userId, messageId: first.assistantMessage.id, content: "", status: "error", errorCode: "PROVIDER_UNAVAILABLE" });

  const { events, prepared } = await ask(userId, { conversationId: conversation.id, retryOf: first.assistantMessage.id, mode: "quick" });
  assert.equal(events.at(-1)?.name, "done");
  assert.equal(prepared.question, "Retry me");
  assert.equal(prepared.userMessageId, first.userMessage.id);
  assert.deepEqual(prepared.history, [], "the retried question is not repeated in the history");

  const stored = await getConversation(userId, conversation.id);
  assert.deepEqual(
    stored?.messages.map((message) => [message.role, message.status]),
    [
      ["user", "complete"],
      ["assistant", "complete"],
    ],
  );
  // Only a failed or stopped latest answer can be retried.
  const latest = stored?.messages[1].id as string;
  await assert.rejects(
    ask(userId, { conversationId: conversation.id, retryOf: latest, mode: "quick" }),
    (error) => error instanceof ApiError && error.code === "RETRY_NOT_ALLOWED",
  );
  await assert.rejects(
    ask(userId, { conversationId: conversation.id, retryOf: first.assistantMessage.id, mode: "quick" }),
    (error) => error instanceof ApiError && error.code === "MESSAGE_NOT_FOUND",
  );
});

test("an answer abandoned by a crashed instance reads as interrupted", { skip }, async (t) => {
  const { db } = await import("../lib/server/db");
  const { messages } = await import("../lib/server/schema");
  const { createConversation, createExchange } = await import("../lib/server/repo");
  const { eq } = await import("drizzle-orm");
  const userId = await createGuest(t);
  const conversation = await createConversation(userId, "quick");
  const { assistantMessage } = await createExchange({ userId, conversationId: conversation.id, question: "Q", mode: "quick", llmModel: "m" });
  await db
    .update(messages)
    .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
    .where(eq(messages.id, assistantMessage.id));

  const { answer } = await storedAnswer(userId, conversation.id);
  assert.equal(answer?.status, "error");
  assert.equal(answer?.errorCode, "INTERRUPTED");
});

test("conversations and messages are paginated", { skip }, async (t) => {
  const { db } = await import("../lib/server/db");
  const { conversations, messages } = await import("../lib/server/schema");
  const { getConversation, getEarlierMessages, getState, listConversationPage } = await import("../lib/server/repo");
  const { CONVERSATION_PAGE_SIZE, MESSAGE_PAGE_SIZE } = await import("../lib/data");
  const userId = await createGuest(t);

  // Same updated_at for many rows, to exercise the id tiebreaker in the cursor.
  const base = Date.now();
  const rows = await db
    .insert(conversations)
    .values(Array.from({ length: CONVERSATION_PAGE_SIZE + 5 }, (_, i) => ({ userId, title: `C${i}`, updatedAt: new Date(base - Math.floor(i / 3) * 1000) })))
    .returning();
  const first = await listConversationPage(userId);
  assert.equal(first.conversations.length, CONVERSATION_PAGE_SIZE);
  assert.ok(first.nextCursor);
  const second = await listConversationPage(userId, first.nextCursor);
  assert.equal(second.conversations.length, 5);
  assert.equal(second.nextCursor, null);
  const ids = [...first.conversations, ...second.conversations].map((item) => item.id);
  assert.equal(new Set(ids).size, rows.length, "no conversation is skipped or repeated");

  const state = await getState({ id: userId, isGuest: true, createdAt: new Date() });
  assert.equal(state.conversations.length, CONVERSATION_PAGE_SIZE);
  assert.equal(state.conversationCount, rows.length);
  assert.equal("messages" in state.conversations[0], false, "the list carries no messages");

  const conversationId = rows[0].id;
  const total = MESSAGE_PAGE_SIZE + 5;
  await db.insert(messages).values(
    Array.from({ length: total }, (_, i) => ({
      conversationId,
      userId,
      role: i % 2 ? "assistant" : "user",
      content: `M${i}`,
      createdAt: new Date(base + i),
    })),
  );
  const conversation = await getConversation(userId, conversationId);
  assert.equal(conversation?.messages.length, MESSAGE_PAGE_SIZE);
  assert.equal(conversation?.hasMoreMessages, true);
  assert.equal(conversation?.messages.at(-1)?.content, `M${total - 1}`);
  const earlier = await getEarlierMessages(userId, conversationId, conversation?.messages[0].id as string);
  assert.equal(earlier?.messages.length, 5);
  assert.equal(earlier?.hasMore, false);
  const all = [...(earlier?.messages ?? []), ...(conversation?.messages ?? [])].map((message) => message.content);
  assert.deepEqual(all, Array.from({ length: total }, (_, i) => `M${i}`));
  assert.equal(await getEarlierMessages(OTHER_USER_ID, conversationId, conversation?.messages[0].id as string), null);
});

test("cleanup deletes guest workspaces that no session can reach", { skip }, async (t) => {
  const { db } = await import("../lib/server/db");
  const { authSessions, users } = await import("../lib/server/schema");
  const { cleanupExpired } = await import("../lib/server/repo");
  const { inArray } = await import("drizzle-orm");
  const old = new Date(Date.now() - 2 * 3600_000);
  const [orphan, expired, active, fresh] = await db
    .insert(users)
    .values([{ createdAt: old }, { createdAt: old }, { createdAt: old }, {}])
    .returning();
  t.after(() => db.delete(users).where(inArray(users.id, [orphan.id, expired.id, active.id, fresh.id])));
  await db.insert(authSessions).values([
    { userId: expired.id, tokenHash: randomBytes(16).toString("hex"), expiresAt: new Date(Date.now() - 1000) },
    { userId: active.id, tokenHash: randomBytes(16).toString("hex"), expiresAt: new Date(Date.now() + 3600_000) },
  ]);

  await cleanupExpired();
  const remaining = new Set(
    (await db.select({ id: users.id }).from(users).where(inArray(users.id, [orphan.id, expired.id, active.id, fresh.id]))).map(
      (row) => row.id,
    ),
  );
  assert.equal(remaining.has(orphan.id), false);
  assert.equal(remaining.has(expired.id), false);
  assert.equal(remaining.has(active.id), true);
  assert.equal(remaining.has(fresh.id), true, "a workspace being created right now is kept");
});

test("concurrent requests cannot exceed the rate limit", { skip }, async () => {
  const { consumeRateLimit } = await import("../lib/server/repo");
  const key = `test:${randomBytes(8).toString("hex")}`;
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => consumeRateLimit(key, 3, 60)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
});

test("Brave requests for one key are spaced across instances", { skip }, async (t) => {
  const { reserveProviderSlot } = await import("../lib/server/repo");
  const key = `test:${randomBytes(8).toString("hex")}`;
  const waits = await Promise.all(Array.from({ length: 3 }, () => reserveProviderSlot(key, 200)));
  assert.deepEqual(
    waits.map((wait) => Math.round(wait / 100)).sort(),
    [0, 2, 4],
    "each reservation gets its own 200 ms slot",
  );

  const { searchBrave } = await import("../lib/server/providers/brave");
  withEnv(t, { BRAVE_MIN_INTERVAL_MS: "120" });
  const original = globalThis.fetch;
  const startedAt: number[] = [];
  globalThis.fetch = (async () => {
    startedAt.push(Date.now());
    return new Response(JSON.stringify({ web: { results: [{ title: "t", url: "https://example.org/r", description: "s" }] } }));
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const apiKey = `BSA-${randomBytes(6).toString("hex")}`;
  await Promise.all([searchBrave(apiKey, "one", { count: 1 }), searchBrave(apiKey, "two", { count: 1 })]);
  startedAt.sort();
  assert.ok(startedAt[1] - startedAt[0] >= 100, `requests were ${startedAt[1] - startedAt[0]} ms apart`);
});

test("replacing a key keeps it decryptable", { skip }, async (t) => {
  const { decryptCredential } = await import("../lib/server/crypto");
  const { getCredentialRow } = await import("../lib/server/repo");
  const userId = await createGuest(t);

  await Promise.all([
    saveKey(userId, "llm", "openrouter", "test-replacement-a"),
    saveKey(userId, "llm", "openrouter", "test-replacement-b"),
  ]);
  const row = await getCredentialRow(userId, "llm", "openrouter");
  assert.ok(row);
  assert.match(decryptCredential(userId, row), /^test-replacement-[ab]$/);
});

test.after(async () => {
  if (!hasDatabase) return;
  const { pool } = await import("../lib/server/db");
  await pool.end();
});

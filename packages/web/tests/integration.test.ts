import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";

process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");
process.env.BEAMLING_FAKE_PROVIDERS = "1";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const skip = hasDatabase ? undefined : "DATABASE_URL is required for integration tests";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000000";

async function saveKey(userId: string, kind: "llm" | "search", provider: string, plaintext: string) {
  const { encryptCredential } = await import("../lib/server/crypto");
  const { saveCredential } = await import("../lib/server/repo");
  const encrypted = encryptCredential(userId, kind, provider, plaintext);
  const { id, ...fields } = encrypted;
  return saveCredential({ userId, id, kind, provider, encrypted: fields, status: "active" });
}

/** Creates a guest with fixture keys and deletes it when the test ends. */
async function createGuest(t: TestContext): Promise<string> {
  const { db } = await import("../lib/server/db");
  const { users } = await import("../lib/server/schema");
  const { deleteAccount, ensureSettings } = await import("../lib/server/repo");
  const [user] = await db.insert(users).values({ isGuest: true }).returning();
  t.after(() => deleteAccount(user.id));
  await ensureSettings(user.id);
  await saveKey(user.id, "llm", "openrouter", "test-openrouter");
  await saveKey(user.id, "search", "brave", "test-brave");
  return user.id;
}

async function ask(userId: string, question: string, mode: "quick" | "deep") {
  const { prepareChat, runChat } = await import("../lib/server/chat");
  const events: { name: string; data: unknown }[] = [];
  const prepared = await prepareChat({ userId, question, mode });
  await runChat(prepared, {
    signal: new AbortController().signal,
    emit: (name, data) => events.push({ name, data }),
  });
  return events;
}

test("guest chat persists a cited Quick answer", { skip }, async (t) => {
  const { getConversation } = await import("../lib/server/repo");
  const userId = await createGuest(t);
  const events = await ask(userId, "What is Beamling?", "quick");

  const meta = events.find((event) => event.name === "meta")?.data as { conversationId: string };
  assert.ok(meta.conversationId);
  const names = events.map((event) => event.name);
  assert.ok(names.indexOf("meta") < names.indexOf("sources"));
  assert.ok(names.indexOf("sources") < names.indexOf("delta"));
  assert.equal(names.at(-1), "done");
  const sources = events.find((event) => event.name === "sources")?.data as unknown[];
  assert.ok(sources.length >= 3);
  const usage = events.find((event) => event.name === "usage")?.data as { costUsd: number };
  assert.ok(usage.costUsd >= 0.005);

  const conversation = await getConversation(userId, meta.conversationId);
  assert.ok(conversation);
  const assistant = conversation.messages.find((message) => message.role === "assistant");
  assert.equal(assistant?.status, "complete");
  assert.match(assistant?.content ?? "", /\[1\]/);
  assert.equal(assistant?.sources?.length, sources.length);
});

test("Deep mode plans sub-queries and emits progress", { skip }, async (t) => {
  const userId = await createGuest(t);
  const events = await ask(userId, "Compare the evidence", "deep");

  const plan = events.find((event) => event.name === "plan")?.data as { queries: string[] };
  assert.equal(plan.queries.length, 3);
  const progress = events.filter((event) => event.name === "progress");
  assert.equal(progress.length, 3);
  assert.equal(events.at(-1)?.name, "done");
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

test("concurrent requests cannot exceed the rate limit", { skip }, async () => {
  const { consumeRateLimit } = await import("../lib/server/repo");
  const key = `test:${randomBytes(8).toString("hex")}`;
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => consumeRateLimit(key, 3, 60)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
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

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");
process.env.BEAMLING_FAKE_PROVIDERS = "1";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const skip = hasDatabase ? undefined : "DATABASE_URL is required for integration tests";

test("guest chat persists a cited Quick answer", { skip }, async (t) => {
  const { db } = await import("../lib/server/db");
  const { users } = await import("../lib/server/schema");
  const { encryptCredential } = await import("../lib/server/crypto");
  const { ensureSettings, saveCredential, deleteAccount, getConversation } = await import("../lib/server/repo");
  const { runChat } = await import("../lib/server/chat");

  const [user] = await db.insert(users).values({ isGuest: true }).returning();
  t.after(async () => {
    await deleteAccount(user.id);
  });
  await ensureSettings(user.id);
  for (const [kind, provider, plaintext] of [
    ["llm", "openrouter", "test-openrouter"],
    ["search", "brave", "test-brave"],
  ] as const) {
    const encrypted = encryptCredential(user.id, kind, provider, plaintext);
    await saveCredential({
      userId: user.id,
      id: encrypted.id,
      kind,
      provider,
      encrypted: {
        wrappedDek: encrypted.wrappedDek,
        dekNonce: encrypted.dekNonce,
        dekTag: encrypted.dekTag,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        tag: encrypted.tag,
        fingerprint: encrypted.fingerprint,
        last4: encrypted.last4,
      },
      status: "active",
    });
  }

  const events: { name: string; data: unknown }[] = [];
  await runChat({
    userId: user.id,
    question: "What is Beamling?",
    mode: "quick",
    signal: new AbortController().signal,
    emit: (name, data) => events.push({ name, data }),
  });

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

  const conversation = await getConversation(user.id, meta.conversationId);
  assert.ok(conversation);
  const assistant = conversation.messages.find((message) => message.role === "assistant");
  assert.equal(assistant?.status, "complete");
  assert.match(assistant?.content ?? "", /\[1\]/);
  assert.equal(assistant?.sources?.length, sources.length);
});

test("Deep mode plans sub-queries and emits progress", { skip }, async (t) => {
  const { db } = await import("../lib/server/db");
  const { users } = await import("../lib/server/schema");
  const { encryptCredential } = await import("../lib/server/crypto");
  const { ensureSettings, saveCredential, deleteAccount } = await import("../lib/server/repo");
  const { runChat } = await import("../lib/server/chat");

  const [user] = await db.insert(users).values({ isGuest: true }).returning();
  t.after(async () => {
    await deleteAccount(user.id);
  });
  await ensureSettings(user.id);
  for (const [kind, provider, plaintext] of [
    ["llm", "openrouter", "test-openrouter"],
    ["search", "brave", "test-brave"],
  ] as const) {
    const encrypted = encryptCredential(user.id, kind, provider, plaintext);
    await saveCredential({
      userId: user.id,
      id: encrypted.id,
      kind,
      provider,
      encrypted: {
        wrappedDek: encrypted.wrappedDek,
        dekNonce: encrypted.dekNonce,
        dekTag: encrypted.dekTag,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        tag: encrypted.tag,
        fingerprint: encrypted.fingerprint,
        last4: encrypted.last4,
      },
      status: "active",
    });
  }

  const events: { name: string; data: unknown }[] = [];
  await runChat({
    userId: user.id,
    question: "Compare the evidence",
    mode: "deep",
    signal: new AbortController().signal,
    emit: (name, data) => events.push({ name, data }),
  });

  const plan = events.find((event) => event.name === "plan")?.data as { queries: string[] };
  assert.equal(plan.queries.length, 3);
  const progress = events.filter((event) => event.name === "progress");
  assert.equal(progress.length, 3);
  assert.equal(events.at(-1)?.name, "done");
});

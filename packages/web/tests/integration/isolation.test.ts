import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";
import { closePoolAfterTests, configureIntegrationEnv, createAccount, hasDatabase, skip as dbSkip } from "./helpers";

configureIntegrationEnv();
closePoolAfterTests();

/** Row-level security only binds a role without superuser or BYPASSRLS, such as beamling_app. */
async function rlsSkip(): Promise<string | undefined> {
  if (!hasDatabase) return "DATABASE_URL is required for integration tests";
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/server/db");
  const { rows } = await db.execute<{ bypass: boolean }>(
    sql`select rolsuper or rolbypassrls as bypass from pg_roles where rolname = current_user`,
  );
  return rows[0]?.bypass ? "DATABASE_URL bypasses row-level security; connect as beamling_app" : undefined;
}

const skip = await rlsSkip();

test("account tables show nothing outside an account scope", { skip }, async (t) => {
  const userId = await createAccount(t);
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../../lib/server/db");
  const { conversations, credentials, settings, userDataKeys } = await import("../../lib/server/schema");
  const { createConversation } = await import("../../lib/server/repo");
  await createConversation(userId, "quick");
  assert.equal((await db.select().from(conversations).where(eq(conversations.userId, userId))).length, 0);
  assert.equal((await db.select().from(credentials).where(eq(credentials.userId, userId))).length, 0);
  assert.equal((await db.select().from(settings).where(eq(settings.userId, userId))).length, 0);
  assert.equal((await db.select().from(userDataKeys).where(eq(userDataKeys.userId, userId))).length, 0);
});

test("one account cannot read or write another account's rows", { skip }, async (t) => {
  const [owner, other] = [await createAccount(t), await createAccount(t)];
  const { eq } = await import("drizzle-orm");
  const { asUser, db } = await import("../../lib/server/db");
  const { conversations, credentials, messages } = await import("../../lib/server/schema");
  const { createConversation, createExchange } = await import("../../lib/server/repo");
  const conversation = await createConversation(owner, "quick");
  await createExchange({ userId: owner, conversationId: conversation.id, question: "Q", mode: "quick", llmModel: "m" });

  await asUser(other, async () => {
    // Even a query that names the owner's rows explicitly sees nothing.
    assert.equal((await db.select().from(conversations).where(eq(conversations.id, conversation.id))).length, 0);
    assert.equal((await db.select().from(messages).where(eq(messages.conversationId, conversation.id))).length, 0);
    assert.equal((await db.select().from(credentials).where(eq(credentials.userId, owner))).length, 0);
    const deleted = await db.delete(conversations).where(eq(conversations.id, conversation.id)).returning();
    assert.equal(deleted.length, 0);
  });
  await assert.rejects(
    asUser(other, () => db.insert(conversations).values({ userId: owner, title: "x" })),
    (error: Error) => /row-level security/.test(String((error.cause as Error | undefined)?.message)),
  );
  assert.equal(
    (await asUser(owner, () => db.select().from(messages).where(eq(messages.conversationId, conversation.id)))).length,
    2,
  );
});

test("an account scope cannot be nested inside another account's", { skip }, async (t) => {
  const [owner, other] = [await createAccount(t, { keys: false }), await createAccount(t, { keys: false })];
  const { asUser } = await import("../../lib/server/db");
  await assert.rejects(asUser(owner, () => asUser(other, async () => 1)), /different account/);
  assert.equal(await asUser(owner, () => asUser(owner, async () => 1)), 1);
});

async function accountWithoutKey(t: TestContext): Promise<string> {
  const { db } = await import("../../lib/server/db");
  const { users } = await import("../../lib/server/schema");
  const { deleteAccount } = await import("../../lib/server/repo");
  const suffix = randomBytes(8).toString("hex");
  const [user] = await db
    .insert(users)
    .values({ googleSub: `test-${suffix}`, email: `${suffix}@example.test`, emailVerified: true })
    .returning();
  t.after(() => deleteAccount(user.id));
  return user.id;
}

test("parallel decrypts in one account scope load the workspace key once", { skip: dbSkip }, async (t) => {
  const userId = await createAccount(t, { keys: false });
  const { asUser } = await import("../../lib/server/db");
  const { encryptText, decryptText, forgetWorkspaceKey } = await import("../../lib/server/workspace-key");
  const sealed = await encryptText(userId, "conversations", userId, "title", "hello");
  forgetWorkspaceKey(userId);
  // Integration tests throw on pg's concurrent-query deprecation, so a second load would fail here.
  const opened = await asUser(userId, () =>
    Promise.all(Array.from({ length: 5 }, () => decryptText(userId, "conversations", userId, "title", sealed))),
  );
  assert.deepEqual(opened, Array(5).fill("hello"));
});

test("a workspace key created in a scope that rolls back is still stored", { skip: dbSkip }, async (t) => {
  const userId = await accountWithoutKey(t);
  const { eq } = await import("drizzle-orm");
  const { asUser, db } = await import("../../lib/server/db");
  const { userDataKeys } = await import("../../lib/server/schema");
  const { encryptText, decryptText, forgetWorkspaceKey } = await import("../../lib/server/workspace-key");
  let sealed = "";
  await assert.rejects(
    asUser(userId, async () => {
      sealed = await encryptText(userId, "conversations", userId, "title", "kept");
      throw new Error("rollback");
    }),
    /rollback/,
  );
  forgetWorkspaceKey(userId);
  assert.equal((await asUser(userId, () => db.select().from(userDataKeys).where(eq(userDataKeys.userId, userId)))).length, 1);
  assert.equal(await decryptText(userId, "conversations", userId, "title", sealed), "kept");
});

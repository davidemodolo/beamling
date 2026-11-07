import assert from "node:assert/strict";
import { test } from "node:test";
import { closePoolAfterTests, configureIntegrationEnv, skip, OTHER_USER_ID, createAccount, ask } from "./helpers";

configureIntegrationEnv();
closePoolAfterTests();

test("a pinned chat sorts ahead of newer chats across pages", { skip }, async (t) => {
  const { createConversation, listConversationPage, updateConversation } = await import("../../lib/server/repo");
  const userId = await createAccount(t);
  const pinned = await createConversation(userId, "quick");
  for (let i = 0; i < 50; i++) await createConversation(userId, "quick");

  const updated = await updateConversation(userId, pinned.id, { pinned: true });
  assert.equal(updated?.pinned, true);

  const first = await listConversationPage(userId);
  assert.equal(first.conversations.length, 50);
  assert.equal(first.conversations[0].id, pinned.id);
  assert.equal(first.conversations[0].pinned, true);
  assert.equal(first.conversations.filter((conversation) => conversation.pinned).length, 1);
  assert.ok(first.nextCursor);

  const second = await listConversationPage(userId, first.nextCursor);
  assert.equal(second.conversations.length, 1);
  assert.equal(second.conversations[0].pinned, false);

  const unpinned = await updateConversation(userId, pinned.id, { pinned: false });
  assert.equal(unpinned?.pinned, false);
  const after = await listConversationPage(userId);
  assert.equal(after.conversations.filter((conversation) => conversation.pinned).length, 0);
});

test("conversations and messages are paginated", { skip }, async (t) => {
  const { db } = await import("../../lib/server/db");
  const { conversations, messages } = await import("../../lib/server/schema");
  const { getConversation, getEarlierMessages, getState, listConversationPage } = await import("../../lib/server/repo");
  const { CONVERSATION_PAGE_SIZE, MESSAGE_PAGE_SIZE } = await import("../../lib/data");
  const userId = await createAccount(t);

  // Same updated_at for many rows, to exercise the id tiebreaker in the cursor.
  const { randomUUID } = await import("node:crypto");
  const { encryptText } = await import("../../lib/server/workspace-key");
  const base = Date.now();
  const values = await Promise.all(
    Array.from({ length: CONVERSATION_PAGE_SIZE + 5 }, async (_, i) => {
      const id = randomUUID();
      return {
        id,
        userId,
        title: await encryptText(userId, "conversations", id, "title", `C${i}`),
        updatedAt: new Date(base - Math.floor(i / 3) * 1000),
      };
    }),
  );
  const rows = await db.insert(conversations).values(values).returning();
  const first = await listConversationPage(userId);
  assert.equal(first.conversations.length, CONVERSATION_PAGE_SIZE);
  assert.ok(first.nextCursor);
  const second = await listConversationPage(userId, first.nextCursor);
  assert.equal(second.conversations.length, 5);
  assert.equal(second.nextCursor, null);
  const ids = [...first.conversations, ...second.conversations].map((item) => item.id);
  assert.equal(new Set(ids).size, rows.length, "no conversation is skipped or repeated");

  const state = await getState({ id: userId, email: "test@example.test", name: null, avatarUrl: null, createdAt: new Date() });
  assert.equal(state.conversations.length, CONVERSATION_PAGE_SIZE);
  assert.equal(state.conversationCount, rows.length);
  assert.equal("messages" in state.conversations[0], false, "the list carries no messages");

  const conversationId = rows[0].id;
  const total = MESSAGE_PAGE_SIZE + 5;
  const messageValues = await Promise.all(
    Array.from({ length: total }, async (_, i) => {
      const id = randomUUID();
      return {
        id,
        conversationId,
        userId,
        role: (i % 2 ? "assistant" : "user") as "assistant" | "user",
        content: await encryptText(userId, "messages", id, "content", `M${i}`),
        createdAt: new Date(base + i),
      };
    }),
  );
  await db.insert(messages).values(messageValues);
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

test("an account keeps at most 100 conversations, dropping unpinned ones first", { skip }, async (t) => {
  const userId = await createAccount(t, { keys: false });
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/server/db");
  const { conversations } = await import("../../lib/server/schema");
  const { countConversations, createConversation, trimConversations, updateConversation } = await import("../../lib/server/repo");
  const { MAX_CONVERSATIONS } = await import("../../lib/legal");
  const created: string[] = [];
  for (let i = 0; i < MAX_CONVERSATIONS; i++) created.push((await createConversation(userId, "quick")).id);
  // Oldest first: give each a distinct, increasing activity time.
  await db.execute(sql`
    update ${conversations} c set updated_at = now() - make_interval(mins => 1000 - o.n::int)
    from (select id, row_number() over (order by created_at, id) as n from ${conversations} where user_id = ${userId}) o
    where c.id = o.id
  `);
  const [oldest, secondOldest, thirdOldest] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(sql`${conversations.userId} = ${userId}`)
    .orderBy(conversations.updatedAt)
    .limit(3);
  await updateConversation(userId, oldest.id, { pinned: true });

  const fresh = await createConversation(userId, "quick");
  assert.deepEqual(await trimConversations(userId, fresh.id), [secondOldest.id], "the pinned oldest one is kept");
  assert.equal(await countConversations(userId), MAX_CONVERSATIONS);
  const another = await createConversation(userId, "quick");
  assert.deepEqual(await trimConversations(userId, another.id), [thirdOldest.id]);
  assert.equal(await countConversations(userId), MAX_CONVERSATIONS);

  // A question that fails before it is stored (here: no keys) must not cost an older conversation.
  const before = new Set((await db.select({ id: conversations.id }).from(conversations).where(sql`${conversations.userId} = ${userId}`)).map((row) => row.id));
  await assert.rejects(ask(userId, { question: "No keys yet", mode: "quick" }));
  const after = new Set((await db.select({ id: conversations.id }).from(conversations).where(sql`${conversations.userId} = ${userId}`)).map((row) => row.id));
  assert.deepEqual(after, before);
});

test("conversations expire 60 days after their last activity, pinned or not", { skip }, async (t) => {
  const userId = await createAccount(t, { keys: false });
  const { eq, sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/server/db");
  const { conversations } = await import("../../lib/server/schema");
  const { createConversation, deleteExpiredConversations, updateConversation } = await import("../../lib/server/repo");
  const expired = await createConversation(userId, "quick");
  const pinnedExpired = await createConversation(userId, "quick");
  const recent = await createConversation(userId, "quick");
  await updateConversation(userId, pinnedExpired.id, { pinned: true });
  for (const [id, days] of [[expired.id, 61], [pinnedExpired.id, 61], [recent.id, 59]] as const) {
    await db.update(conversations).set({ updatedAt: sql`now() - make_interval(days => ${days})` }).where(eq(conversations.id, id));
  }
  assert.ok((await deleteExpiredConversations()) >= 2);
  const left = (await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.userId, userId))).map((row) => row.id);
  assert.deepEqual(left, [recent.id]);
});

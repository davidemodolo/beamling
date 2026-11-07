import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { LEGAL_VERSION } from "../../lib/legal";
import { jsonResponse, mockFetch, withEnv } from "../helpers";
import { closePoolAfterTests, configureIntegrationEnv, skip, saveKey, createAccount, ask } from "./helpers";

configureIntegrationEnv();
closePoolAfterTests();

test("signing out everywhere revokes only that account's sessions", { skip }, async (t) => {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../../lib/server/db");
  const { authSessions } = await import("../../lib/server/schema");
  const { deleteSessions } = await import("../../lib/server/repo");
  const [userId, otherId] = [await createAccount(t, { keys: false }), await createAccount(t, { keys: false })];
  const expiresAt = new Date(Date.now() + 86_400_000);
  for (const owner of [userId, userId, otherId]) {
    await db.insert(authSessions).values({ userId: owner, tokenHash: randomBytes(16).toString("hex"), expiresAt });
  }
  await deleteSessions(userId);
  const count = async (owner: string) =>
    (await db.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.userId, owner))).length;
  assert.equal(await count(userId), 0);
  assert.equal(await count(otherId), 1);
});

test("cleanup removes expired sessions but keeps accounts", { skip }, async (t) => {
  const { db } = await import("../../lib/server/db");
  const { authSessions, users } = await import("../../lib/server/schema");
  const { cleanupExpired } = await import("../../lib/server/repo");
  const { inArray } = await import("drizzle-orm");
  const suffix = randomBytes(8).toString("hex");
  const [account] = await db.insert(users).values({ googleSub: `cleanup-${suffix}`, email: `${suffix}@example.test`, emailVerified: true }).returning();
  t.after(() => db.delete(users).where(inArray(users.id, [account.id])));
  await db.insert(authSessions).values({ userId: account.id, tokenHash: randomBytes(16).toString("hex"), expiresAt: new Date(Date.now() - 1000) });
  await cleanupExpired();
  const [remaining] = await db.select({ id: users.id }).from(users).where(inArray(users.id, [account.id]));
  assert.equal(remaining.id, account.id);
});

test("cleanup deletes inactive accounts and accounts that never accepted the terms", { skip }, async (t) => {
  const { db } = await import("../../lib/server/db");
  const { users } = await import("../../lib/server/schema");
  const { cleanupExpired } = await import("../../lib/server/repo");
  const { inArray } = await import("drizzle-orm");
  const day = 86_400_000;
  const insert = async (values: Partial<typeof users.$inferInsert>) => {
    const suffix = randomBytes(8).toString("hex");
    const [row] = await db
      .insert(users)
      .values({ googleSub: `retention-${suffix}`, email: `${suffix}@example.test`, emailVerified: true, ...values })
      .returning({ id: users.id });
    return row.id;
  };
  const accepted = { termsVersion: LEGAL_VERSION, termsAcceptedAt: new Date() };
  const inactive = await insert({ ...accepted, lastSeenAt: new Date(Date.now() - 750 * day) });
  const active = await insert({ ...accepted, lastSeenAt: new Date(Date.now() - 300 * day) });
  const abandoned = await insert({ createdAt: new Date(Date.now() - 8 * day) });
  const pending = await insert({ createdAt: new Date(Date.now() - 2 * day) });
  const ids = [inactive, active, abandoned, pending];
  t.after(() => db.delete(users).where(inArray(users.id, ids)));

  await cleanupExpired();
  const remaining = new Set((await db.select({ id: users.id }).from(users).where(inArray(users.id, ids))).map((row) => row.id));
  assert.deepEqual([...remaining].sort(), [active, pending].sort());
});

test("data export returns decrypted content and never key material", { skip }, async (t) => {
  const userId = await createAccount(t);
  const { prepared } = await ask(userId, { question: "What is in my export?", mode: "quick" });
  const { exportAccount } = await import("../../lib/server/repo");
  const data = await exportAccount(userId);
  assert.ok(data);
  assert.equal(data.account.termsVersion, LEGAL_VERSION);
  assert.equal(data.credentials.length, 2);
  const conversation = data.conversations.find((item) => item.id === prepared.conversationId);
  assert.ok(conversation);
  assert.equal(conversation.messages[0].content, "What is in my export?");
  assert.ok(conversation.messages[1].sources?.length);
  const text = JSON.stringify(data);
  assert.doesNotMatch(text, /enc:v1:/, "content must be decrypted");
  assert.doesNotMatch(text, /test-openrouter|test-brave/, "provider keys must never be exported");
  assert.doesNotMatch(text, /wrappedDek|ciphertext|tokenHash/);
});

test("opting out of analytics records the objection and queues erasure", { skip }, async (t) => {
  const userId = await createAccount(t, { keys: false });
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../../lib/server/db");
  const { analyticsErasures } = await import("../../lib/server/schema");
  const { ensureSettings, setAnalyticsOptOut } = await import("../../lib/server/repo");
  const { analyticsExcluded } = await import("../../lib/server/repo/settings");
  const distinctId = `optout-${randomBytes(8).toString("hex")}`;
  t.after(() => db.delete(analyticsErasures).where(eq(analyticsErasures.distinctId, distinctId)));

  assert.equal(await analyticsExcluded(userId, distinctId), false);
  await setAnalyticsOptOut(userId, true, distinctId);
  assert.equal(await analyticsExcluded(userId, distinctId), true);
  assert.equal((await ensureSettings(userId)).analyticsOptOut, true);
  const queued = await db.select().from(analyticsErasures).where(eq(analyticsErasures.distinctId, distinctId));
  assert.equal(queued.length, 1);

  // Opting back in keeps capture off until the pending erasure is done, so it cannot delete new events.
  await setAnalyticsOptOut(userId, false, distinctId);
  assert.equal((await ensureSettings(userId)).analyticsOptOut, false);
  assert.equal(await analyticsExcluded(userId, distinctId), true);
  await db.delete(analyticsErasures).where(eq(analyticsErasures.distinctId, distinctId));
  assert.equal(await analyticsExcluded(userId, distinctId), true, "cached for a short time");
  await setAnalyticsOptOut(userId, false, distinctId);
  assert.equal(await analyticsExcluded(userId, distinctId), false);
});

test("new accounts stop at the hourly sign-up cap", { skip }, async (t) => {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../../lib/server/db");
  const { rateLimits } = await import("../../lib/server/schema");
  const { admitNewAccount } = await import("../../lib/server/auth");
  const reset = () => db.delete(rateLimits).where(eq(rateLimits.key, "signups:all"));
  await reset();
  t.after(reset);
  withEnv(t, { NEW_ACCOUNTS_PER_HOUR: "2" });
  await admitNewAccount("one@example.test", "client-a");
  await admitNewAccount("two@example.test", "client-b");
  await assert.rejects(admitNewAccount("three@example.test", "client-c"), (error: { code?: string; status?: number }) => {
    return error.code === "SIGNUPS_PAUSED" && error.status === 429;
  });
});

test("concurrent requests cannot exceed the rate limit", { skip }, async () => {
  const { consumeRateLimit } = await import("../../lib/server/repo");
  const key = `test:${randomBytes(8).toString("hex")}`;
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => consumeRateLimit(key, 3, 60)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
});

test("Brave requests for one key are spaced across instances", { skip }, async (t) => {
  const { reserveProviderSlot } = await import("../../lib/server/repo");
  const key = `test:${randomBytes(8).toString("hex")}`;
  const waits = await Promise.all(Array.from({ length: 3 }, () => reserveProviderSlot(key, 200)));
  assert.deepEqual(
    waits.map((wait) => Math.round(wait / 100)).sort(),
    [0, 2, 4],
    "each reservation gets its own 200 ms slot",
  );

  const { searchBrave } = await import("../../lib/server/providers/brave");
  withEnv(t, { BRAVE_MIN_INTERVAL_MS: "120" });
  const startedAt: number[] = [];
  mockFetch(t, () => {
    startedAt.push(Date.now());
    return jsonResponse({ web: { results: [{ title: "t", url: "https://example.org/r", description: "s" }] } });
  });
  const apiKey = `BSA-${randomBytes(6).toString("hex")}`;
  await Promise.all([searchBrave(apiKey, "one", { count: 1 }), searchBrave(apiKey, "two", { count: 1 })]);
  startedAt.sort();
  assert.ok(startedAt[1] - startedAt[0] >= 100, `requests were ${startedAt[1] - startedAt[0]} ms apart`);
});

test("replacing a key keeps it decryptable", { skip }, async (t) => {
  const { decryptCredential } = await import("../../lib/server/crypto");
  const { getCredentialRow } = await import("../../lib/server/repo");
  const userId = await createAccount(t);

  await Promise.all([
    saveKey(userId, "llm", "openrouter", "test-replacement-a"),
    saveKey(userId, "llm", "openrouter", "test-replacement-b"),
  ]);
  const row = await getCredentialRow(userId, "llm", "openrouter");
  assert.ok(row);
  assert.match(await decryptCredential(userId, row), /^test-replacement-[ab]$/);
});

test("a key saved without validation is unverified and has no check date", { skip }, async (t) => {
  const userId = await createAccount(t, { keys: false });
  const { encryptCredential } = await import("../../lib/server/crypto");
  const { saveCredential } = await import("../../lib/server/repo");
  const credential = await saveCredential({
    userId,
    kind: "search",
    provider: "exa",
    encrypted: await encryptCredential(userId, "search", "exa", "exa-unchecked-key"),
    status: "unverified",
  });
  assert.equal(credential.status, "unverified");
  assert.equal(credential.lastValidatedAt, undefined);
});

test("deleting an account queues its erasure, which runs twice and backs off on failure", { skip }, async (t) => {
  const { claimAnalyticsErasures, deleteAccount, recordAnalyticsErasure } = await import("../../lib/server/repo");
  const { db } = await import("../../lib/server/db");
  const { analyticsErasures } = await import("../../lib/server/schema");
  const { eq } = await import("drizzle-orm");
  const userId = await createAccount(t, { keys: false });
  const distinctId = `erasure-${randomBytes(6).toString("hex")}`;
  t.after(() => db.delete(analyticsErasures).where(eq(analyticsErasures.distinctId, distinctId)));
  const read = async () => (await db.select().from(analyticsErasures).where(eq(analyticsErasures.distinctId, distinctId)))[0];

  await deleteAccount(userId, distinctId);
  const [first] = await claimAnalyticsErasures({ distinctId });
  assert.equal(first.passesLeft, 2);
  // A claimed row is hidden from other instances until its claim expires.
  assert.deepEqual(await claimAnalyticsErasures({ distinctId }), []);

  await recordAnalyticsErasure(first, false);
  let row = await read();
  assert.equal(row.attempts, 1);
  assert.equal(row.passesLeft, 2);
  assert.ok(row.nextAttemptAt.getTime() > Date.now() + 4 * 60_000);

  await recordAnalyticsErasure({ ...first, attempts: 1 }, true);
  row = await read();
  assert.equal(row.passesLeft, 1);
  assert.equal(row.attempts, 0);
  assert.ok(row.nextAttemptAt.getTime() > Date.now() + 59 * 60_000);

  await recordAnalyticsErasure({ distinctId, passesLeft: 1, attempts: 0 }, true);
  assert.equal(await read(), undefined);
});

test("a scheduled shutdown notifies every account once, then deletes them all on the date", { skip }, async (t) => {
  const { db } = await import("../../lib/server/db");
  const { users } = await import("../../lib/server/schema");
  const { cancelShutdown, getShutdown, scheduleShutdown, shutdownProgress, withShutdownLock } = await import("../../lib/server/repo");
  const { admitNewAccount } = await import("../../lib/server/auth");
  const { processShutdown } = await import("../../lib/server/shutdown");
  t.after(() => cancelShutdown());
  const { setMailTransport } = await import("../../lib/server/mail");
  const sent: string[] = [];
  // Capture mail instead of sending it.
  setMailTransport({ sendMail: async (message: { to?: unknown }) => (sent.push(String(message.to)), {} as never) });
  t.after(() => setMailTransport(undefined));
  withEnv(t, { SMTP_URL: "smtp://mail.example.test:587", MAIL_FROM: "Beamling <noreply@example.test>" });

  const first = await createAccount(t, { keys: false });
  const second = await createAccount(t, { keys: false });
  const closesAt = new Date(Date.now() + 14 * 86_400_000);

  // Scheduled without notice, the cleanup job never emails anyone.
  await scheduleShutdown(closesAt, null, false);
  await processShutdown();
  assert.equal(sent.length, 0, "notify: false sends nothing");

  await scheduleShutdown(closesAt, "Hosting ends.", true);
  assert.ok(await getShutdown());
  await assert.rejects(admitNewAccount("new@example.test", "client"), (error: { code?: string }) => error.code === "SERVICE_CLOSING");

  await processShutdown();
  const progress = await shutdownProgress();
  assert.equal(progress.notified, progress.accounts);
  const emails = new Set((await db.select({ email: users.email }).from(users)).map((row) => row.email));
  assert.deepEqual(new Set(sent), emails, "every account gets exactly one notice");
  await processShutdown();
  assert.equal(sent.length, emails.size, "a second run sends nothing new");

  // While another instance holds the lock, this one does no shutdown work.
  let nested: boolean | undefined;
  assert.equal(await withShutdownLock(async () => void (nested = await withShutdownLock(async () => {}))), true);
  assert.equal(nested, false);

  await scheduleShutdown(new Date(Date.now() - 1000), null, true);
  await processShutdown();
  assert.equal((await shutdownProgress()).accounts, 0);
  assert.ok(first && second);
});

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";
import { LEGAL_VERSION } from "../../lib/legal";

/** Test keys and fixture providers for integration tests; call once per file, after its imports. */
export function configureIntegrationEnv(): void {
  process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");
  process.env.AUTH_SECRET = randomBytes(32).toString("base64");
  process.env.KMS_PROVIDER = "env";
  process.env.BEAMLING_FAKE_PROVIDERS = "1";
  process.env.BEAMLING_FAKE_DELAY_MS = "1";
  process.env.BRAVE_MIN_INTERVAL_MS = "0";
}

/** Closes the database pool once every test in the file has run. */
export function closePoolAfterTests(): void {
  test.after(async () => {
    if (!hasDatabase) return;
    const { pool } = await import("../../lib/server/db");
    await pool.end();
  });
}

export const hasDatabase = Boolean(process.env.DATABASE_URL);
export const skip = hasDatabase ? undefined : "DATABASE_URL is required for integration tests";
export const OTHER_USER_ID = "00000000-0000-4000-8000-000000000000";

export type ChatEvents = { name: string; data: unknown }[];

export function withEnv(t: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

export async function saveKey(
  userId: string,
  kind: "llm" | "search",
  provider: "openrouter" | "brave" | "tavily" | "exa",
  plaintext: string,
) {
  const { encryptCredential } = await import("../../lib/server/crypto");
  const { getCredentialRow, saveCredential } = await import("../../lib/server/repo");
  const existing = await getCredentialRow(userId, kind, provider);
  return saveCredential({
    userId,
    kind,
    provider,
    encrypted: await encryptCredential(userId, kind, provider, plaintext, existing?.id),
    status: "active",
    plan: provider === "brave" ? "free" : null,
    preserveUsage: Boolean(existing),
  });
}

/** Creates an account with fixture keys and deletes it when the test ends. */
export async function createAccount(t: TestContext, options: { keys?: boolean } = {}): Promise<string> {
  const { db } = await import("../../lib/server/db");
  const { users } = await import("../../lib/server/schema");
  const { deleteAccount, ensureSettings } = await import("../../lib/server/repo");
  const { ensureWorkspaceKey } = await import("../../lib/server/workspace-key");
  const suffix = randomBytes(8).toString("hex");
  const [user] = await db
    .insert(users)
    .values({
      googleSub: `test-${suffix}`,
      email: `${suffix}@example.test`,
      emailVerified: true,
      termsVersion: LEGAL_VERSION,
      termsAcceptedAt: new Date(),
    })
    .returning();
  t.after(() => deleteAccount(user.id));
  await ensureSettings(user.id);
  await ensureWorkspaceKey(user.id);
  if (options.keys !== false) {
    await saveKey(user.id, "llm", "openrouter", "test-openrouter");
    await saveKey(user.id, "search", "brave", "test-brave");
  }
  return user.id;
}

export async function ask(
  userId: string,
  input: {
    question?: string;
    retryOf?: string;
    conversationId?: string;
    mode: "quick" | "deep" | "deeper";
    searchProvider?: "brave" | "tavily" | "exa";
  },
  signal = new AbortController().signal,
) {
  const { prepareChat, runChat } = await import("../../lib/server/answer-pipeline");
  const events: ChatEvents = [];
  const prepared = await prepareChat({ userId, ...input });
  await runChat(prepared, { signal, emit: (name, data) => events.push({ name, data }) });
  return { events, prepared };
}

export function eventData<T>(events: ChatEvents, name: string): T {
  return events.find((event) => event.name === name)?.data as T;
}

export async function storedAnswer(userId: string, conversationId: string) {
  const { getConversation } = await import("../../lib/server/repo");
  const conversation = await getConversation(userId, conversationId);
  assert.ok(conversation);
  return { conversation, answer: conversation.messages.findLast((message) => message.role === "assistant") };
}

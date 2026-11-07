import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { jsonResponse, mockFetch, withEnv } from "../helpers";
import { closePoolAfterTests, configureIntegrationEnv, skip, createAccount, ask, eventData, storedAnswer, saveKey } from "./helpers";

configureIntegrationEnv();
closePoolAfterTests();

test("account chat persists a cited Quick answer with its cost breakdown", { skip }, async (t) => {
  const userId = await createAccount(t);
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

test("the selected search provider is stored with the answer and its cost", { skip }, async (t) => {
  const userId = await createAccount(t);
  const { saveCredential, updateSettings } = await import("../../lib/server/repo");
  const { encryptCredential } = await import("../../lib/server/crypto");
  await saveCredential({
    userId,
    kind: "search",
    provider: "tavily",
    encrypted: await encryptCredential(userId, "search", "tavily", "test-tavily"),
    status: "active",
  });
  await updateSettings(userId, { defaultSearchProvider: "tavily" });

  const { events, prepared } = await ask(userId, { question: "Use Tavily", mode: "quick" });
  assert.equal(prepared.searchProvider, "tavily");
  const usage = eventData<{ searchProvider: string; searchCostUsd: number }>(events, "usage");
  assert.equal(usage.searchProvider, "tavily");
  assert.equal(usage.searchCostUsd, 0.008);
  const { answer } = await storedAnswer(userId, prepared.conversationId);
  assert.equal(answer?.searchProvider, "tavily");
  assert.equal(answer?.usage?.searchProvider, "tavily");
  assert.equal(answer?.status, "complete");
});

test("a missing key for the selected provider never falls back", { skip }, async (t) => {
  const { ApiError } = await import("../../lib/server/http");
  const userId = await createAccount(t);
  await assert.rejects(
    ask(userId, { question: "Use Exa", mode: "quick", searchProvider: "exa" }),
    (error) => error instanceof ApiError && error.code === "CREDENTIAL_MISSING" && error.provider === "exa",
  );
});

test("Deep mode plans sub-queries and emits progress", { skip }, async (t) => {
  const userId = await createAccount(t);
  const { events } = await ask(userId, { question: "Compare the evidence", mode: "deep" });

  assert.equal(eventData<{ queries: string[] }>(events, "plan").queries.length, 3);
  assert.equal(events.filter((event) => event.name === "progress").length, 3);
  assert.equal(events.at(-1)?.name, "done");
  assert.equal(eventData<{ degraded: boolean }>(events, "done").degraded, false);
});

test("Deeper mode runs the research loop and keeps every search trace", { skip }, async (t) => {
  const userId = await createAccount(t);
  const { events, prepared } = await ask(userId, { question: "Map the evidence", mode: "deeper" });

  const searches = events.filter((event) => event.name === "search").map((event) => event.data as { status: string });
  assert.ok(searches.length >= 6, "each search emits a searching and a done event");
  assert.equal(eventData<{ truncated: boolean }>(events, "done").truncated, false);
  const { conversation, answer } = await storedAnswer(userId, prepared.conversationId);
  assert.equal(conversation.mode, "deeper");
  assert.equal(answer?.mode, "deeper");
  assert.ok((answer?.searches?.length ?? 0) >= 3);
  assert.equal(answer?.status, "complete");
});

/** Real-provider path with mocked HTTP: Brave returns one source; OpenRouter plays the agent and the writer. */
function mockProviders(t: TestContext) {
  const toolRequests: { messages?: { role: string; content?: unknown }[]; tools?: unknown[] }[] = [];
  const sse = (lines: unknown[]) =>
    new Response(lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
  const calls = mockFetch(t, (url, init) => {
    if (new URL(url).hostname === "api.search.brave.com") {
      return jsonResponse({
        web: { results: [{ title: "Alpha source", url: "https://example.org/alpha", description: "Alpha evidence." }] },
      });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      stream?: boolean;
      tools?: unknown[];
      messages?: { role: string; content?: unknown }[];
    };
    const base = { id: "gen-test", object: "chat.completion.chunk", created: 1, model: "deepseek/deepseek-v4.1-flash" };
    const json = (message: unknown, finishReason: string, cost: number, prompt: number, completion: number) =>
      jsonResponse({
        id: "gen-test",
        object: "chat.completion",
        created: 1,
        model: "deepseek/deepseek-v4.1-flash",
        provider: "MockProvider",
        choices: [{ index: 0, message, finish_reason: finishReason }],
        usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, cost },
      });
    if (body.tools?.length) toolRequests.push(body);
    if (body.tools?.length && !body.messages?.some((message) => message.role === "tool")) {
      return json(
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "search", arguments: JSON.stringify({ queries: ["alpha evidence"] }) } }],
        },
        "tool_calls",
        0.0001,
        20,
        5,
      );
    }
    if (body.tools?.length) {
      return json({ role: "assistant", content: "Research complete. Alpha evidence is covered." }, "stop", 0.0001, 30, 8);
    }
    return sse([
      { ...base, provider: "MockProvider", choices: [{ index: 0, delta: { content: "Mock deeper answer with evidence [1]." }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50, cost: 0.0002 } },
    ]);
  });

  return { calls, toolRequests };
}

test("Deeper's agent loop calls the search tool and sums step cost", { skip }, async (t) => {
  const userId = await createAccount(t);
  withEnv(t, { BEAMLING_FAKE_PROVIDERS: "0", BRAVE_MIN_INTERVAL_MS: "0" });
  const { calls } = mockProviders(t);
  const { events, prepared } = await ask(userId, { question: "Prove the agent loop", mode: "deeper" });
  assert.equal(calls.filter((url) => new URL(url).hostname === "api.search.brave.com").length, 1);
  const search = eventData<{ query: string; status: string }>(events, "search");
  assert.equal(search.query, "alpha evidence");
  assert.equal(eventData<{ upstreamProvider: string }>(events, "usage").upstreamProvider, "MockProvider");
  const { answer } = await storedAnswer(userId, prepared.conversationId);
  assert.equal(answer?.status, "complete");
  assert.match(answer?.content ?? "", /Mock deeper answer/);
  assert.equal(answer?.sources?.length, 1);
  assert.ok((answer?.usage?.costUsd ?? 0) >= 0.0004, "agent steps and synthesis are summed");
});

test("Quick runs the agent for exactly one search, written with the conversation in view", { skip }, async (t) => {
  const userId = await createAccount(t);
  withEnv(t, { BEAMLING_FAKE_PROVIDERS: "0", BRAVE_MIN_INTERVAL_MS: "0" });
  const { calls, toolRequests } = mockProviders(t);

  const first = await ask(userId, { question: "What is alpha?", mode: "quick" });
  assert.equal(toolRequests.length, 1, "Quick stops after the forced search step");
  assert.equal(calls.filter((url) => new URL(url).hostname === "api.search.brave.com").length, 1);
  assert.equal(eventData<{ query: string }>(first.events, "search").query, "alpha evidence");
  const { answer } = await storedAnswer(userId, first.prepared.conversationId);
  assert.equal(answer?.status, "complete");
  assert.equal(answer?.usage?.searchRequests, 1);
  assert.ok((answer?.usage?.costUsd ?? 0) >= 0.0003, "the search step and the answer are both billed");

  await ask(userId, { question: "And in Germany?", mode: "quick", conversationId: first.prepared.conversationId });
  const followUp = JSON.stringify(toolRequests[1]?.messages ?? []);
  assert.match(followUp, /CONVERSATION SO FAR/);
  assert.match(followUp, /What is alpha\?/);
});

test("an invalid plan is repaired once, then the run degrades instead of failing", { skip }, async (t) => {
  const userId = await createAccount(t);
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
  const userId = await createAccount(t);
  const { events, prepared } = await ask(userId, { question: "Partial [fixture:partial-search]", mode: "deep" });
  assert.equal(eventData<{ searchFailures: number }>(events, "done").searchFailures, 1);
  const { answer } = await storedAnswer(userId, prepared.conversationId);
  assert.equal(answer?.status, "complete");
  assert.equal(answer?.searchFailures, 1);
  assert.equal(answer?.usage?.searchRequests, 2);
});

test("missing keys use the stable CREDENTIAL_MISSING code", { skip }, async (t) => {
  const { ApiError } = await import("../../lib/server/http");
  const userId = await createAccount(t, { keys: false });
  await assert.rejects(
    ask(userId, { question: "Hi", mode: "quick" }),
    (error) => error instanceof ApiError && error.code === "CREDENTIAL_MISSING" && error.provider === "openrouter",
  );
});

test("the time limit keeps partial text and records GENERATION_TIMEOUT", { skip }, async (t) => {
  withEnv(t, { BEAMLING_FAKE_DELAY_MS: "40" });
  const userId = await createAccount(t);
  const { events, prepared } = await ask(userId, { question: "Slow", mode: "quick" }, AbortSignal.timeout(400));
  assert.equal(events.at(-1)?.name, "stage");
  const { answer } = await storedAnswer(userId, prepared.conversationId);
  assert.equal(answer?.status, "stopped");
  assert.equal(answer?.errorCode, "GENERATION_TIMEOUT");
});

test("NUL characters never reach Postgres", { skip }, async (t) => {
  const { createConversation, createExchange } = await import("../../lib/server/repo");
  const userId = await createAccount(t);
  const conversation = await createConversation(userId, "quick");
  const { questionText } = await createExchange({
    userId,
    conversationId: conversation.id,
    question: "a\u0000b",
    mode: "quick",
    llmModel: "m",
  });
  assert.equal(questionText, "ab");
  const { db } = await import("../../lib/server/db");
  const { messages } = await import("../../lib/server/schema");
  const { eq } = await import("drizzle-orm");
  const [stored] = await db.select({ content: messages.content }).from(messages).where(eq(messages.conversationId, conversation.id));
  assert.match(stored.content, /^enc:v1:/, "message content is encrypted at rest");
});

test("retrying a failed answer replaces it and reuses the question", { skip }, async (t) => {
  const { completeAssistant, createConversation, createExchange, getConversation } = await import("../../lib/server/repo");
  const { ApiError } = await import("../../lib/server/http");
  const userId = await createAccount(t);
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

test("one DeepSeek key runs both the model and search, and is read once", { skip }, async (t) => {
  const { updateSettings } = await import("../../lib/server/repo");
  const userId = await createAccount(t, { keys: false });
  await saveKey(userId, "llm", "deepseek", "test-deepseek");
  await updateSettings(userId, { llmModel: "deepseek:deepseek-flash", defaultSearchProvider: "deepseek" });

  const { prepared } = await ask(userId, { question: "What is alpha?", mode: "quick" });
  assert.equal(prepared.llm.provider, "deepseek");
  assert.equal(prepared.llm.apiModel, "deepseek-flash");
  assert.equal(prepared.searchProvider, "deepseek");
  assert.equal(prepared.llmKey, "test-deepseek");
  assert.equal(prepared.searchKey, "test-deepseek");
  const { answer } = await storedAnswer(userId, prepared.conversationId);
  assert.equal(answer?.status, "complete");
  assert.equal(answer?.llmModel, "deepseek:deepseek-flash");
  assert.equal(answer?.searchProvider, "deepseek");
});

test("a missing key names the provider of the selected model", { skip }, async (t) => {
  const { ApiError } = await import("../../lib/server/http");
  const { updateSettings } = await import("../../lib/server/repo");
  const userId = await createAccount(t);
  await updateSettings(userId, { llmModel: "deepseek:deepseek-flash" });
  await assert.rejects(
    ask(userId, { question: "Hi", mode: "quick" }),
    (error) => error instanceof ApiError && error.code === "CREDENTIAL_MISSING" && error.provider === "deepseek",
  );
});

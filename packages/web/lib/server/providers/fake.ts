import { ApiError } from "../http";
import type { RetrievedSource } from "./brave";
import type { ChatMessage, ChatPurpose, ChatResult } from "./openrouter";

// Fixture switches for tests: put the marker in the question.
const BROKEN_PLAN = "[fixture:broken-plan]";
const BAD_FIRST_PLAN = "[fixture:bad-plan]";
const PARTIAL_SEARCH = "[fixture:partial-search]";
const FAILING_QUERY = "fixture failing search";

function delay(ms: number): number {
  return Number(process.env.BEAMLING_FAKE_DELAY_MS ?? ms);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delay(ms)));
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export async function fakeValidateKey(key: string, provider: "openrouter" | "brave"): Promise<void> {
  await sleep(20);
  if (!key.startsWith("test-")) {
    throw new ApiError("CREDENTIAL_INVALID", "Fixture providers accept keys that start with test-.", 400, provider);
  }
}

export async function fakeSearch(query: string, count: number, signal?: AbortSignal): Promise<RetrievedSource[]> {
  await sleep(30);
  aborted(signal);
  if (query.includes(FAILING_QUERY)) {
    throw new ApiError("PROVIDER_UNAVAILABLE", "Brave Search is temporarily unavailable.", 502, "brave");
  }
  if (/\bno sources\b/i.test(query)) return [];
  const base = [
    {
      title: `${query}: overview`,
      url: "https://example.org/beamling-overview",
      domain: "example.org",
      snippet: `A concise overview of ${query}. This fixture source is used when BEAMLING_FAKE_PROVIDERS=1.`,
      publishedAt: "2026-10-01T00:00:00.000Z",
    },
    {
      title: `${query}: recent developments`,
      url: "https://example.net/beamling-recent",
      domain: "example.net",
      snippet: `Recent reporting about ${query}, including dates and figures for end-to-end testing.`,
      publishedAt: "2026-10-10T00:00:00.000Z",
    },
    {
      title: `${query}: limitations`,
      url: "https://example.com/beamling-limits",
      domain: "example.com",
      snippet: `Known limitations and competing interpretations relevant to ${query}.`,
      publishedAt: "2026-09-15T00:00:00.000Z",
    },
    {
      title: `${query}: primary source`,
      url: "https://example.edu/beamling-primary",
      domain: "example.edu",
      snippet: `Primary-source material supporting the answer about ${query}.`,
      publishedAt: "2026-08-20T00:00:00.000Z",
    },
  ];
  return base.slice(0, Math.max(1, Math.min(count, base.length))).map((source, index) => ({
    ...source,
    position: index + 1,
  }));
}

function result(content: string, usage: ChatResult["usage"]): ChatResult {
  return { content, model: "deepseek/deepseek-v4.1-flash", provider: "fixture", finishReason: "stop", usage };
}

function planJson(question: string): string {
  const queries = ["fixture topic overview", "fixture recent developments", "fixture limitations"];
  if (question.includes(PARTIAL_SEARCH)) queries[2] = FAILING_QUERY;
  return JSON.stringify({ subqueries: queries.map((query) => ({ query, intent: "fixture" })) });
}

export async function fakeChat(options: {
  purpose: ChatPurpose;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<ChatResult> {
  await sleep(20);
  aborted(options.signal);
  const question = options.messages.find((message) => message.role === "user")?.content ?? "";

  if (options.purpose === "plan") {
    const isRepair = options.messages.some((message) => message.role === "assistant");
    const broken = question.includes(BROKEN_PLAN) || (question.includes(BAD_FIRST_PLAN) && !isRepair);
    return result(broken ? "Here are some searches you could run." : planJson(question), {
      promptTokens: 120,
      completionTokens: 40,
      costUsd: 0.00002,
    });
  }
  if (options.purpose === "gap") {
    return result(JSON.stringify({ sufficient: true, followUpQueries: [] }), {
      promptTokens: 90,
      completionTokens: 12,
      costUsd: 0.00001,
    });
  }

  const content =
    "This is a fixture answer for local testing. It demonstrates the streaming pipeline, source numbering and citations [1]. The second source adds a recent development [2], while the third records a limitation [3].";
  for (const word of content.split(" ")) {
    aborted(options.signal);
    options.onDelta?.(`${word} `);
    await sleep(8);
  }
  return result(content, { promptTokens: 420, completionTokens: 80, costUsd: 0.00005 });
}

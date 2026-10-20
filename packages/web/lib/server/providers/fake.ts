import type { RetrievedSource } from "./brave";
import type { ChatMessage, ChatResult } from "./openrouter";

function delay(ms: number): number {
  return Number(process.env.BEAMLING_FAKE_DELAY_MS ?? ms);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delay(ms)));
}

export async function fakeValidateKey(key: string): Promise<void> {
  await sleep(20);
  if (!key.startsWith("test-")) {
    throw new Error("Fake providers accept keys that start with test-");
  }
}

export async function fakeSearch(query: string, count: number, signal?: AbortSignal): Promise<RetrievedSource[]> {
  await sleep(30);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
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

export async function fakeChat(options: {
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<ChatResult> {
  const system = options.messages.find((message) => message.role === "system")?.content ?? "";
  if (system.includes("research planner") || system.includes("evidence reviewer")) {
    const content = JSON.stringify({
      subqueries: [
        { query: "fixture topic overview", intent: "overview" },
        { query: "fixture recent developments", intent: "recency" },
        { query: "fixture limitations", intent: "limitations" },
      ],
      sufficient: true,
      followUpQueries: [],
    });
    await sleep(20);
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    options.onDelta?.(content);
    return {
      content,
      model: "deepseek/deepseek-v4.1-flash",
      provider: "fixture",
      finishReason: "stop",
      usage: { promptTokens: 120, completionTokens: 40, costUsd: 0.00002 },
    };
  }

  const content =
    "This is a fixture answer for local testing. It demonstrates the streaming pipeline, source numbering and citations [1]. The second source adds a recent development [2], while the third records a limitation [3].";
  for (const word of content.split(" ")) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    options.onDelta?.(`${word} `);
    await sleep(8);
  }
  return {
    content,
    model: "deepseek/deepseek-v4.1-flash",
    provider: "fixture",
    finishReason: "stop",
    usage: { promptTokens: 420, completionTokens: 80, costUsd: 0.00005 },
  };
}

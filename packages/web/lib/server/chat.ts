import { randomUUID } from "node:crypto";
import { DEFAULT_LLM_MODEL } from "../providers";
import { isAllowedModel } from "../providers";
import type { Mode, Source, Usage } from "../types";
import { hasValidCitation, newCitations, sanitizeCitations } from "./citations";
import { decryptCredential } from "./crypto";
import { ApiError } from "./http";
import {
  deepPrompt,
  gapPrompt,
  NO_SOURCES_ANSWER,
  plannerPrompt,
  quickPrompt,
} from "./prompts";
import { chat, search } from "./providers";
import {
  completeAssistant,
  createConversation,
  createExchange,
  getConversation,
  getCredentialRow,
  getHistory,
  getSettings,
} from "./repo";

const BRAVE_COST_PER_REQUEST = 0.005;
const QUICK_SOURCE_LIMIT = 8;
const RECENCY_DAYS = 30;

type ChatEvent =
  | { event: "meta"; data: { conversationId: string; messageId: string } }
  | { event: "stage"; data: { stage: string; detail?: string } }
  | { event: "plan"; data: { queries: string[] } }
  | { event: "progress"; data: { completed: number; total: number } }
  | { event: "sources"; data: Source[] }
  | { event: "delta"; data: { text: string } }
  | { event: "citation"; data: { position: number } }
  | { event: "usage"; data: Usage }
  | { event: "done"; data: { noSources: boolean } }
  | { event: "error"; data: { code: string; message: string; provider?: string } };

export interface RunChatInput {
  userId: string;
  conversationId?: string;
  question: string;
  mode: Mode;
  signal: AbortSignal;
  emit: <T extends ChatEvent>(event: T["event"], data: T["data"]) => void;
}

interface AccumulatedUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

function withSearchCost(usage: AccumulatedUsage, searchRequests: number, latencyMs: number): Usage {
  return {
    tokensIn: usage.promptTokens,
    tokensOut: usage.completionTokens,
    costUsd: Number((usage.costUsd + searchRequests * BRAVE_COST_PER_REQUEST).toFixed(6)),
    latencyMs,
    searchRequests,
  };
}

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseQueries(text: string): string[] {
  const parsed = parseJsonObject(text) as { subqueries?: ({ query?: string } | string)[] } | null;
  const raw =
    parsed?.subqueries?.map((item) => (typeof item === "string" ? item : item.query ?? "")) ?? [];
  const seen = new Set<string>();
  return raw
    .map((query) => query.replace(/\s+/g, " ").trim().slice(0, 180))
    .filter((query) => {
      const key = query.toLowerCase();
      if (!query || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function parseGapQueries(text: string): string[] {
  const parsed = parseJsonObject(text) as { followUpQueries?: string[] } | null;
  if (!parsed?.followUpQueries) return [];
  return parsed.followUpQueries
    .map((query) => query.replace(/\s+/g, " ").trim().slice(0, 180))
    .filter(Boolean)
    .slice(0, 2);
}

function dedupeSources(sources: Source[], limit: number): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const source of sources) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    out.push(source);
    if (out.length >= limit) break;
  }
  return out.map((source, index) => ({ ...source, position: index + 1 }));
}

async function mapSearchResults(
  key: string,
  query: string,
  mode: Mode,
  signal: AbortSignal,
): Promise<Source[]> {
  const results = await search("brave", key, query, {
    count: mode === "deep" ? 6 : QUICK_SOURCE_LIMIT,
    freshnessDays: RECENCY_DAYS,
    signal,
  });
  return results.map((source) => ({
    id: randomUUID(),
    position: source.position,
    title: source.title,
    url: source.url,
    domain: source.domain,
    snippet: source.snippet,
    publishedAt: source.publishedAt,
  }));
}

async function runBounded<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

export async function runChat(input: RunChatInput): Promise<void> {
  const startedAt = Date.now();
  const settings = await getSettings(input.userId);
  const model = isAllowedModel(settings.llmModel) ? settings.llmModel : DEFAULT_LLM_MODEL;

  let conversation = input.conversationId
    ? await getConversation(input.userId, input.conversationId)
    : null;
  if (input.conversationId && !conversation) {
    throw new ApiError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
  }
  if (!conversation) {
    conversation = await createConversation(input.userId, input.mode);
  }
  const history = await getHistory(input.userId, conversation.id, new Date());
  const { assistantMessage } = await createExchange({
    userId: input.userId,
    conversationId: conversation.id,
    question: input.question,
    mode: input.mode,
    llmModel: model,
  });

  input.emit("meta", {
    conversationId: conversation.id,
    messageId: assistantMessage.id,
  });
  input.emit("stage", { stage: "queued", detail: input.mode === "deep" ? "Planning a research path" : "Understanding the question" });

  const usage: AccumulatedUsage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
  let searchRequests = 0;
  let content = "";
  let uncited = false;
  let sources: Source[] = [];
  let finished = false;

  try {
    const llmCredential = await getCredentialRow(input.userId, "llm", "openrouter");
    const searchCredential = await getCredentialRow(input.userId, "search", "brave");
    if (!llmCredential) {
      throw new ApiError("MISSING_LLM_KEY", "Add an OpenRouter key before asking a question.", 400, "openrouter");
    }
    if (!searchCredential) {
      throw new ApiError("MISSING_SEARCH_KEY", "Add a Brave Search key before asking a question.", 400, "brave");
    }
    const llmKey = decryptCredential(input.userId, llmCredential);
    const searchKey = decryptCredential(input.userId, searchCredential);

    let queries = [input.question];
    if (input.mode === "deep") {
      input.emit("stage", { stage: "searching", detail: "Planning 3–5 sub-queries" });
      const prompt = plannerPrompt(input.question);
      try {
        const plan = await chat({
          key: llmKey,
          model,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          maxTokens: 400,
          signal: input.signal,
        });
        usage.promptTokens += plan.usage.promptTokens;
        usage.completionTokens += plan.usage.completionTokens;
        usage.costUsd += plan.usage.costUsd;
        queries = parseQueries(plan.content);
      } catch (error) {
        if (input.signal.aborted) throw error;
      }
      if (queries.length < 3) queries = [input.question];
      input.emit("plan", { queries });
    }

    input.emit("stage", {
      stage: "searching",
      detail: input.mode === "deep" ? `Searching 0 of ${queries.length}` : "Searching the web",
    });

    let completed = 0;
    await runBounded(queries, 2, async (query) => {
      const found = await mapSearchResults(searchKey, query, input.mode, input.signal);
      searchRequests += 1;
      sources = dedupeSources([...sources, ...found], input.mode === "deep" ? 20 : QUICK_SOURCE_LIMIT);
      completed += 1;
      input.emit("progress", { completed, total: queries.length });
      input.emit("stage", {
        stage: "searching",
        detail: input.mode === "deep" ? `Searching ${completed} of ${queries.length}` : "Searching the web",
      });
    });

    if (input.mode === "deep" && sources.length < 4 && !input.signal.aborted) {
      try {
        const gap = gapPrompt({ question: input.question, subqueries: queries, sources });
        const review = await chat({
          key: llmKey,
          model,
          messages: [
            { role: "system", content: gap.system },
            { role: "user", content: gap.user },
          ],
          maxTokens: 220,
          signal: input.signal,
        });
        usage.promptTokens += review.usage.promptTokens;
        usage.completionTokens += review.usage.completionTokens;
        usage.costUsd += review.usage.costUsd;
        const followUps = parseGapQueries(review.content);
        for (const query of followUps) {
          const found = await mapSearchResults(searchKey, query, input.mode, input.signal);
          searchRequests += 1;
          sources = dedupeSources([...sources, ...found], 20);
        }
      } catch (error) {
        if (input.signal.aborted) throw error;
      }
    }

    sources = dedupeSources(sources, input.mode === "deep" ? 20 : QUICK_SOURCE_LIMIT);
    input.emit("stage", {
      stage: "reading",
      detail: `Reading ${sources.length} ${sources.length === 1 ? "source" : "sources"}`,
    });
    input.emit("sources", sources);

    if (!sources.length) {
      content = NO_SOURCES_ANSWER;
      input.emit("stage", { stage: "no-sources", detail: "No usable sources found" });
      input.emit("delta", { text: content });
      const finalUsage = withSearchCost(usage, searchRequests, Date.now() - startedAt);
      await completeAssistant({
        userId: input.userId,
        messageId: assistantMessage.id,
        content,
        status: "complete",
        usage: finalUsage,
        noSources: true,
        searchRequests,
      });
      input.emit("usage", finalUsage);
      input.emit("done", { noSources: true });
      finished = true;
      return;
    }

    const prompt =
      input.mode === "deep"
        ? deepPrompt({
            question: input.question,
            sources,
            subqueries: queries,
            history,
          })
        : quickPrompt({
            question: input.question,
            sources,
            history,
          });

    input.emit("stage", { stage: "writing", detail: `Writing with ${model}` });
    const seen = new Set<number>();
    const result = await chat({
      key: llmKey,
      model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      maxTokens: input.mode === "deep" ? 2500 : 1500,
      signal: input.signal,
      onDelta: (text) => {
        content += text;
        input.emit("delta", { text });
        for (const position of newCitations(content, sources.length, seen)) {
          input.emit("citation", { position });
        }
      },
    });

    content = sanitizeCitations(result.content || content, sources.length);
    usage.promptTokens += result.usage.promptTokens;
    usage.completionTokens += result.usage.completionTokens;
    usage.costUsd += result.usage.costUsd;
    uncited = !hasValidCitation(content, sources.length);
    const finalUsage = withSearchCost(usage, searchRequests, Date.now() - startedAt);
    await completeAssistant({
      userId: input.userId,
      messageId: assistantMessage.id,
      content,
      status: "complete",
      sources,
      usage: finalUsage,
      uncited,
      searchRequests,
    });
    input.emit("usage", finalUsage);
    input.emit("done", { noSources: false });
    finished = true;
  } catch (error) {
    if (finished) return;
    const aborted = input.signal.aborted || (error instanceof Error && error.name === "AbortError");
    const code = aborted ? "STOPPED" : error instanceof ApiError ? error.code : "INTERNAL";
    const message = aborted
      ? "Answer stopped."
      : error instanceof ApiError
        ? error.message
        : "The answer could not be completed.";
    const finalContent = sanitizeCitations(content, sources.length);
    const finalUsage = withSearchCost(usage, searchRequests, Date.now() - startedAt);
    await completeAssistant({
      userId: input.userId,
      messageId: assistantMessage.id,
      content: finalContent,
      status: aborted ? "stopped" : "error",
      sources,
      usage: finalUsage,
      errorCode: aborted ? undefined : code,
      errorMessage: aborted ? undefined : message,
      searchRequests,
    });
    if (!aborted) {
      input.emit("error", {
        code,
        message,
        provider: error instanceof ApiError ? error.provider : undefined,
      });
    } else {
      input.emit("stage", { stage: "stopped", detail: "Answer stopped" });
    }
  }
}

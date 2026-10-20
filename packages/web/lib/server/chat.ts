import { randomUUID } from "node:crypto";
import { DEFAULT_LLM_MODEL, isAllowedModel } from "../providers";
import type { Message, Mode, Source, Usage } from "../types";
import { hasValidCitation, newCitations, sanitizeCitations } from "./citations";
import { decryptCredential } from "./crypto";
import { ApiError, INTERNAL_ERROR_MESSAGE } from "./http";
import {
  deepPrompt,
  gapPrompt,
  NO_SOURCES_ANSWER,
  plannerPrompt,
  quickPrompt,
  type Prompt,
} from "./prompts";
import { chat, search } from "./providers";
import type { ChatResult } from "./providers/openrouter";
import {
  completeAssistant,
  conversationExists,
  createConversation,
  createExchange,
  ensureSettings,
  getCredentialRow,
  getHistory,
} from "./repo";

const BRAVE_COST_PER_REQUEST = 0.005;
const QUICK_SOURCE_LIMIT = 8;
const DEEP_SOURCE_LIMIT = 20;

type ChatEvent =
  | { event: "meta"; data: { conversationId: string; messageId: string } }
  | { event: "stage"; data: { stage: string; detail?: string } }
  | { event: "plan"; data: { queries: string[] } }
  | { event: "progress"; data: { completed: number; total: number } }
  | { event: "sources"; data: Source[] }
  | { event: "delta"; data: { text: string } }
  | { event: "citation"; data: { position: number } }
  | { event: "usage"; data: Usage }
  | { event: "done"; data: { noSources: boolean; truncated?: boolean } }
  | { event: "error"; data: { code: string; message: string; provider?: string } };

export type ChatEmit = <T extends ChatEvent>(event: T["event"], data: T["data"]) => void;

export interface PreparedChat {
  userId: string;
  conversationId: string;
  messageId: string;
  question: string;
  mode: Mode;
  model: string;
  llmKey: string;
  searchKey: string;
  history: Message[];
  startedAt: number;
}

interface AccumulatedUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

function addUsage(total: AccumulatedUsage, result: ChatResult): void {
  total.promptTokens += result.usage.promptTokens;
  total.completionTokens += result.usage.completionTokens;
  total.costUsd += result.usage.costUsd;
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

function promptMessages(prompt: Prompt) {
  return [
    { role: "system" as const, content: prompt.system },
    { role: "user" as const, content: prompt.user },
  ];
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

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, 180);
}

function parseQueries(text: string): string[] {
  const parsed = parseJsonObject(text) as { subqueries?: ({ query?: string } | string)[] } | null;
  const raw = Array.isArray(parsed?.subqueries)
    ? parsed.subqueries.map((item) => (typeof item === "string" ? item : String(item?.query ?? "")))
    : [];
  const seen = new Set<string>();
  return raw
    .map(normalizeQuery)
    .filter((query) => {
      const key = query.toLowerCase();
      if (!query || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function parseGapQueries(text: string): string[] {
  const parsed = parseJsonObject(text) as { followUpQueries?: unknown } | null;
  if (!Array.isArray(parsed?.followUpQueries)) return [];
  return parsed.followUpQueries
    .filter((query): query is string => typeof query === "string")
    .map(normalizeQuery)
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

const RECENCY_PATTERNS: [RegExp, number][] = [
  [/(?<!\p{L})(today|tonight|oggi|stasera|hoy|aujourd'hui|heute)(?!\p{L})/iu, 1],
  [/(?<!\p{L})(this week|questa settimana|esta semana|cette semaine|diese woche)(?!\p{L})/iu, 7],
  [
    /(?<!\p{L})(latest|recent|recently|news|breaking|this month|currently|ultim[aeio]|recent[ei]|notizie|attualmente|últim[oa]s?|noticias|derni[eè]res?|actualités|neueste[nrs]?|aktuell[e]?|nachrichten)(?!\p{L})/iu,
    30,
  ],
];

/** Brave freshness is applied only when the question asks for recent information. */
export function freshnessDays(question: string): number | undefined {
  return RECENCY_PATTERNS.find(([pattern]) => pattern.test(question))?.[1];
}

async function searchSources(
  key: string,
  query: string,
  options: { mode: Mode; freshnessDays?: number; signal: AbortSignal },
): Promise<Source[]> {
  const results = await search("brave", key, query, {
    count: options.mode === "deep" ? 6 : QUICK_SOURCE_LIMIT,
    freshnessDays: options.freshnessDays,
    signal: options.signal,
  });
  return results.map((source) => ({ id: randomUUID(), ...source }));
}

/** Runs `worker` over `items` with at most `limit` in flight; stops picking new items once aborted. */
async function runBounded<T>(
  items: T[],
  limit: number,
  signal: AbortSignal,
  worker: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !signal.aborted) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

/**
 * Everything that can fail before streaming starts: settings, keys, conversation and the stored
 * exchange. Errors here are returned as plain JSON responses.
 */
export async function prepareChat(input: {
  userId: string;
  conversationId?: string;
  question: string;
  mode: Mode;
}): Promise<PreparedChat> {
  const startedAt = Date.now();
  const settings = await ensureSettings(input.userId);
  const model = isAllowedModel(settings.llmModel) ? settings.llmModel : DEFAULT_LLM_MODEL;

  const [llmCredential, searchCredential] = await Promise.all([
    getCredentialRow(input.userId, "llm", "openrouter"),
    getCredentialRow(input.userId, "search", "brave"),
  ]);
  if (!llmCredential) {
    throw new ApiError("MISSING_LLM_KEY", "Add an OpenRouter key before asking a question.", 400, "openrouter");
  }
  if (!searchCredential) {
    throw new ApiError("MISSING_SEARCH_KEY", "Add a Brave Search key before asking a question.", 400, "brave");
  }
  const llmKey = decryptCredential(input.userId, llmCredential);
  const searchKey = decryptCredential(input.userId, searchCredential);

  let conversationId = input.conversationId;
  if (conversationId) {
    if (!(await conversationExists(input.userId, conversationId))) {
      throw new ApiError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    }
  } else {
    conversationId = (await createConversation(input.userId, input.mode)).id;
  }

  const history = await getHistory(input.userId, conversationId, new Date());
  const { assistantMessage } = await createExchange({
    userId: input.userId,
    conversationId,
    question: input.question,
    mode: input.mode,
    llmModel: model,
  });

  return {
    userId: input.userId,
    conversationId,
    messageId: assistantMessage.id,
    question: input.question,
    mode: input.mode,
    model,
    llmKey,
    searchKey,
    history,
    startedAt,
  };
}

export async function runChat(prepared: PreparedChat, options: { signal: AbortSignal; emit: ChatEmit }): Promise<void> {
  const { signal, emit } = options;
  const { mode, model, llmKey, searchKey, question } = prepared;
  const sourceLimit = mode === "deep" ? DEEP_SOURCE_LIMIT : QUICK_SOURCE_LIMIT;
  const freshness = freshnessDays(question);

  emit("meta", { conversationId: prepared.conversationId, messageId: prepared.messageId });
  emit("stage", { stage: "queued", detail: mode === "deep" ? "Planning a research path" : "Understanding the question" });

  const usage: AccumulatedUsage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
  let searchRequests = 0;
  let content = "";
  let sources: Source[] = [];
  let finished = false;

  const complete = async (
    fields: Omit<Parameters<typeof completeAssistant>[0], "userId" | "messageId" | "usage" | "searchRequests">,
  ) => {
    const finalUsage = withSearchCost(usage, searchRequests, Date.now() - prepared.startedAt);
    await completeAssistant({
      ...fields,
      userId: prepared.userId,
      messageId: prepared.messageId,
      usage: finalUsage,
      searchRequests,
    });
    return finalUsage;
  };

  try {
    let queries = [question];
    if (mode === "deep") {
      emit("stage", { stage: "searching", detail: "Planning 3–5 sub-queries" });
      try {
        const plan = await chat({
          key: llmKey,
          model,
          messages: promptMessages(plannerPrompt(question)),
          maxTokens: 400,
          signal,
        });
        addUsage(usage, plan);
        queries = parseQueries(plan.content);
      } catch (error) {
        if (signal.aborted) throw error;
      }
      if (queries.length < 3) queries = [question];
      emit("plan", { queries });
    }

    emit("stage", {
      stage: "searching",
      detail: mode === "deep" ? `Searching 0 of ${queries.length}` : "Searching the web",
    });

    // A failed sub-query must not sink the run; the answer fails only if every search failed.
    let completed = 0;
    let firstSearchError: unknown;
    await runBounded(queries, 2, signal, async (query) => {
      try {
        const found = await searchSources(searchKey, query, { mode, freshnessDays: freshness, signal });
        searchRequests += 1;
        sources = dedupeSources([...sources, ...found], sourceLimit);
      } catch (error) {
        if (signal.aborted) return;
        firstSearchError ??= error;
      }
      completed += 1;
      emit("progress", { completed, total: queries.length });
      emit("stage", {
        stage: "searching",
        detail: mode === "deep" ? `Searching ${completed} of ${queries.length}` : "Searching the web",
      });
    });
    signal.throwIfAborted();
    if (searchRequests === 0 && firstSearchError) throw firstSearchError;

    if (mode === "deep" && sources.length < 4) {
      try {
        const review = await chat({
          key: llmKey,
          model,
          messages: promptMessages(gapPrompt({ question, subqueries: queries, sources })),
          maxTokens: 220,
          signal,
        });
        addUsage(usage, review);
        for (const query of parseGapQueries(review.content)) {
          const found = await searchSources(searchKey, query, { mode, freshnessDays: freshness, signal });
          searchRequests += 1;
          sources = dedupeSources([...sources, ...found], sourceLimit);
        }
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }

    emit("stage", {
      stage: "reading",
      detail: `Reading ${sources.length} ${sources.length === 1 ? "source" : "sources"}`,
    });
    emit("sources", sources);

    if (!sources.length) {
      content = NO_SOURCES_ANSWER;
      emit("stage", { stage: "no-sources", detail: "No usable sources found" });
      emit("delta", { text: content });
      const finalUsage = await complete({ content, status: "complete", noSources: true });
      finished = true;
      emit("usage", finalUsage);
      emit("done", { noSources: true });
      return;
    }

    const prompt =
      mode === "deep"
        ? deepPrompt({ question, sources, subqueries: queries, history: prepared.history })
        : quickPrompt({ question, sources, history: prepared.history });

    emit("stage", { stage: "writing", detail: `Writing with ${model}` });
    const seen = new Set<number>();
    const result = await chat({
      key: llmKey,
      model,
      messages: promptMessages(prompt),
      maxTokens: mode === "deep" ? 2500 : 1500,
      signal,
      onDelta: (text) => {
        content += text;
        emit("delta", { text });
        // A citation can only complete on a delta that contains its closing bracket.
        if (!text.includes("]")) return;
        for (const position of newCitations(content, sources.length, seen)) {
          emit("citation", { position });
        }
      },
    });

    addUsage(usage, result);
    content = sanitizeCitations(result.content || content, sources.length);
    const finalUsage = await complete({
      content,
      status: "complete",
      sources,
      uncited: !hasValidCitation(content, sources.length),
    });
    finished = true;
    emit("usage", finalUsage);
    emit("done", { noSources: false, truncated: result.finishReason === "length" });
  } catch (error) {
    if (finished) throw error;
    const aborted = signal.aborted || (error instanceof Error && error.name === "AbortError");
    const code = error instanceof ApiError ? error.code : "INTERNAL";
    const message = error instanceof ApiError ? error.message : "The answer could not be completed.";
    if (!aborted && !(error instanceof ApiError)) console.error(error);
    await complete({
      content: sanitizeCitations(content, sources.length),
      status: aborted ? "stopped" : "error",
      sources,
      errorCode: aborted ? undefined : code,
      errorMessage: aborted ? undefined : message,
    });
    if (aborted) {
      emit("stage", { stage: "stopped", detail: "Answer stopped" });
    } else {
      emit("error", { code, message, provider: error instanceof ApiError ? error.provider : undefined });
    }
  }
}

export function publicError(error: unknown): { code: string; message: string; provider?: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message, provider: error.provider };
  console.error(error);
  return { code: "INTERNAL", message: INTERNAL_ERROR_MESSAGE };
}

import { randomUUID } from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { DEFAULT_LLM_MODEL, isAllowedModel, isSearchProvider, searchProviderName } from "../providers";
import type { DoneEvent, Message, Mode, SearchProvider, SearchTrace, Source, Usage } from "../types";
import { isShutdown } from "./active-chats";
import { hasValidCitation, newCitations, sanitizeCitations } from "./citations";
import { decryptCredential } from "./crypto";
import { appUrl, isFakeProviders } from "./env";
import { ApiError, INTERNAL_ERROR_MESSAGE } from "./http";
import { detectLanguage } from "./language";
import { log } from "./log";
import {
  deepPrompt,
  gapPrompt,
  NO_SOURCES_ANSWER,
  PLANNER_REPAIR,
  plannerPrompt,
  quickPrompt,
  researchAgentPrompt,
  type Prompt,
  deeperPrompt,
} from "./prompts";
import { chat, search } from "./providers";
import { openRouterError, type ChatMessage, type ChatResult } from "./providers/openrouter";
import { rankSources } from "./ranking";
import {
  completeAssistant,
  conversationExists,
  createConversation,
  createExchange,
  ensureSettings,
  getCredentialRow,
  getHistory,
  recordCredentialUsage,
  type AssistantOutcome,
} from "./repo";

/** List-price estimate per search request. Provider-reported costs are not returned by the adapters yet. */
const SEARCH_COST_PER_REQUEST: Record<SearchProvider, number> = { brave: 0.005, tavily: 0.008, exa: 0.005 };
const QUICK_SOURCE_LIMIT = 8;
const DEEP_SOURCE_LIMIT = 20;
const DEEP_RESULTS_PER_QUERY = 6;
const MIN_DEEP_QUERIES = 3;
const MAX_DEEP_QUERIES = 5;
const MAX_GAP_QUERIES = 2;
const SEARCH_CONCURRENCY = 2;
const PLANNER_MAX_TOKENS = 2000;
const GAP_MAX_TOKENS = 1500;
const SYNTHESIS_MAX_TOKENS: Record<Mode, number> = { quick: 8192, deep: 16384, deeper: 24576 };
const DEEPER_SEARCH_LIMIT = 60;
const DEEPER_SOURCE_LIMIT = 60;
const DEEPER_QUERIES_PER_CALL = 4;
const DEEPER_MAX_STEPS = 24;
const DEEPER_AGENT_MAX_TOKENS = 4000;
/** Hard caps from the spec; on timeout the partial answer is kept and stored as stopped. */
export const TIMEOUT_MS: Record<Mode, number> = { quick: 60_000, deep: 90_000, deeper: 360_000 };

type ChatEvent =
  | { event: "meta"; data: { conversationId: string; messageId: string; userMessageId: string } }
  | { event: "stage"; data: { stage: string; detail?: string } }
  | { event: "plan"; data: { queries: string[] } }
  | { event: "search"; data: SearchTrace }
  | { event: "progress"; data: { completed: number; total: number } }
  | { event: "sources"; data: Source[] }
  | { event: "delta"; data: { text: string } }
  | { event: "reasoning"; data: { text: string } }
  | { event: "citation"; data: { position: number } }
  | { event: "usage"; data: Usage }
  | { event: "done"; data: DoneEvent }
  | { event: "error"; data: { code: string; message: string; provider?: string } };

export type ChatEmit = <T extends ChatEvent>(event: T["event"], data: T["data"]) => void;

export interface PreparedChat {
  userId: string;
  conversationId: string;
  messageId: string;
  userMessageId: string;
  question: string;
  mode: Mode;
  model: string;
  llmKey: string;
  searchProvider: SearchProvider;
  searchKey: string;
  searchCredentialId: string;
  searchPlan: "free" | "paid";
  history: Message[];
  startedAt: number;
}

interface RunContext {
  prepared: PreparedChat;
  signal: AbortSignal;
  emit: ChatEmit;
  freshnessDays?: number;
}

/** Everything a run accumulates; stored as the answer's outcome however the run ends. */
interface RunState {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  searchRequests: number;
  searchFailures: number;
  sources: Source[];
  searches: SearchTrace[];
  content: string;
  reasoning: string;
  degraded: boolean;
  resolvedModel?: string;
  upstreamProvider?: string;
}

function addUsage(state: RunState, result: ChatResult): void {
  state.promptTokens += result.usage.promptTokens;
  state.completionTokens += result.usage.completionTokens;
  state.costUsd += result.usage.costUsd;
}

function finalUsage(state: RunState, startedAt: number, searchProvider: SearchProvider): Usage {
  return {
    tokensIn: state.promptTokens,
    tokensOut: state.completionTokens,
    costUsd: Number(state.costUsd.toFixed(6)),
    searchCostUsd: Number((state.searchRequests * SEARCH_COST_PER_REQUEST[searchProvider]).toFixed(6)),
    latencyMs: Date.now() - startedAt,
    searchRequests: state.searchRequests,
    searchProvider,
    resolvedModel: state.resolvedModel,
    upstreamProvider: state.upstreamProvider,
  };
}

function promptMessages(prompt: Prompt): ChatMessage[] {
  return [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
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
    .slice(0, MAX_DEEP_QUERIES);
}

function parseGapQueries(text: string): string[] {
  const parsed = parseJsonObject(text) as { followUpQueries?: unknown } | null;
  if (!Array.isArray(parsed?.followUpQueries)) return [];
  return parsed.followUpQueries
    .filter((query): query is string => typeof query === "string")
    .map(normalizeQuery)
    .filter(Boolean)
    .slice(0, MAX_GAP_QUERIES);
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

function credentialMissing(provider: "openrouter" | SearchProvider): ApiError {
  const name = provider === "openrouter" ? "an OpenRouter" : `a ${searchProviderName(provider)}`;
  return new ApiError("CREDENTIAL_MISSING", `Add ${name} key before asking a question.`, 400, provider);
}

async function readKey(userId: string, row: Parameters<typeof decryptCredential>[1], provider: "openrouter" | SearchProvider) {
  try {
    return await decryptCredential(userId, row);
  } catch (error) {
    log.error("Stored credential could not be decrypted", error, { provider });
    return null;
  }
}

/**
 * Everything that can fail before streaming starts: settings, keys, conversation and the stored
 * exchange. Errors here are returned as plain JSON responses. A retry reuses the stored question
 * and replaces the failed or stopped answer.
 */
export async function prepareChat(input: {
  userId: string;
  conversationId?: string;
  mode: Mode;
  searchProvider?: SearchProvider;
  question?: string;
  retryOf?: string;
}): Promise<PreparedChat> {
  const startedAt = Date.now();
  const settings = await ensureSettings(input.userId);
  const model = isAllowedModel(settings.llmModel) ? settings.llmModel : DEFAULT_LLM_MODEL;
  const searchProvider =
    input.searchProvider && isSearchProvider(input.searchProvider) ? input.searchProvider : settings.defaultSearchProvider;

  const [llmCredential, searchCredential] = await Promise.all([
    getCredentialRow(input.userId, "llm", "openrouter"),
    getCredentialRow(input.userId, "search", searchProvider),
  ]);
  if (!llmCredential) throw credentialMissing("openrouter");
  if (!searchCredential) throw credentialMissing(searchProvider);
  const llmKey = await readKey(input.userId, llmCredential, "openrouter");
  const searchKey = await readKey(input.userId, searchCredential, searchProvider);
  for (const [key, provider] of [[llmKey, "openrouter"], [searchKey, searchProvider]] as const) {
    if (key === null) {
      throw new ApiError("CREDENTIAL_UNREADABLE", "Your saved key can no longer be read. Replace it in Settings.", 400, provider);
    }
  }

  let conversationId = input.conversationId;
  if (conversationId) {
    if (!(await conversationExists(input.userId, conversationId))) {
      throw new ApiError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    }
  } else {
    conversationId = (await createConversation(input.userId, input.mode)).id;
  }

  const { userMessage, assistantMessage, questionText } = await createExchange({
    userId: input.userId,
    conversationId,
    mode: input.mode,
    llmModel: model,
    searchProvider,
    question: input.question,
    retryOf: input.retryOf,
  });
  let history: Message[];
  try {
    history = await getHistory(input.userId, conversationId, userMessage.createdAt);
  } catch (error) {
    // The exchange is stored but will never run: close it now, or it blocks the conversation for minutes.
    await completeAssistant({
      userId: input.userId,
      messageId: assistantMessage.id,
      content: "",
      status: "error",
      errorCode: "INTERNAL",
      errorMessage: "The answer could not be started.",
    }).catch(() => {});
    throw error;
  }

  return {
    userId: input.userId,
    conversationId,
    messageId: assistantMessage.id,
    userMessageId: userMessage.id,
    question: questionText,
    mode: input.mode,
    model,
    llmKey: llmKey as string,
    searchProvider,
    searchKey: searchKey as string,
    searchCredentialId: searchCredential.id,
    searchPlan: searchCredential.provider === "brave" && searchCredential.plan === "paid" ? "paid" : "free",
    history,
    startedAt,
  };
}

async function searchSources(ctx: RunContext, query: string, count: number): Promise<Omit<Source, "position">[]> {
  const results = await search(ctx.prepared.searchProvider, ctx.prepared.searchKey, query, {
    count,
    freshnessDays: ctx.freshnessDays,
    signal: ctx.signal,
    plan: ctx.prepared.searchPlan,
  });
  await recordCredentialUsage(ctx.prepared.searchCredentialId, SEARCH_COST_PER_REQUEST[ctx.prepared.searchProvider]).catch(() => {});
  return results.map((result) => ({
    id: randomUUID(),
    title: result.title,
    url: result.url,
    domain: result.domain,
    snippet: result.snippet,
    publishedAt: result.publishedAt,
  }));
}

/** Deep planner with one repair attempt; falls back to the question itself (a degraded Deep run). */
async function planQueries(ctx: RunContext, state: RunState): Promise<string[]> {
  const { prepared, signal } = ctx;
  ctx.emit("stage", { stage: "searching", detail: "Planning 3–5 sub-queries" });
  const messages = promptMessages(plannerPrompt(prepared.question));
  try {
    const plan = await chat({ purpose: "plan", key: prepared.llmKey, model: prepared.model, messages, maxTokens: PLANNER_MAX_TOKENS, signal });
    addUsage(state, plan);
    let queries = parseQueries(plan.content);
    if (queries.length < MIN_DEEP_QUERIES) {
      const repaired = await chat({
        purpose: "plan",
        key: prepared.llmKey,
        model: prepared.model,
        messages: [...messages, { role: "assistant", content: plan.content }, { role: "user", content: PLANNER_REPAIR }],
        maxTokens: PLANNER_MAX_TOKENS,
        signal,
      });
      addUsage(state, repaired);
      queries = parseQueries(repaired.content);
    }
    if (queries.length >= MIN_DEEP_QUERIES) return queries;
  } catch (error) {
    if (signal.aborted) throw error;
    log.warn("Deep planner failed", { code: error instanceof ApiError ? error.code : "INTERNAL" });
  }
  state.degraded = true;
  return [prepared.question];
}

function isSearchOutage(error: unknown): boolean {
  return !(error instanceof ApiError) || error.code === "PROVIDER_UNAVAILABLE" || error.code === "PROVIDER_ERROR";
}

/** Searches every query (two at a time) and ranks the results. Fails only if every search failed. */
async function retrieveSources(
  ctx: RunContext,
  state: RunState,
  queries: string[],
  options: { append?: boolean } = {},
): Promise<void> {
  const { mode } = ctx.prepared;
  const report = mode !== "quick";
  const sourceLimit = mode === "deeper" ? DEEPER_SOURCE_LIMIT : report ? DEEP_SOURCE_LIMIT : QUICK_SOURCE_LIMIT;
  ctx.emit("stage", { stage: "searching", detail: report ? `Searching 0 of ${queries.length}` : "Searching the web" });

  const batches: Omit<Source, "position">[][] = [];
  let completed = 0;
  let firstError: unknown;
  await runBounded(queries, SEARCH_CONCURRENCY, ctx.signal, async (query, index) => {
    const traceIndex = state.searches.push({ query, status: "searching" }) - 1;
    ctx.emit("search", state.searches[traceIndex]);
    try {
      batches[index] = await searchSources(ctx, query, report ? DEEP_RESULTS_PER_QUERY : QUICK_SOURCE_LIMIT);
      state.searchRequests += 1;
      state.searches[traceIndex] = { query, status: "done", results: batches[index].length };
      ctx.emit("search", state.searches[traceIndex]);
    } catch (error) {
      if (ctx.signal.aborted) return;
      state.searchFailures += 1;
      state.searches[traceIndex] = { query, status: "failed", results: 0 };
      ctx.emit("search", state.searches[traceIndex]);
      firstError ??= error;
      batches[index] = [];
    }
    completed += 1;
    ctx.emit("progress", { completed, total: queries.length });
    ctx.emit("stage", {
      stage: "searching",
      detail: report ? `Searching ${completed} of ${queries.length}` : "Searching the web",
    });
  });
  ctx.signal.throwIfAborted();

  if (state.searchRequests === 0 && firstError) {
    if (!isSearchOutage(firstError)) throw firstError;
    throw new ApiError("SEARCH_FAILED", "Every web search failed, so no answer was written. Try again shortly.", 502, ctx.prepared.searchProvider);
  }
  const ranked = rankSources(batches.filter(Boolean), {
    limit: options.append ? sourceLimit - state.sources.length : sourceLimit,
    perSite: report ? 3 : 2,
    exclude: options.append ? state.sources : undefined,
    startPosition: options.append ? state.sources.length + 1 : 1,
  });
  state.sources = options.append ? [...state.sources, ...ranked] : ranked;
}

/** Deep only: when evidence is thin, at most two follow-up searches appended without renumbering. */
async function fillEvidenceGaps(ctx: RunContext, state: RunState, queries: string[]): Promise<void> {
  const { prepared, signal } = ctx;
  if (prepared.mode !== "deep" || state.sources.length >= 4) return;
  try {
    const review = await chat({
      purpose: "gap",
      key: prepared.llmKey,
      model: prepared.model,
      messages: promptMessages(gapPrompt({ question: prepared.question, subqueries: queries, sources: state.sources })),
      maxTokens: GAP_MAX_TOKENS,
      signal,
    });
    addUsage(state, review);
    const batches: Omit<Source, "position">[][] = [];
    for (const query of parseGapQueries(review.content)) {
      const traceIndex = state.searches.push({ query, status: "searching" }) - 1;
      ctx.emit("search", state.searches[traceIndex]);
      try {
        const found = await searchSources(ctx, query, DEEP_RESULTS_PER_QUERY);
        batches.push(found);
        state.searchRequests += 1;
        state.searches[traceIndex] = { query, status: "done", results: found.length };
        ctx.emit("search", state.searches[traceIndex]);
      } catch (error) {
        if (signal.aborted) throw error;
        state.searches[traceIndex] = { query, status: "failed", results: 0 };
        ctx.emit("search", state.searches[traceIndex]);
        state.searchFailures += 1;
      }
    }
    const added = rankSources(batches, {
      limit: DEEP_SOURCE_LIMIT - state.sources.length,
      perSite: 3,
      exclude: state.sources,
      startPosition: state.sources.length + 1,
    });
    state.sources = [...state.sources, ...added];
  } catch (error) {
    if (signal.aborted) throw error;
  }
}

/**
 * Deeper research: an AI SDK tool loop. The model decides which searches to run; each tool call
 * appends ranked sources with stable citation numbers. The final answer is written separately so
 * the existing streaming, citation and cost contract stays unchanged.
 */
async function runDeeperResearch(ctx: RunContext, state: RunState): Promise<void> {
  const { prepared, signal, emit } = ctx;
  if (isFakeProviders()) {
    await retrieveSources(ctx, state, [
      "fixture deeper overview",
      "fixture deeper developments",
      "fixture deeper limitations",
    ]);
    return;
  }
  const asked = new Set<string>();
  const openrouter = createOpenRouter({
    apiKey: prepared.llmKey,
    appName: "Beamling",
    headers: { "HTTP-Referer": appUrl() },
    compatibility: "strict",
  });

  const searchTool = tool({
    description:
      `Search the web with ${searchProviderName(prepared.searchProvider)}. Use 1–4 short keyword queries per call. Returns compact result summaries and the total number of sources collected. The final writer sees the full source set.`,
    inputSchema: z.object({
      queries: z.array(z.string().min(2).max(180)).min(1).max(DEEPER_QUERIES_PER_CALL).describe("1–4 distinct search queries"),
    }),
    execute: async ({ queries }) => {
      const remaining = DEEPER_SEARCH_LIMIT - state.searches.length;
      if (remaining <= 0) {
        return { queries: [], results: [], totalSources: state.sources.length, searchesRemaining: 0, message: "Search budget exhausted." };
      }
      const unique: string[] = [];
      const skipped: string[] = [];
      for (const raw of queries.slice(0, remaining)) {
        const query = normalizeQuery(raw);
        const key = query.toLowerCase();
        if (!query) continue;
        if (asked.has(key)) skipped.push(query);
        else {
          asked.add(key);
          unique.push(query);
        }
      }
      if (!unique.length) {
        return {
          queries: [],
          skipped,
          results: [],
          totalSources: state.sources.length,
          searchesRemaining: remaining,
          message: "Those queries were already searched. Try a different angle.",
        };
      }

      emit("stage", {
        stage: "searching",
        detail: `Researching ${unique.length} ${unique.length === 1 ? "query" : "queries"} · ${state.searches.length} of ${DEEPER_SEARCH_LIMIT} searches`,
      });
      const batches: Omit<Source, "position">[][] = [];
      const traceIndexes: number[] = [];
      let completed = 0;
      await runBounded(unique, SEARCH_CONCURRENCY, signal, async (query, index) => {
        const traceIndex = state.searches.push({ query, status: "searching" }) - 1;
        traceIndexes.push(traceIndex);
        emit("search", state.searches[traceIndex]);
        try {
          const found = await searchSources(ctx, query, DEEP_RESULTS_PER_QUERY);
          batches[index] = found;
          state.searchRequests += 1;
          state.searches[traceIndex] = { query, status: "done", results: found.length };
          emit("search", state.searches[traceIndex]);
        } catch (error) {
          if (signal.aborted) return;
          state.searchFailures += 1;
          batches[index] = [];
          state.searches[traceIndex] = { query, status: "failed", results: 0 };
          emit("search", state.searches[traceIndex]);
          log.warn("Deeper search failed", { code: error instanceof ApiError ? error.code : "INTERNAL" });
        }
        completed += 1;
        emit("progress", { completed, total: unique.length });
      });
      signal.throwIfAborted();

      const added = rankSources(batches, {
        limit: DEEPER_SOURCE_LIMIT - state.sources.length,
        perSite: 3,
        exclude: state.sources,
        startPosition: state.sources.length + 1,
      });
      state.sources = [...state.sources, ...added];
      const recent = state.searches
        .slice(-Math.max(1, traceIndexes.length))
        .map((trace) => `${trace.query}: ${trace.status === "done" ? `${trace.results ?? 0} results` : trace.status}`);

      emit("stage", {
        stage: "searching",
        detail: `Found ${state.sources.length} ${state.sources.length === 1 ? "source" : "sources"} · ${state.searches.length} searches`,
      });
      return {
        queries: unique,
        skipped,
        results: added.slice(0, 8).map((source) => ({
          position: source.position,
          title: source.title,
          domain: source.domain,
          snippet: source.snippet.slice(0, 320),
        })),
        newSources: added.length,
        totalSources: state.sources.length,
        searchesRemaining: Math.max(0, DEEPER_SEARCH_LIMIT - state.searches.length),
        recent,
        message:
          state.searches.length >= DEEPER_SEARCH_LIMIT
            ? "Search budget exhausted. Stop searching and summarize coverage."
            : "Continue only if a material gap remains.",
      };
    },
  });

  const agent = new ToolLoopAgent({
    model: openrouter.chat(prepared.model),
    instructions: researchAgentPrompt(),
    tools: { search: searchTool },
    temperature: 0.2,
    maxOutputTokens: DEEPER_AGENT_MAX_TOKENS,
    toolChoice: "auto",
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0 ? { toolChoice: { type: "tool", toolName: "search" } } : {},
    stopWhen: [
      isStepCount(DEEPER_MAX_STEPS),
      () => state.searches.length >= DEEPER_SEARCH_LIMIT || state.sources.length >= DEEPER_SOURCE_LIMIT,
    ],
    providerOptions: { openrouter: { usage: { include: true } } },
  });

  emit("stage", { stage: "searching", detail: "Researching with up to 60 searches" });
  let result;
  try {
    result = await agent.generate({ prompt: prepared.question, abortSignal: signal });
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof APICallError) {
      throw openRouterError(error.statusCode ?? 502, error.responseBody ?? error.message);
    }
    throw error;
  }

  for (const step of result.steps) {
    state.promptTokens += step.usage.inputTokens ?? 0;
    state.completionTokens += step.usage.outputTokens ?? 0;
    const metadata = step.providerMetadata?.openrouter as
      | { provider?: string; usage?: { cost?: number } }
      | undefined;
    state.costUsd += metadata?.usage?.cost ?? 0;
    state.resolvedModel = step.response.modelId || state.resolvedModel;
    state.upstreamProvider = metadata?.provider || state.upstreamProvider;
  }
  if (!state.sources.length && state.searchFailures > 0) {
    throw new ApiError("SEARCH_FAILED", "Every web search failed, so no answer was written. Try again shortly.", 502, ctx.prepared.searchProvider);
  }
}

/** Streams the final answer and emits citations as they complete. */
async function streamSynthesis(ctx: RunContext, state: RunState, queries: string[]): Promise<ChatResult> {
  const { prepared, signal, emit } = ctx;
  const language = detectLanguage(prepared.question);
  const prompt =
    prepared.mode === "deeper"
      ? deeperPrompt({ question: prepared.question, sources: state.sources, queries, history: prepared.history, language })
      : prepared.mode === "deep"
        ? deepPrompt({ question: prepared.question, sources: state.sources, subqueries: queries, history: prepared.history, language })
        : quickPrompt({ question: prepared.question, sources: state.sources, history: prepared.history, language });

  emit("stage", { stage: "writing", detail: `Writing with ${prepared.model}` });
  const seen = new Set<number>();
  const result = await chat({
    purpose: "answer",
    key: prepared.llmKey,
    model: prepared.model,
    messages: promptMessages(prompt),
    maxTokens: SYNTHESIS_MAX_TOKENS[prepared.mode],
    signal,
    onReasoning: (text) => {
      state.reasoning += text;
      emit("reasoning", { text });
    },
    onDelta: (text) => {
      state.content += text;
      emit("delta", { text });
      // A citation can only complete on a delta that contains its closing bracket.
      if (!text.includes("]")) return;
      for (const position of newCitations(state.content, state.sources.length, seen)) {
        emit("citation", { position });
      }
    },
  });
  addUsage(state, result);
  state.resolvedModel = result.model;
  state.upstreamProvider = result.provider;
  return result;
}

/** How an aborted run ends: a user stop, the time limit, or a server shutdown. */
function abortOutcome(signal: AbortSignal, mode: Mode) {
  const reason: unknown = signal.reason;
  if (isShutdown(reason)) {
    return {
      status: "error" as const,
      errorCode: "INTERRUPTED",
      errorMessage: "The server restarted while this answer was being written.",
    };
  }
  if (reason instanceof DOMException && reason.name === "TimeoutError") {
    return {
      status: "stopped" as const,
      errorCode: "GENERATION_TIMEOUT",
      errorMessage: `The answer reached the ${TIMEOUT_MS[mode] / 1000}-second limit.`,
    };
  }
  return { status: "stopped" as const };
}

export async function runChat(prepared: PreparedChat, options: { signal: AbortSignal; emit: ChatEmit }): Promise<void> {
  const { signal, emit } = options;
  const ctx: RunContext = { prepared, signal, emit, freshnessDays: freshnessDays(prepared.question) };
  const state: RunState = {
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    searchRequests: 0,
    searchFailures: 0,
    sources: [],
    searches: [],
    content: "",
    reasoning: "",
    degraded: false,
  };
  let finished = false;

  const complete = async (fields: Omit<AssistantOutcome, "userId" | "messageId" | "usage" | "searches" | "reasoning">) => {
    const usage = finalUsage(state, prepared.startedAt, prepared.searchProvider);
    await completeAssistant({
      degraded: state.degraded,
      searchFailures: state.searchFailures,
      searches: state.searches,
      reasoning: state.reasoning || undefined,
      ...fields,
      userId: prepared.userId,
      messageId: prepared.messageId,
      usage,
    });
    return usage;
  };

  emit("meta", {
    conversationId: prepared.conversationId,
    messageId: prepared.messageId,
    userMessageId: prepared.userMessageId,
  });
  emit("stage", {
    stage: "queued",
    detail:
      prepared.mode === "deeper"
        ? "Starting deeper research"
        : prepared.mode === "deep"
          ? "Planning a research path"
          : "Understanding the question",
  });

  try {
    let queries: string[] = [];
    if (prepared.mode === "deeper") {
      await runDeeperResearch(ctx, state);
      queries = state.searches.map((trace) => trace.query);
    } else {
      queries = prepared.mode === "deep" ? await planQueries(ctx, state) : [prepared.question];
      if (prepared.mode === "deep") emit("plan", { queries });
      await retrieveSources(ctx, state, queries);
      await fillEvidenceGaps(ctx, state, queries);
    }

    emit("stage", {
      stage: "reading",
      detail: `Reading ${state.sources.length} ${state.sources.length === 1 ? "source" : "sources"}`,
    });
    emit("sources", state.sources);

    if (!state.sources.length) {
      state.content = NO_SOURCES_ANSWER;
      emit("stage", { stage: "no-sources", detail: "No usable sources found" });
      emit("delta", { text: state.content });
      const usage = await complete({ content: state.content, status: "complete", noSources: true });
      finished = true;
      emit("usage", usage);
      emit("done", { noSources: true, degraded: state.degraded, searchFailures: state.searchFailures });
      return;
    }

    const result = await streamSynthesis(ctx, state, queries);
    const content = sanitizeCitations(result.content || state.content, state.sources.length);
    const truncated = result.finishReason === "length";
    const usage = await complete({
      content,
      status: "complete",
      sources: state.sources,
      uncited: !hasValidCitation(content, state.sources.length),
      truncated,
    });
    finished = true;
    emit("usage", usage);
    emit("done", { noSources: false, truncated, degraded: state.degraded, searchFailures: state.searchFailures });
  } catch (error) {
    if (finished) throw error;
    const aborted = signal.aborted || (error instanceof Error && error.name === "AbortError");
    if (aborted) {
      const outcome = abortOutcome(signal, prepared.mode);
      await complete({ content: sanitizeCitations(state.content, state.sources.length), sources: state.sources, ...outcome });
      if (outcome.status === "stopped") {
        emit("stage", { stage: "stopped", detail: outcome.errorMessage ?? "Answer stopped" });
      } else {
        emit("error", { code: outcome.errorCode, message: outcome.errorMessage });
      }
      return;
    }

    const code = error instanceof ApiError ? error.code : "INTERNAL";
    const message = error instanceof ApiError ? error.message : "The answer could not be completed.";
    if (!(error instanceof ApiError)) log.error("Answer failed", error);
    await complete({
      content: sanitizeCitations(state.content, state.sources.length),
      status: "error",
      sources: state.sources,
      errorCode: code,
      errorMessage: message,
    });
    emit("error", { code, message, provider: error instanceof ApiError ? error.provider : undefined });
  }
}

export function publicError(error: unknown): { code: string; message: string; provider?: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message, provider: error.provider };
  log.error("Answer stream failed", error);
  return { code: "INTERNAL", message: INTERNAL_ERROR_MESSAGE };
}

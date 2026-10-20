import { randomUUID } from "node:crypto";
import { DEFAULT_LLM_MODEL, isAllowedModel } from "../providers";
import type { DoneEvent, Message, Mode, Source, Usage } from "../types";
import { isShutdown } from "./active-chats";
import { hasValidCitation, newCitations, sanitizeCitations } from "./citations";
import { decryptCredential } from "./crypto";
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
  type Prompt,
} from "./prompts";
import { chat, search } from "./providers";
import type { ChatMessage, ChatResult } from "./providers/openrouter";
import { rankSources } from "./ranking";
import {
  completeAssistant,
  conversationExists,
  createConversation,
  createExchange,
  ensureSettings,
  getCredentialRow,
  getHistory,
  type AssistantOutcome,
} from "./repo";

/** Brave's list price per Web Search request; shown as an estimate. */
const BRAVE_COST_PER_REQUEST = 0.005;
const QUICK_SOURCE_LIMIT = 8;
const DEEP_SOURCE_LIMIT = 20;
const DEEP_RESULTS_PER_QUERY = 6;
const MIN_DEEP_QUERIES = 3;
const MAX_DEEP_QUERIES = 5;
const MAX_GAP_QUERIES = 2;
const SEARCH_CONCURRENCY = 2;
/** Hard caps from the spec; on timeout the partial answer is kept and stored as stopped. */
export const TIMEOUT_MS: Record<Mode, number> = { quick: 60_000, deep: 90_000 };

type ChatEvent =
  | { event: "meta"; data: { conversationId: string; messageId: string; userMessageId: string } }
  | { event: "stage"; data: { stage: string; detail?: string } }
  | { event: "plan"; data: { queries: string[] } }
  | { event: "progress"; data: { completed: number; total: number } }
  | { event: "sources"; data: Source[] }
  | { event: "delta"; data: { text: string } }
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
  searchKey: string;
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
  content: string;
  degraded: boolean;
  resolvedModel?: string;
  upstreamProvider?: string;
}

function addUsage(state: RunState, result: ChatResult): void {
  state.promptTokens += result.usage.promptTokens;
  state.completionTokens += result.usage.completionTokens;
  state.costUsd += result.usage.costUsd;
}

function finalUsage(state: RunState, startedAt: number): Usage {
  return {
    tokensIn: state.promptTokens,
    tokensOut: state.completionTokens,
    costUsd: Number(state.costUsd.toFixed(6)),
    searchCostUsd: Number((state.searchRequests * BRAVE_COST_PER_REQUEST).toFixed(6)),
    latencyMs: Date.now() - startedAt,
    searchRequests: state.searchRequests,
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

function credentialMissing(provider: "openrouter" | "brave"): ApiError {
  const name = provider === "openrouter" ? "an OpenRouter" : "a Brave Search";
  return new ApiError("CREDENTIAL_MISSING", `Add ${name} key before asking a question.`, 400, provider);
}

function readKey(userId: string, row: Parameters<typeof decryptCredential>[1], provider: "openrouter" | "brave") {
  try {
    return decryptCredential(userId, row);
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
  question?: string;
  retryOf?: string;
}): Promise<PreparedChat> {
  const startedAt = Date.now();
  const settings = await ensureSettings(input.userId);
  const model = isAllowedModel(settings.llmModel) ? settings.llmModel : DEFAULT_LLM_MODEL;

  const [llmCredential, searchCredential] = await Promise.all([
    getCredentialRow(input.userId, "llm", "openrouter"),
    getCredentialRow(input.userId, "search", "brave"),
  ]);
  if (!llmCredential) throw credentialMissing("openrouter");
  if (!searchCredential) throw credentialMissing("brave");
  const llmKey = readKey(input.userId, llmCredential, "openrouter");
  const searchKey = readKey(input.userId, searchCredential, "brave");
  for (const [key, provider] of [[llmKey, "openrouter"], [searchKey, "brave"]] as const) {
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

  const { userMessage, assistantMessage } = await createExchange({
    userId: input.userId,
    conversationId,
    mode: input.mode,
    llmModel: model,
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
    question: userMessage.content,
    mode: input.mode,
    model,
    llmKey: llmKey as string,
    searchKey: searchKey as string,
    history,
    startedAt,
  };
}

async function searchSources(ctx: RunContext, query: string, count: number): Promise<Omit<Source, "position">[]> {
  const results = await search("brave", ctx.prepared.searchKey, query, {
    count,
    freshnessDays: ctx.freshnessDays,
    signal: ctx.signal,
  });
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
    const plan = await chat({ purpose: "plan", key: prepared.llmKey, model: prepared.model, messages, maxTokens: 400, signal });
    addUsage(state, plan);
    let queries = parseQueries(plan.content);
    if (queries.length < MIN_DEEP_QUERIES) {
      const repaired = await chat({
        purpose: "plan",
        key: prepared.llmKey,
        model: prepared.model,
        messages: [...messages, { role: "assistant", content: plan.content }, { role: "user", content: PLANNER_REPAIR }],
        maxTokens: 400,
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
async function retrieveSources(ctx: RunContext, state: RunState, queries: string[]): Promise<void> {
  const { mode } = ctx.prepared;
  const deep = mode === "deep";
  ctx.emit("stage", { stage: "searching", detail: deep ? `Searching 0 of ${queries.length}` : "Searching the web" });

  const batches: Omit<Source, "position">[][] = [];
  let completed = 0;
  let firstError: unknown;
  await runBounded(queries, SEARCH_CONCURRENCY, ctx.signal, async (query, index) => {
    try {
      batches[index] = await searchSources(ctx, query, deep ? DEEP_RESULTS_PER_QUERY : QUICK_SOURCE_LIMIT);
      state.searchRequests += 1;
    } catch (error) {
      if (ctx.signal.aborted) return;
      state.searchFailures += 1;
      firstError ??= error;
      batches[index] = [];
    }
    completed += 1;
    ctx.emit("progress", { completed, total: queries.length });
    ctx.emit("stage", {
      stage: "searching",
      detail: deep ? `Searching ${completed} of ${queries.length}` : "Searching the web",
    });
  });
  ctx.signal.throwIfAborted();

  if (state.searchRequests === 0 && firstError) {
    if (!isSearchOutage(firstError)) throw firstError;
    throw new ApiError("SEARCH_FAILED", "Every web search failed, so no answer was written. Try again shortly.", 502, "brave");
  }
  state.sources = rankSources(batches.filter(Boolean), {
    limit: deep ? DEEP_SOURCE_LIMIT : QUICK_SOURCE_LIMIT,
    perSite: deep ? 3 : 2,
  });
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
      maxTokens: 220,
      signal,
    });
    addUsage(state, review);
    const batches: Omit<Source, "position">[][] = [];
    for (const query of parseGapQueries(review.content)) {
      try {
        batches.push(await searchSources(ctx, query, DEEP_RESULTS_PER_QUERY));
        state.searchRequests += 1;
      } catch (error) {
        if (signal.aborted) throw error;
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

/** Streams the final answer and emits citations as they complete. */
async function streamSynthesis(ctx: RunContext, state: RunState, queries: string[]): Promise<ChatResult> {
  const { prepared, signal, emit } = ctx;
  const language = detectLanguage(prepared.question);
  const prompt =
    prepared.mode === "deep"
      ? deepPrompt({ question: prepared.question, sources: state.sources, subqueries: queries, history: prepared.history, language })
      : quickPrompt({ question: prepared.question, sources: state.sources, history: prepared.history, language });

  emit("stage", { stage: "writing", detail: `Writing with ${prepared.model}` });
  const seen = new Set<number>();
  const result = await chat({
    purpose: "answer",
    key: prepared.llmKey,
    model: prepared.model,
    messages: promptMessages(prompt),
    maxTokens: prepared.mode === "deep" ? 2500 : 1500,
    signal,
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
    content: "",
    degraded: false,
  };
  let finished = false;

  const complete = async (fields: Omit<AssistantOutcome, "userId" | "messageId" | "usage">) => {
    const usage = finalUsage(state, prepared.startedAt);
    await completeAssistant({
      degraded: state.degraded,
      searchFailures: state.searchFailures,
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
    detail: prepared.mode === "deep" ? "Planning a research path" : "Understanding the question",
  });

  try {
    const queries = prepared.mode === "deep" ? await planQueries(ctx, state) : [prepared.question];
    if (prepared.mode === "deep") emit("plan", { queries });
    await retrieveSources(ctx, state, queries);
    await fillEvidenceGaps(ctx, state, queries);

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

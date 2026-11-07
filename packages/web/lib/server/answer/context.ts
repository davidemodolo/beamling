import { randomUUID } from "node:crypto";
import type { CredentialProvider } from "../../contracts";
import { providerName, PROVIDERS, type ModelInfo } from "../../provider-catalog";
import type { Message, Mode, SearchProvider, SearchTrace, Source, Usage } from "../../types";
import { ApiError } from "../http";
import type { Prompt } from "../prompts";
import { search } from "../providers";
import type { ChatMessage, ChatResult } from "../providers/llm";
import { rankSources } from "../ranking";
import { recordCredentialUsage } from "../repo";

/** List-price estimate per search request, from the catalog. Adapters do not report search costs. */
export const searchCostPerRequest = (provider: SearchProvider): number => PROVIDERS[provider].searchCostUsd ?? 0;
export const QUICK_SOURCE_LIMIT = 8;
export const DEEP_SOURCE_LIMIT = 20;
export const DEEP_RESULTS_PER_QUERY = 6;
export const DEEPER_SOURCE_LIMIT = 60;
export const SEARCH_CONCURRENCY = 2;
/** Hard caps from the spec; on timeout the partial answer is kept and stored as stopped. */
export const TIMEOUT_MS: Record<Mode, number> = { quick: 60_000, deep: 90_000, deeper: 360_000 };

type ChatEvent = import("../../stream-events").StreamEvent;

export type ChatEmit = <T extends ChatEvent>(event: T["event"], data: T["data"]) => void;

export interface PreparedChat {
  userId: string;
  conversationId: string;
  messageId: string;
  userMessageId: string;
  question: string;
  mode: Mode;
  /** The model id stored with the answer. */
  model: string;
  llm: ModelInfo;
  llmKey: string;
  searchProvider: SearchProvider;
  searchKey: string;
  searchCredentialId: string;
  searchPlan: "free" | "paid";
  history: Message[];
  startedAt: number;
  /** Conversations deleted to keep the account within MAX_CONVERSATIONS. */
  removed: string[];
}

export interface RunContext {
  prepared: PreparedChat;
  signal: AbortSignal;
  emit: ChatEmit;
  freshnessDays?: number;
}

/** Everything a run accumulates; stored as the answer's outcome however the run ends. */
export interface RunState {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  searchRequests: number;
  searchFailures: number;
  sources: Source[];
  searches: SearchTrace[];
  searchesReserved: number;
  content: string;
  reasoning: string;
  degraded: boolean;
  resolvedModel?: string;
  upstreamProvider?: string;
}

export type SourceBatch = Omit<Source, "position">[];

export function newRunState(): RunState {
  return {
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    searchRequests: 0,
    searchFailures: 0,
    sources: [],
    searches: [],
    searchesReserved: 0,
    content: "",
    reasoning: "",
    degraded: false,
  };
}

export function addUsage(state: RunState, result: ChatResult): void {
  state.promptTokens += result.usage.promptTokens;
  state.completionTokens += result.usage.completionTokens;
  state.costUsd += result.usage.costUsd;
}

export function finalUsage(state: RunState, startedAt: number, searchProvider: SearchProvider): Usage {
  return {
    tokensIn: state.promptTokens,
    tokensOut: state.completionTokens,
    costUsd: Number(state.costUsd.toFixed(6)),
    searchCostUsd: Number((state.searchRequests * searchCostPerRequest(searchProvider)).toFixed(6)),
    latencyMs: Date.now() - startedAt,
    searchRequests: state.searchRequests,
    searchProvider,
    resolvedModel: state.resolvedModel,
    upstreamProvider: state.upstreamProvider,
  };
}

export function promptMessages(prompt: Prompt): ChatMessage[] {
  return [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];
}

export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, 180);
}

/** A provider outage (or an unexpected error), as opposed to a terminal key or plan error. */
export function isSearchOutage(error: unknown): boolean {
  return !(error instanceof ApiError) || error.code === "PROVIDER_UNAVAILABLE" || error.code === "PROVIDER_ERROR";
}

export function everySearchFailed(provider: SearchProvider): ApiError {
  return new ApiError("SEARCH_FAILED", "Every web search failed, so no answer was written. Try again shortly.", 502, provider);
}

export function credentialMissing(provider: CredentialProvider): ApiError {
  return new ApiError("CREDENTIAL_MISSING", `Add your ${providerName(provider)} key before asking a question.`, 400, provider);
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

async function searchSources(ctx: RunContext, query: string, count: number): Promise<SourceBatch> {
  const results = await search(ctx.prepared.searchProvider, ctx.prepared.searchKey, query, {
    count,
    freshnessDays: ctx.freshnessDays,
    signal: ctx.signal,
    plan: ctx.prepared.searchPlan,
  });
  await recordCredentialUsage(ctx.prepared.searchCredentialId, searchCostPerRequest(ctx.prepared.searchProvider)).catch(() => {});
  return results.map((result) => ({
    id: randomUUID(),
    title: result.title,
    url: result.url,
    domain: result.domain,
    snippet: result.snippet,
    publishedAt: result.publishedAt,
  }));
}

function updateTrace(state: RunState, emit: ChatEmit, index: number, trace: SearchTrace): void {
  state.searches[index] = trace;
  emit("search", trace);
}

/**
 * Searches each query on the selected provider, `concurrency` at a time, recording a visible trace
 * per search. A failed search yields an empty batch and its error; an abort stops the run and throws.
 */
export async function runSearches(
  ctx: RunContext,
  state: RunState,
  queries: string[],
  options: { count: number; concurrency: number; onSettled?: (completed: number) => void },
): Promise<{ batches: SourceBatch[]; errors: unknown[] }> {
  const batches: SourceBatch[] = [];
  const errors: unknown[] = [];
  let completed = 0;
  await runBounded(queries, options.concurrency, ctx.signal, async (query, index) => {
    const traceIndex = state.searches.push({ query, status: "searching" }) - 1;
    ctx.emit("search", state.searches[traceIndex]);
    try {
      batches[index] = await searchSources(ctx, query, options.count);
      state.searchRequests += 1;
      updateTrace(state, ctx.emit, traceIndex, { query, status: "done", results: batches[index].length });
    } catch (error) {
      if (ctx.signal.aborted) return;
      state.searchFailures += 1;
      updateTrace(state, ctx.emit, traceIndex, { query, status: "failed", results: 0 });
      errors.push(error);
      batches[index] = [];
    }
    completed += 1;
    options.onSettled?.(completed);
  });
  ctx.signal.throwIfAborted();
  return { batches, errors };
}

/** Ranks new results after the existing sources, without renumbering them, up to `limit` in total. */
export function appendSources(state: RunState, batches: SourceBatch[], limit: number, perSite = 3): Source[] {
  const added = rankSources(batches, {
    limit: limit - state.sources.length,
    perSite,
    exclude: state.sources,
    startPosition: state.sources.length + 1,
  });
  state.sources = [...state.sources, ...added];
  return added;
}

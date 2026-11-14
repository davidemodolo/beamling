import { randomUUID } from "node:crypto";
import { isImage, type Attachment, type FileUpload, type ImageUpload } from "../../attachments";
import type { BravePlan, CredentialProvider } from "../../contracts";
import { providerName, PROVIDERS, type ModelInfo } from "../../provider-catalog";
import type { Message, Mode, SearchProvider, SearchTrace, Source, Usage } from "../../types";
import { ApiError } from "../http";
import { fileBlocks, promptQuestion, type Prompt, type VisibleImages } from "../prompts";
import { search } from "../providers";
import type { ChatMessage, ChatPart, ChatResult } from "../providers/llm";
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
export const TIMEOUT_MS: Record<Mode, number> = { quick: 60_000, deep: 180_000, deeper: 360_000 };
/**
 * Share of the time limit for gathering sources. When it runs out, research stops and the answer
 * is written from the sources found so far, so slow models still get time to write.
 */
export const RESEARCH_SHARE = 0.5;

type ChatEvent = import("../../stream-events").StreamEvent;

export type ChatEmit = <T extends ChatEvent>(event: T["event"], data: T["data"]) => void;

export interface PreparedChat {
  userId: string;
  conversationId: string;
  messageId: string;
  userMessageId: string;
  /** The question as typed; empty when it is only attachments. */
  question: string;
  /** The question's images and text files, as stored (id, and type or name). */
  attachments: Attachment[];
  /**
   * Image bytes the model will see: the question's and those of earlier questions in the history
   * window that the browser still has. Empty when the model does not read images.
   */
  images: ImageUpload[];
  /**
   * Text files the model will see: the question's and those of earlier questions in the history
   * window that the browser still has.
   */
  files: FileUpload[];
  /** Ids of `images` and `files`, for prompts that say whether an attachment is included. */
  imageIds: VisibleImages;
  mode: Mode;
  llm: ModelInfo;
  llmKey: string;
  searchProvider: SearchProvider;
  searchKey: string;
  searchCredentialId: string;
  searchPlan: BravePlan;
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
  /** Research stopped at its share of the time limit. */
  researchCut?: boolean;
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

/** A user message; images go before the text. */
export function userMessage(text: string, images: ChatPart[] = []) {
  return { role: "user" as const, content: images.length ? [...images, { type: "text" as const, text }] : text };
}

/** The prompt as messages. */
export function promptMessages(prompt: Prompt, images: ChatPart[] = []): ChatMessage[] {
  return [{ role: "system", content: prompt.system }, userMessage(prompt.user, images)];
}

/**
 * The question as prompts state it: what was typed, a marker per attachment, then the text of the
 * files the model can see. Every step that reads the question (planner, research, writer) gets them.
 */
export function askedQuestion(prepared: PreparedChat): string {
  const question = promptQuestion(prepared.question, prepared.attachments, prepared.imageIds);
  const files = fileBlocks(prepared.files);
  return files ? `${question}\n\n${files}` : question;
}

/**
 * The images as message parts, labelled: the question's first, then earlier ones from the history
 * window. Empty when there are none or the model does not read images.
 */
export function imageParts(prepared: PreparedChat): ChatPart[] {
  const position = new Map(prepared.attachments.filter(isImage).map((item, index) => [item.id, index + 1]));
  const part = (image: ImageUpload): ChatPart => ({ type: "image", image: image.data, mediaType: image.mediaType });
  const current = prepared.images.filter((image) => position.has(image.id));
  const earlier = prepared.images.filter((image) => !position.has(image.id));
  const parts: ChatPart[] = current.flatMap((image): ChatPart[] => [
    { type: "text", text: `Image ${position.get(image.id)} of the question:` },
    part(image),
  ]);
  if (earlier.length) parts.push({ type: "text", text: "Images from earlier in the conversation:" }, ...earlier.map(part));
  return parts;
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

export function updateTrace(state: RunState, emit: ChatEmit, index: number, trace: SearchTrace): void {
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
  // On abort, the settled batches are still returned: callers keep them, then throw.
  return { batches: batches.filter(Boolean), errors };
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

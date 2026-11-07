import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { searchProviderName } from "../../provider-catalog";
import { appUrl, isFakeProviders } from "../env";
import { ApiError } from "../http";
import { log } from "../log";
import { researchAgentPrompt } from "../prompts";
import { openRouterError } from "../providers/openrouter";
import {
  appendSources,
  DEEP_RESULTS_PER_QUERY,
  DEEPER_SOURCE_LIMIT,
  everySearchFailed,
  isSearchOutage,
  normalizeQuery,
  runSearches,
  SEARCH_CONCURRENCY,
  type RunContext,
  type RunState,
} from "./context";
import { retrieveSources } from "./retrieval";

const DEEPER_SEARCH_LIMIT = 60;
const DEEPER_QUERIES_PER_CALL = 4;
const DEEPER_MAX_STEPS = 24;
const DEEPER_AGENT_MAX_TOKENS = 4000;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** State shared by every search-tool call in one Deeper run. */
interface Research {
  ctx: RunContext;
  state: RunState;
  /** Lower-cased queries already searched, so the agent cannot repeat itself. */
  asked: Set<string>;
  /** The first key or plan error; it ends the loop and fails the answer. */
  terminalError?: unknown;
}

/** Splits the agent's queries into new ones (reserved against the budget) and repeats. */
function reserveQueries(research: Research, queries: string[]): { unique: string[]; skipped: string[] } {
  const { state, asked } = research;
  const unique: string[] = [];
  const skipped: string[] = [];
  for (const raw of queries) {
    if (state.searchesReserved >= DEEPER_SEARCH_LIMIT) break;
    const query = normalizeQuery(raw);
    const key = query.toLowerCase();
    if (!query) continue;
    if (asked.has(key)) {
      skipped.push(query);
    } else {
      asked.add(key);
      unique.push(query);
      // Reserve synchronously before any await, so parallel tool calls cannot exceed the cap.
      state.searchesReserved += 1;
    }
  }
  return { unique, skipped };
}

/** One search-tool call: runs the new queries, appends ranked sources and summarizes them for the agent. */
async function searchForAgent(research: Research, queries: string[]) {
  const { ctx, state } = research;
  const { emit } = ctx;
  const remaining = DEEPER_SEARCH_LIMIT - state.searchesReserved;
  if (remaining <= 0) {
    return { queries: [], results: [], totalSources: state.sources.length, searchesRemaining: 0, message: "Search budget exhausted." };
  }
  const { unique, skipped } = reserveQueries(research, queries);
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
    detail: `Researching ${plural(unique.length, "query", "queries")} · ${state.searches.length} of ${DEEPER_SEARCH_LIMIT} searches`,
  });
  const { batches, errors } = await runSearches(ctx, state, unique, {
    count: DEEP_RESULTS_PER_QUERY,
    concurrency: SEARCH_CONCURRENCY,
    onSettled: (completed) => emit("progress", { completed, total: unique.length }),
  });
  for (const error of errors) {
    log.warn("Deeper search failed", { code: error instanceof ApiError ? error.code : "INTERNAL" });
  }
  research.terminalError ??= errors.find((error) => !isSearchOutage(error));

  const added = appendSources(state, batches, DEEPER_SOURCE_LIMIT);
  const recent = state.searches
    .slice(-unique.length)
    .map((trace) => `${trace.query}: ${trace.status === "done" ? `${trace.results ?? 0} results` : trace.status}`);

  emit("stage", {
    stage: "searching",
    detail: `Found ${plural(state.sources.length, "source", "sources")} · ${state.searches.length} searches`,
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
}

/** The parts of an AI SDK step result that carry usage and routing. */
interface AgentStep {
  usage: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: Record<string, unknown>;
  response: { modelId: string };
}

/** Adds the agent's token usage, cost and resolved model to the run. */
function recordAgentUsage(state: RunState, steps: readonly AgentStep[]): void {
  for (const step of steps) {
    state.promptTokens += step.usage.inputTokens ?? 0;
    state.completionTokens += step.usage.outputTokens ?? 0;
    const metadata = step.providerMetadata?.openrouter as { provider?: string; usage?: { cost?: number } } | undefined;
    state.costUsd += metadata?.usage?.cost ?? 0;
    state.resolvedModel = step.response.modelId || state.resolvedModel;
    state.upstreamProvider = metadata?.provider || state.upstreamProvider;
  }
}

/**
 * Deeper research: an AI SDK tool loop. The model decides which searches to run; each tool call
 * appends ranked sources with stable citation numbers. The final answer is written separately so
 * the existing streaming, citation and cost contract stays unchanged.
 */
export async function runDeeperResearch(ctx: RunContext, state: RunState): Promise<void> {
  const { prepared, signal, emit } = ctx;
  if (isFakeProviders()) {
    await retrieveSources(ctx, state, ["fixture deeper overview", "fixture deeper developments", "fixture deeper limitations"]);
    return;
  }
  const research: Research = { ctx, state, asked: new Set() };
  const openrouter = createOpenRouter({
    apiKey: prepared.llmKey,
    appName: "Beamling",
    headers: { "HTTP-Referer": appUrl() },
    compatibility: "strict",
  });

  const searchTool = tool({
    description: `Search the web with ${searchProviderName(prepared.searchProvider)}. Use 1–4 short keyword queries per call. Returns compact result summaries and the total number of sources collected. The final writer sees the full source set.`,
    inputSchema: z.object({
      queries: z.array(z.string().min(2).max(180)).min(1).max(DEEPER_QUERIES_PER_CALL).describe("1–4 distinct search queries"),
    }),
    execute: ({ queries }) => searchForAgent(research, queries),
  });

  const agent = new ToolLoopAgent({
    model: openrouter.chat(prepared.model),
    instructions: researchAgentPrompt(),
    tools: { search: searchTool },
    temperature: 0.2,
    maxOutputTokens: DEEPER_AGENT_MAX_TOKENS,
    toolChoice: "auto",
    prepareStep: ({ stepNumber }) => (stepNumber === 0 ? { toolChoice: { type: "tool", toolName: "search" } } : {}),
    stopWhen: [
      isStepCount(DEEPER_MAX_STEPS),
      () =>
        Boolean(research.terminalError) ||
        state.searchesReserved >= DEEPER_SEARCH_LIMIT ||
        state.sources.length >= DEEPER_SOURCE_LIMIT,
    ],
    providerOptions: { openrouter: { usage: { include: true } } },
  });

  emit("stage", { stage: "searching", detail: `Researching with up to ${DEEPER_SEARCH_LIMIT} searches` });
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

  if (research.terminalError) throw research.terminalError;
  recordAgentUsage(state, result.steps);
  if (!state.sources.length && state.searchFailures > 0) throw everySearchFailed(prepared.searchProvider);
}

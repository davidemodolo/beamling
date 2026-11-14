import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { searchProviderName } from "../../provider-catalog";
import { isFakeProviders } from "../env";
import { ApiError } from "../http";
import { log } from "../log";
import { quickSearchPrompt, researchAgentPrompt, researchRequest } from "../prompts";
import { llmAdapter } from "../providers";
import { modelError, type LlmAdapter } from "../providers/llm";
import {
  appendSources,
  askedQuestion,
  imageParts,
  DEEP_RESULTS_PER_QUERY,
  DEEPER_SOURCE_LIMIT,
  everySearchFailed,
  isSearchOutage,
  normalizeQuery,
  QUICK_SOURCE_LIMIT,
  runSearches,
  SEARCH_CONCURRENCY,
  type RunContext,
  type RunState,
  userMessage,
} from "./context";
import { plural } from "../../utils";
import { retrieveSources, type RetrievalLimits } from "./retrieval";

/** How far one research run may go. Quick and Deeper are the same loop with different budgets. */
export interface ResearchBudget extends RetrievalLimits {
  /** Searches in the whole run. */
  searches: number;
  queriesPerCall: number;
  /** Model steps; the first one always calls the search tool. */
  steps: number;
  maxOutputTokens: number;
}

export const QUICK_BUDGET: ResearchBudget = {
  searches: 1,
  queriesPerCall: 1,
  steps: 1,
  sources: QUICK_SOURCE_LIMIT,
  resultsPerQuery: QUICK_SOURCE_LIMIT,
  perSite: 2,
  maxOutputTokens: 400,
  detailed: false,
};

export const DEEPER_BUDGET: ResearchBudget = {
  searches: 60,
  queriesPerCall: 4,
  steps: 24,
  sources: DEEPER_SOURCE_LIMIT,
  resultsPerQuery: DEEP_RESULTS_PER_QUERY,
  perSite: 3,
  maxOutputTokens: 4000,
  detailed: true,
};

/** State shared by every search-tool call in one run. */
interface Research {
  ctx: RunContext;
  state: RunState;
  budget: ResearchBudget;
  /** Lower-cased queries already searched, so the agent cannot repeat itself. */
  asked: Set<string>;
  /** The first key or plan error; it ends the loop and fails the answer. */
  terminalError?: unknown;
}

/** Splits the agent's queries into new ones (reserved against the budget) and repeats. */
function reserveQueries(research: Research, queries: string[]): { unique: string[]; skipped: string[] } {
  const { state, asked, budget } = research;
  const unique: string[] = [];
  const skipped: string[] = [];
  for (const raw of queries) {
    if (state.searchesReserved >= budget.searches) break;
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
  const { ctx, state, budget } = research;
  const { emit } = ctx;
  const remaining = budget.searches - state.searchesReserved;
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
    detail: budget.detailed
      ? `Researching ${plural(unique.length, "query", "queries")} · ${state.searches.length} of ${budget.searches} searches`
      : "Searching the web",
  });
  const { batches, errors } = await runSearches(ctx, state, unique, {
    count: budget.resultsPerQuery,
    concurrency: SEARCH_CONCURRENCY,
    onSettled: (completed) => emit("progress", { completed, total: unique.length }),
  });
  for (const error of errors) {
    log.warn("Research search failed", {
      code: error instanceof ApiError ? error.code : "INTERNAL",
      searchProvider: ctx.prepared.searchProvider,
    });
  }
  research.terminalError ??= errors.find((error) => !isSearchOutage(error));

  const added = appendSources(state, batches, budget.sources, budget.perSite);
  ctx.signal.throwIfAborted();
  const recent = state.searches
    .slice(-unique.length)
    .map((trace) => `${trace.query}: ${trace.status === "done" ? `${trace.results ?? 0} results` : trace.status}`);

  if (budget.detailed) {
    emit("stage", {
      stage: "searching",
      detail: `Found ${plural(state.sources.length, "source", "sources")} · ${state.searches.length} searches`,
    });
  }
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
    searchesRemaining: Math.max(0, budget.searches - state.searches.length),
    recent,
    message:
      state.searches.length >= budget.searches
        ? "Search budget exhausted. Stop searching and summarize coverage."
        : "Continue only if a material gap remains.",
  };
}

/** Adds the agent's token usage, cost and resolved model to the run. */
function recordAgentUsage(
  state: RunState,
  adapter: LlmAdapter,
  steps: readonly (Parameters<LlmAdapter["stepUsage"]>[0] & { response: { modelId: string } })[],
): void {
  for (const step of steps) {
    const { costUsd, upstreamProvider } = adapter.stepUsage(step);
    state.promptTokens += step.usage.inputTokens ?? 0;
    state.completionTokens += step.usage.outputTokens ?? 0;
    state.costUsd += costUsd;
    state.resolvedModel = step.response.modelId || state.resolvedModel;
    state.upstreamProvider = upstreamProvider || state.upstreamProvider;
  }
}

/**
 * Research as an AI SDK tool loop: the model decides which searches to run within the budget; each
 * tool call appends ranked sources with stable citation numbers. The final answer is written
 * separately, so the streaming, citation and cost contract is the same for every mode.
 */
export async function runResearch(ctx: RunContext, state: RunState, budget: ResearchBudget): Promise<void> {
  const { prepared, signal, emit } = ctx;
  if (isFakeProviders()) {
    const fixtureQueries =
      budget.steps === 1
        ? [prepared.question || "fixture image question"]
        : ["fixture deeper overview", "fixture deeper developments", "fixture deeper limitations"];
    await retrieveSources(ctx, state, fixtureQueries, budget);
    return;
  }
  const research: Research = { ctx, state, budget, asked: new Set() };
  const adapter = llmAdapter(prepared.llm.provider);
  const many = budget.queriesPerCall > 1;

  const searchTool = tool({
    description: `Search the web with ${searchProviderName(prepared.searchProvider)}. ${
      many ? `Use 1–${budget.queriesPerCall} short keyword queries per call.` : "Use exactly one short keyword query."
    } Returns compact result summaries and the total number of sources collected. The final writer sees the full source set.`,
    inputSchema: z.object({
      queries: z
        .array(z.string().min(2).max(180))
        .min(1)
        .max(budget.queriesPerCall)
        .describe(many ? `1–${budget.queriesPerCall} distinct search queries` : "One search query"),
    }),
    execute: ({ queries }) => searchForAgent(research, queries),
  });

  const agent = new ToolLoopAgent({
    model: adapter.model(prepared.llmKey, prepared.llm.apiModel),
    instructions: budget.steps === 1 ? quickSearchPrompt() : researchAgentPrompt(),
    tools: { search: searchTool },
    temperature: 0.2,
    maxOutputTokens: budget.maxOutputTokens,
    maxRetries: 0,
    toolChoice: "auto",
    // Per step, so the usage of finished steps is kept when research is cut short.
    onStepEnd: (step) => recordAgentUsage(state, adapter, [step]),
    prepareStep: ({ stepNumber }) => (stepNumber === 0 ? { toolChoice: { type: "tool", toolName: "search" } } : {}),
    stopWhen: [
      isStepCount(budget.steps),
      () =>
        Boolean(research.terminalError) ||
        state.searchesReserved >= budget.searches ||
        state.sources.length >= budget.sources,
    ],
    providerOptions: adapter.providerOptions as ConstructorParameters<typeof ToolLoopAgent>[0]["providerOptions"],
  });

  emit("stage", {
    stage: "searching",
    detail: budget.detailed ? `Researching with up to ${budget.searches} searches` : "Searching the web",
  });
  try {
    const request = researchRequest(askedQuestion(prepared), prepared.history, prepared.imageIds);
    await agent.generate({ prompt: [userMessage(request, imageParts(prepared))], abortSignal: signal });
  } catch (error) {
    throw modelError(prepared.llm.provider, error, signal);
  }

  if (research.terminalError) throw research.terminalError;
  if (!state.sources.length && state.searchFailures > 0) throw everySearchFailed(prepared.searchProvider);
}

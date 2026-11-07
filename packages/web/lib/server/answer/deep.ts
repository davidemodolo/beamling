import { ApiError } from "../http";
import { log } from "../log";
import { gapPrompt, PLANNER_REPAIR, plannerPrompt } from "../prompts";
import { chat } from "../providers";
import {
  addUsage,
  appendSources,
  DEEP_RESULTS_PER_QUERY,
  DEEP_SOURCE_LIMIT,
  isSearchOutage,
  normalizeQuery,
  promptMessages,
  runSearches,
  type RunContext,
  type RunState,
} from "./context";

const MIN_DEEP_QUERIES = 3;
const MAX_DEEP_QUERIES = 5;
const MAX_GAP_QUERIES = 2;
const PLANNER_MAX_TOKENS = 2000;
const GAP_MAX_TOKENS = 1500;
/** Below this many sources, Deep asks the model whether a follow-up search is needed. */
const GAP_REVIEW_BELOW = 4;

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

/** Deep planner with one repair attempt; falls back to the question itself (a degraded Deep run). */
export async function planQueries(ctx: RunContext, state: RunState): Promise<string[]> {
  const { prepared, signal } = ctx;
  ctx.emit("stage", { stage: "searching", detail: "Planning 3–5 sub-queries" });
  const messages = promptMessages(plannerPrompt(prepared.question));
  const plan = (conversation: typeof messages) =>
    chat({ purpose: "plan", key: prepared.llmKey, model: prepared.llm, messages: conversation, maxTokens: PLANNER_MAX_TOKENS, signal });
  try {
    const first = await plan(messages);
    addUsage(state, first);
    let queries = parseQueries(first.content);
    if (queries.length < MIN_DEEP_QUERIES) {
      const repaired = await plan([...messages, { role: "assistant", content: first.content }, { role: "user", content: PLANNER_REPAIR }]);
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

/**
 * When evidence is thin, at most two follow-up searches appended without renumbering.
 * A failed review or a provider outage is skipped; a terminal search error (key, plan) is thrown.
 */
export async function fillEvidenceGaps(ctx: RunContext, state: RunState, queries: string[]): Promise<void> {
  const { prepared, signal } = ctx;
  if (state.sources.length >= GAP_REVIEW_BELOW) return;
  let terminalSearchError: unknown;
  try {
    const review = await chat({
      purpose: "gap",
      key: prepared.llmKey,
      model: prepared.llm,
      messages: promptMessages(gapPrompt({ question: prepared.question, subqueries: queries, sources: state.sources })),
      maxTokens: GAP_MAX_TOKENS,
      signal,
    });
    addUsage(state, review);
    const { batches, errors } = await runSearches(ctx, state, parseGapQueries(review.content), {
      count: DEEP_RESULTS_PER_QUERY,
      concurrency: 1,
    });
    terminalSearchError = errors.find((error) => !isSearchOutage(error));
    if (terminalSearchError) throw terminalSearchError;
    appendSources(state, batches, DEEP_SOURCE_LIMIT);
  } catch (error) {
    if (signal.aborted || terminalSearchError) throw error;
  }
}

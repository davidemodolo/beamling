/**
 * The answer pipeline: `prepareChat` stores the exchange, `runChat` gathers sources for the mode,
 * streams the answer and stores the outcome. The stages live in `./answer/`.
 */
import { hasValidCitation, sanitizeCitations } from "./citations";
import { ApiError, INTERNAL_ERROR_MESSAGE } from "./http";
import { log } from "./log";
import { NO_SOURCES_ANSWER } from "./prompts";
import {
  newRunState,
  RESEARCH_SHARE,
  TIMEOUT_MS,
  updateTrace,
  type ChatEmit,
  type PreparedChat,
  type RunContext,
  type RunState,
} from "./answer/context";
import { fillEvidenceGaps, planQueries } from "./answer/deep";
import { DEEPER_BUDGET, QUICK_BUDGET, runResearch } from "./answer/research";
import { abortOutcome, RunRecorder } from "./answer/outcome";
import { DEEP_RETRIEVAL, freshnessDays, retrieveSources } from "./answer/retrieval";
import { streamSynthesis } from "./answer/synthesis";
import { plural } from "../utils";

export { prepareChat } from "./answer/prepare";
export { TIMEOUT_MS, type ChatEmit } from "./answer/context";

const QUEUED_DETAIL = { quick: "Understanding the question", deep: "Planning a research path", deeper: "Starting deeper research" };

class ResearchTimeUp extends Error {
  override name = "ResearchTimeUp";
}

/** How often a research run past its share checks whether a first result has arrived. */
const RESEARCH_RECHECK_MS = 500;

/**
 * Gathers sources within the research share of the time limit. When it runs out, searches in
 * flight are cancelled and the answer is written from the sources already found. Until a search
 * has returned results there is nothing to write from, so research continues: a slow model then
 * ends at the answer's own time limit, which can be retried, not with an empty source list.
 */
async function gatherSources(ctx: RunContext, state: RunState, researchMs: number): Promise<string[]> {
  const research = new AbortController();
  const remaining = ctx.prepared.startedAt + researchMs - Date.now();
  const cut = () => {
    if (state.searches.some((trace) => trace.status === "done" && (trace.results ?? 0) > 0)) {
      research.abort(new ResearchTimeUp());
    } else {
      timer = setTimeout(cut, RESEARCH_RECHECK_MS);
    }
  };
  let timer = setTimeout(cut, Math.max(0, remaining));
  try {
    return await collectSources({ ...ctx, signal: AbortSignal.any([ctx.signal, research.signal]) }, state);
  } catch (error) {
    if (ctx.signal.aborted || !research.signal.aborted) throw error;
    state.researchCut = true;
    state.searches.forEach((trace, index) => {
      if (trace.status === "searching") updateTrace(state, ctx.emit, index, { query: trace.query, status: "failed", results: 0 });
    });
    return state.searches.filter((trace) => trace.status === "done").map((trace) => trace.query);
  } finally {
    clearTimeout(timer);
  }
}

/** Collects the answer's sources for its mode and returns the queries that were searched. */
async function collectSources(ctx: RunContext, state: RunState): Promise<string[]> {
  const { prepared } = ctx;
  if (prepared.mode !== "deep") {
    await runResearch(ctx, state, prepared.mode === "quick" ? QUICK_BUDGET : DEEPER_BUDGET);
    return state.searches.map((trace) => trace.query);
  }
  const queries = await planQueries(ctx, state);
  ctx.emit("plan", { queries });
  await retrieveSources(ctx, state, queries, DEEP_RETRIEVAL);
  await fillEvidenceGaps(ctx, state, queries);
  return queries;
}

/** No usable sources: a fixed answer instead of an unsupported one. */
async function finishWithoutSources(ctx: RunContext, state: RunState, recorder: RunRecorder): Promise<void> {
  state.content = NO_SOURCES_ANSWER;
  ctx.emit("stage", { stage: "no-sources", detail: "No usable sources found" });
  ctx.emit("delta", { text: state.content });
  const { usage, stored } = await recorder.complete({ content: state.content, status: "complete", noSources: true });
  if (!stored) return;
  ctx.emit("usage", usage);
  ctx.emit("done", { noSources: true, degraded: state.degraded, searchFailures: state.searchFailures });
  recorder.completed(usage, { uncited: true, noSources: true });
}

async function finishWithAnswer(ctx: RunContext, state: RunState, recorder: RunRecorder, queries: string[]): Promise<void> {
  const result = await streamSynthesis(ctx, state, queries);
  const content = sanitizeCitations(result.content || state.content, state.sources.length);
  if (!content.trim()) {
    throw new ApiError("EMPTY_RESPONSE", "The model returned an empty answer. Try again.", 502);
  }
  const truncated = result.finishReason === "length";
  const uncited = !hasValidCitation(content, state.sources.length);
  const { usage, stored } = await recorder.complete({ content, status: "complete", sources: state.sources, uncited, truncated });
  if (!stored) return;
  ctx.emit("usage", usage);
  ctx.emit("done", { noSources: false, truncated, degraded: state.degraded, searchFailures: state.searchFailures });
  recorder.completed(usage, { uncited, noSources: false });
}

/** Stores the partial answer of a stopped, timed-out, disconnected or interrupted run. */
async function finishAborted(ctx: RunContext, state: RunState, recorder: RunRecorder): Promise<void> {
  const outcome = abortOutcome(ctx.signal, ctx.prepared.mode);
  const { usage, stored } = await recorder.complete({
    content: sanitizeCitations(state.content, state.sources.length),
    sources: state.sources,
    ...outcome,
  });
  if (outcome.status === "stopped") {
    ctx.emit("stage", { stage: "stopped", detail: outcome.errorMessage ?? "Answer stopped" });
  } else {
    ctx.emit("error", { code: outcome.errorCode, message: outcome.errorMessage });
  }
  if (!stored) return;
  if (outcome.errorCode) recorder.failed(usage, outcome.errorCode);
  else recorder.stopped(usage);
}

async function finishFailed(ctx: RunContext, state: RunState, recorder: RunRecorder, error: unknown): Promise<void> {
  const code = error instanceof ApiError ? error.code : "INTERNAL";
  const message = error instanceof ApiError ? error.message : "The answer could not be completed.";
  if (!(error instanceof ApiError)) log.error("Answer failed", error);
  const { usage, stored } = await recorder.complete({
    content: sanitizeCitations(state.content, state.sources.length),
    status: "error",
    sources: state.sources,
    errorCode: code,
    errorMessage: message,
  });
  ctx.emit("error", { code, message, provider: error instanceof ApiError ? error.provider : undefined });
  if (stored) recorder.failed(usage, code);
}

export async function runChat(
  prepared: PreparedChat,
  options: {
    signal: AbortSignal;
    emit: ChatEmit;
    /** Time for gathering sources, from the start; defaults to the mode's share of its limit. */
    researchMs?: number;
  },
): Promise<void> {
  const { signal, emit } = options;
  const researchMs = options.researchMs ?? TIMEOUT_MS[prepared.mode] * RESEARCH_SHARE;
  const ctx: RunContext = { prepared, signal, emit, freshnessDays: freshnessDays(prepared.question) };
  const state = newRunState();
  const recorder = new RunRecorder(prepared, state);

  emit("meta", {
    conversationId: prepared.conversationId,
    messageId: prepared.messageId,
    userMessageId: prepared.userMessageId,
    removed: prepared.removed,
  });
  emit("stage", { stage: "queued", detail: QUEUED_DETAIL[prepared.mode] });

  try {
    const queries = await gatherSources(ctx, state, researchMs);
    recorder.markSourcesGathered();
    emit("stage", {
      stage: "reading",
      detail: state.researchCut
        ? `Research time is up · reading ${plural(state.sources.length, "source")}`
        : `Reading ${plural(state.sources.length, "source")}`,
    });
    emit("sources", state.sources);
    if (state.sources.length) await finishWithAnswer(ctx, state, recorder, queries);
    else await finishWithoutSources(ctx, state, recorder);
  } catch (error) {
    // Once the answer is stored, a later error (emitting, analytics) must not store it again.
    if (recorder.finished) throw error;
    const aborted = signal.aborted || (error instanceof Error && error.name === "AbortError");
    if (aborted) await finishAborted(ctx, state, recorder);
    else await finishFailed(ctx, state, recorder, error);
  }
}

export function publicError(error: unknown): { code: string; message: string; provider?: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message, provider: error.provider };
  log.error("Answer stream failed", error);
  return { code: "INTERNAL", message: INTERNAL_ERROR_MESSAGE };
}

/**
 * The answer pipeline: `prepareChat` stores the exchange, `runChat` gathers sources for the mode,
 * streams the answer and stores the outcome. The stages live in `./answer/`.
 */
import { hasValidCitation, sanitizeCitations } from "./citations";
import { ApiError, INTERNAL_ERROR_MESSAGE } from "./http";
import { log } from "./log";
import { NO_SOURCES_ANSWER } from "./prompts";
import { newRunState, type ChatEmit, type PreparedChat, type RunContext, type RunState } from "./answer/context";
import { fillEvidenceGaps, planQueries } from "./answer/deep";
import { DEEPER_BUDGET, QUICK_BUDGET, runResearch } from "./answer/research";
import { abortOutcome, RunRecorder } from "./answer/outcome";
import { freshnessDays, retrieveSources } from "./answer/retrieval";
import { streamSynthesis } from "./answer/synthesis";

export { prepareChat } from "./answer/prepare";
export { freshnessDays };
export { TIMEOUT_MS, type ChatEmit, type PreparedChat } from "./answer/context";

const QUEUED_DETAIL = { quick: "Understanding the question", deep: "Planning a research path", deeper: "Starting deeper research" };

/** Collects the answer's sources for its mode and returns the queries that were searched. */
async function gatherSources(ctx: RunContext, state: RunState): Promise<string[]> {
  const { prepared } = ctx;
  if (prepared.mode !== "deep") {
    await runResearch(ctx, state, prepared.mode === "quick" ? QUICK_BUDGET : DEEPER_BUDGET);
    return state.searches.map((trace) => trace.query);
  }
  const queries = await planQueries(ctx, state);
  ctx.emit("plan", { queries });
  await retrieveSources(ctx, state, queries);
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

export async function runChat(prepared: PreparedChat, options: { signal: AbortSignal; emit: ChatEmit }): Promise<void> {
  const { signal, emit } = options;
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
    const queries = await gatherSources(ctx, state);
    emit("stage", {
      stage: "reading",
      detail: `Reading ${state.sources.length} ${state.sources.length === 1 ? "source" : "sources"}`,
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

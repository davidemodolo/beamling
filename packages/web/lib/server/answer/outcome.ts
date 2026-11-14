import type { Mode, Usage } from "../../types";
import { isClientDisconnect, isShutdown } from "../active-chats";
import { analytics } from "../analytics";
import { hmacToken } from "../crypto";
import { log } from "../log";
import { completeAssistant, type AssistantOutcome } from "../repo";
import { finalUsage, TIMEOUT_MS, type PreparedChat, type RunState } from "./context";

/** How an aborted run ends: a server shutdown, the time limit, a client disconnect or a user stop. */
export function abortOutcome(signal: AbortSignal, mode: Mode) {
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
  if (isClientDisconnect(reason)) {
    // Keep the partial answer in the "stopped" presentation, but record it as a failure in analytics.
    return {
      status: "stopped" as const,
      errorCode: "CLIENT_DISCONNECT",
      errorMessage: "The connection closed before the answer finished.",
    };
  }
  // An explicit Stop (or any other abort reason) keeps the partial answer as stopped.
  return { status: "stopped" as const };
}

type OutcomeFields = Omit<AssistantOutcome, "userId" | "messageId" | "usage" | "searches" | "reasoning">;

/** Stores the run's outcome and reports it to analytics, however the run ended. */
export class RunRecorder {
  /** True once a successful outcome is stored; a later error must not overwrite it. */
  finished = false;
  /** When source gathering ended, so the outcome log can split research from writing. */
  private sourcesAt?: number;

  constructor(
    private readonly prepared: PreparedChat,
    private readonly state: RunState,
  ) {}

  markSourcesGathered(): void {
    this.sourcesAt = Date.now();
  }

  /** Stores the answer. `stored` is false when the message was deleted while it ran. */
  async complete(fields: OutcomeFields): Promise<{ usage: Usage; stored: boolean }> {
    const result = await this.store(fields);
    if (fields.status === "complete") this.finished = true;
    this.log(fields, result);
    return result;
  }

  /** One line per answer, however it ended: metadata only, never questions, queries or text. */
  private log(fields: OutcomeFields, { usage, stored }: { usage: Usage; stored: boolean }): void {
    const { prepared, state } = this;
    const outcome = {
      messageId: prepared.messageId,
      userId: hmacToken(prepared.userId),
      mode: prepared.mode,
      status: fields.status,
      errorCode: fields.errorCode,
      llmModel: prepared.llm.id,
      resolvedModel: usage.resolvedModel,
      upstreamProvider: usage.upstreamProvider,
      searchProvider: prepared.searchProvider,
      durationMs: usage.latencyMs,
      sourcesMs: this.sourcesAt === undefined ? undefined : this.sourcesAt - prepared.startedAt,
      searchRequests: state.searchRequests,
      searchFailures: state.searchFailures,
      sources: state.sources.length,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      contentChars: fields.content.length,
      truncated: fields.truncated,
      degraded: state.degraded,
      researchCut: state.researchCut,
      stored,
    };
    if (fields.status === "error") log.warn("answer", outcome);
    else log.info("answer", outcome);
  }

  private async store(fields: OutcomeFields): Promise<{ usage: Usage; stored: boolean }> {
    const { prepared, state } = this;
    const usage = finalUsage(state, prepared.startedAt, prepared.searchProvider);
    const stored = await completeAssistant({
      degraded: state.degraded,
      searchFailures: state.searchFailures,
      searches: state.searches,
      reasoning: state.reasoning || undefined,
      ...fields,
      userId: prepared.userId,
      messageId: prepared.messageId,
      usage,
    });
    return { usage, stored };
  }

  completed(usage: Usage, fields: { uncited: boolean; noSources: boolean }): void {
    const { prepared, state } = this;
    analytics.capture(prepared.userId, "answer_completed", {
      mode: prepared.mode,
      search_provider: prepared.searchProvider,
      llm_model: prepared.llm.id,
      resolved_model: usage.resolvedModel,
      upstream_provider: usage.upstreamProvider,
      tokens_in: usage.tokensIn,
      tokens_out: usage.tokensOut,
      cost_usd: usage.costUsd,
      search_cost_usd: usage.searchCostUsd,
      search_requests: state.searchRequests,
      search_failures: state.searchFailures,
      latency_ms: this.latency(usage),
      uncited: fields.uncited,
      no_sources: fields.noSources,
      degraded: state.degraded,
    });
  }

  failed(usage: Usage, errorCode: string): void {
    const { prepared, state } = this;
    analytics.capture(prepared.userId, "answer_failed", {
      mode: prepared.mode,
      search_provider: prepared.searchProvider,
      llm_model: prepared.llm.id,
      error_code: errorCode,
      latency_ms: this.latency(usage),
      search_failures: state.searchFailures,
    });
  }

  stopped(usage: Usage): void {
    const { prepared } = this;
    analytics.capture(prepared.userId, "answer_stopped", {
      mode: prepared.mode,
      search_provider: prepared.searchProvider,
      latency_ms: this.latency(usage),
    });
  }

  private latency(usage: Usage): number {
    return usage.latencyMs ?? Date.now() - this.prepared.startedAt;
  }
}

"use client";

import { createParser } from "eventsource-parser";
import type { ChatStage, DoneEvent, Mode, SearchProvider, SearchTrace, Source, Usage } from "./types";
import { parseStreamEvent } from "./stream-events";

export class ApiRequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public provider?: string,
    /** The parsed error response, for routes that return extra fields with the error. */
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface StreamError {
  code: string;
  message: string;
  provider?: string;
}

const SESSION_EXPIRED = "Your session expired. Sign in again to continue.";
const REQUEST_TIMEOUT_MS = 20_000;
/** How long a stopped answer gets to confirm before the connection is dropped. */
const STOP_GRACE_MS = 6_000;

/** Copy for errors that mean the same thing wherever they surface. */
const GENERIC_COPY: Record<string, string> = {
  UNAUTHENTICATED: SESSION_EXPIRED,
  RATE_LIMITED: "Too many requests. Wait a minute and try again.",
  SERVER_BUSY: "Beamling is busy right now. Try again in a moment.",
  NETWORK: "The connection was interrupted. Check your network and try again.",
  TIMEOUT: "The server took too long to respond. Try again.",
};

/** A user-facing message for a failed request, falling back to the server's own message. */
export function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiRequestError) return GENERIC_COPY[cause.code] ?? (cause.message || fallback);
  return fallback;
}

export type ErrorAction = "settings" | "reload" | "retry";

export interface ErrorCopy {
  title: string;
  message: string;
  action: ErrorAction;
}

/** Friendly copy and the most useful next step for an answer that failed. */
export function describeAnswerError(code: string | undefined, message?: string): ErrorCopy {
  const retry = (title: string, fallback: string): ErrorCopy => ({ title, message: message || fallback, action: "retry" });
  const settings = (title: string, fallback: string): ErrorCopy => ({
    title,
    message: message || fallback,
    action: "settings",
  });
  switch (code) {
    case "UNAUTHENTICATED":
      return { title: "Session expired", message: SESSION_EXPIRED, action: "reload" };
    case "CREDENTIAL_MISSING":
      return settings("Key needed", "Add your OpenRouter key and a key for the selected search provider in Settings.");
    case "CREDENTIAL_INVALID":
      return settings("Key rejected", "A provider rejected your key. Replace it in Settings, then retry.");
    case "CREDENTIAL_UNREADABLE":
      return settings("Key unreadable", "A saved key can no longer be read. Replace it in Settings.");
    case "BRAVE_PLAN_MISSING_SEARCH":
      return settings("Brave plan missing", "Your Brave key has no Search plan. Use a Search-plan key.");
    case "SEARCH_PLAN_MISSING":
      return settings("Search plan missing", "The selected search key does not include a search plan.");
    case "QUOTA_EXCEEDED":
      return retry("Search limit reached", "The selected search provider has reached its plan limit.");
    case "MODEL_NOT_FOUND":
      return settings("Model unavailable", "OpenRouter does not offer this model right now. Pick another in Settings.");
    case "INSUFFICIENT_CREDITS":
      return retry("Out of credits", "A provider account has run out of credits. Top it up, then retry.");
    case "PROVIDER_RATE_LIMITED":
      return retry("Provider rate limit", "A provider is rate-limiting your key. Wait a moment, then retry.");
    case "PROVIDER_UNAVAILABLE":
      return retry("Provider unavailable", "A provider is unavailable right now. Try again shortly.");
    case "SEARCH_FAILED":
      return retry("Search failed", "Every web search failed, so no answer was written. Try again shortly.");
    case "CONTEXT_TOO_LARGE":
      return retry("Too long for this model", "The question and sources are too long for this model. Try a shorter question.");
    case "RATE_LIMITED":
      return { title: "Slow down", message: GENERIC_COPY.RATE_LIMITED, action: "retry" };
    case "SERVER_BUSY":
      return { title: "Busy", message: GENERIC_COPY.SERVER_BUSY, action: "retry" };
    case "GENERATION_IN_PROGRESS":
      return {
        title: "Already answering",
        message: "An answer is already being written for this conversation. Wait for it to finish, then retry.",
        action: "retry",
      };
    case "INTERRUPTED":
      return retry("Interrupted", "The answer was interrupted before it finished.");
    case "NETWORK":
      return { title: "Connection lost", message: GENERIC_COPY.NETWORK, action: "retry" };
    case "TIMEOUT":
      return { title: "No response", message: GENERIC_COPY.TIMEOUT, action: "retry" };
    case "STREAM_ENDED":
      return { title: "Connection closed", message: "The connection closed before the answer finished.", action: "retry" };
    default:
      return retry("Something went wrong", "The provider could not complete this request.");
  }
}

async function readApiError(response: Response, fallback: StreamError): Promise<ApiRequestError> {
  let { code, message, provider } = fallback;
  let body: Record<string, unknown> | undefined;
  try {
    body = (await response.json()) as Record<string, unknown>;
    const error = body.error as Partial<StreamError> | undefined;
    code = error?.code ?? code;
    message = error?.message ?? message;
    provider = error?.provider ?? provider;
  } catch {}
  return new ApiRequestError(code, message, response.status, provider, body);
}

/** JSON request with a timeout, so a stalled connection cannot leave the UI waiting forever. */
export async function api<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...request } = init ?? {};
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      ...request,
      headers: {
        ...(request.body ? { "Content-Type": "application/json" } : {}),
        ...request.headers,
      },
      signal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout,
      cache: "no-store",
    });
  } catch (error) {
    if (timeout.aborted) throw new ApiRequestError("TIMEOUT", GENERIC_COPY.TIMEOUT, 0);
    if (request.signal?.aborted) throw error;
    throw new ApiRequestError("NETWORK", GENERIC_COPY.NETWORK, 0);
  }
  if (!response.ok) {
    throw await readApiError(response, { code: "REQUEST_FAILED", message: "The request failed." });
  }
  try {
    return (await response.json()) as T;
  } catch {
    if (timeout.aborted) throw new ApiRequestError("TIMEOUT", GENERIC_COPY.TIMEOUT, response.status);
    throw new ApiRequestError("INVALID_RESPONSE", "The server sent an unexpected response.", response.status);
  }
}

export interface StreamMeta {
  conversationId: string;
  messageId: string;
  userMessageId: string;
}

export interface StreamEvents {
  onMeta?: (meta: StreamMeta) => void;
  onStage?: (stage: ChatStage, detail?: string) => void;
  onPlan?: (queries: string[]) => void;
  onSearch?: (trace: SearchTrace) => void;
  onProgress?: (progress: { completed: number; total: number }) => void;
  onSources?: (sources: Source[]) => void;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onCitation?: (position: number) => void;
  onUsage?: (usage: Usage) => void;
  onDone?: (result: DoneEvent) => void;
  onError?: (error: StreamError) => void;
  /** The server confirmed the stop ("stopped" stage), or the connection was dropped. */
  onStopped?: (confirmed: boolean) => void;
}

export interface StreamHandle {
  /** Asks the server to stop and keeps listening until it confirms, so the stored state is final. */
  stop: () => void;
  /** Drops the connection immediately; the server stops when it notices. */
  abort: () => void;
}

export interface StreamInput {
  conversationId: string;
  mode: Mode;
  searchProvider?: SearchProvider;
  question?: string;
  retryOf?: string;
}

export function streamAnswer(input: StreamInput, events: StreamEvents): StreamHandle {
  const controller = new AbortController();
  // Set once a terminal event (done, error, or the server's "stopped" stage) has been delivered.
  let settled = false;
  let stopRequested = false;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let messageId: string | undefined;

  const settle = (deliver: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(stopTimer);
    deliver();
  };

  const run = async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        const error = await readApiError(response, { code: "REQUEST_FAILED", message: "The answer could not be started." });
        settle(() => events.onError?.({ code: error.code, message: error.message, provider: error.provider }));
        return;
      }
      if (!response.body) {
        settle(() => events.onError?.({ code: "STREAM_ENDED", message: "The answer stream was empty." }));
        return;
      }

      const parser = createParser({
        onEvent(event) {
          if (!event.data || settled) return;
          let data: unknown;
          try {
            data = JSON.parse(event.data);
          } catch {
            return;
          }
          const parsed = parseStreamEvent(event.event ?? "", data);
          if (!parsed) return;
          switch (parsed.event) {
            case "meta":
              messageId = parsed.data.messageId;
              events.onMeta?.(parsed.data);
              break;
            case "stage":
              if (parsed.data.stage === "stopped") settle(() => events.onStopped?.(true));
              else events.onStage?.(parsed.data.stage, parsed.data.detail);
              break;
            case "plan":
              events.onPlan?.(parsed.data.queries);
              break;
            case "search":
              events.onSearch?.(parsed.data);
              break;
            case "progress":
              events.onProgress?.(parsed.data);
              break;
            case "sources":
              events.onSources?.(parsed.data);
              break;
            case "delta":
              events.onDelta?.(parsed.data.text);
              break;
            case "reasoning":
              events.onReasoning?.(parsed.data.text);
              break;
            case "citation":
              events.onCitation?.(parsed.data.position);
              break;
            case "usage":
              events.onUsage?.(parsed.data);
              break;
            case "done":
              settle(() => events.onDone?.(parsed.data));
              break;
            case "error":
              settle(() => events.onError?.(parsed.data));
              break;
            default:
              // Unknown events are ignored, so the server can add new ones safely.
              break;
          }
        },
      });

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      reader = undefined;
      if (stopRequested) settle(() => events.onStopped?.(false));
      else settle(() => events.onError?.({ code: "STREAM_ENDED", message: "The connection closed before the answer finished." }));
    } catch {
      if (controller.signal.aborted || stopRequested) {
        settle(() => events.onStopped?.(false));
        return;
      }
      settle(() => events.onError?.({ code: "NETWORK", message: GENERIC_COPY.NETWORK }));
    } finally {
      clearTimeout(stopTimer);
      // Release the connection when we leave the loop early (error or abort).
      if (reader) void reader.cancel().catch(() => {});
    }
  };

  void run();

  return {
    stop() {
      if (settled || stopRequested) return;
      stopRequested = true;
      // Before the server has stored the answer there is nothing to confirm: just disconnect.
      if (!messageId) {
        controller.abort();
        return;
      }
      void api("/api/chat/stop", { method: "POST", body: JSON.stringify({ messageId }), timeoutMs: STOP_GRACE_MS }).catch(
        () => controller.abort(),
      );
      stopTimer = setTimeout(() => controller.abort(), STOP_GRACE_MS);
    },
    abort() {
      controller.abort();
    },
  };
}

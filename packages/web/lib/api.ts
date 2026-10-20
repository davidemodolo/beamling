"use client";

import { createParser } from "eventsource-parser";
import type { ChatStage, Mode, Source, Usage } from "./types";

export class ApiRequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public provider?: string,
  ) {
    super(message);
  }
}

interface StreamError {
  code: string;
  message: string;
  provider?: string;
}

const SESSION_EXPIRED = "Your session expired. Reload the page to start a new workspace.";

/** Copy for errors that mean the same thing wherever they surface. */
const GENERIC_COPY: Record<string, string> = {
  NO_SESSION: SESSION_EXPIRED,
  RATE_LIMITED: "Too many requests. Wait a minute and try again.",
  SERVER_BUSY: "Beamling is busy right now. Try again in a moment.",
  NETWORK: "The connection was interrupted. Check your network and try again.",
};

/** A user-facing message for a failed request, falling back to the server's own message. */
export function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiRequestError) return GENERIC_COPY[cause.code] ?? (cause.message || fallback);
  return fallback;
}

const PROVIDER_LABEL: Record<string, string> = {
  openrouter: "OpenRouter",
  brave: "Brave Search",
};

export type ErrorAction = "settings" | "reload" | "retry";

export interface ErrorCopy {
  title: string;
  message: string;
  action: ErrorAction;
}

/** Friendly copy and the most useful next step for an answer that failed. */
export function describeAnswerError(code: string | undefined, message?: string, provider?: string): ErrorCopy {
  const name = provider ? PROVIDER_LABEL[provider] ?? provider : undefined;
  switch (code) {
    case "NO_SESSION":
      return { title: "Session expired", message: SESSION_EXPIRED, action: "reload" };
    case "MISSING_LLM_KEY":
      return { title: "OpenRouter key needed", message: "Add an OpenRouter key in Settings to get answers.", action: "settings" };
    case "MISSING_SEARCH_KEY":
      return { title: "Brave Search key needed", message: "Add a Brave Search key in Settings to search the web.", action: "settings" };
    case "INVALID_KEY":
      return {
        title: "Key rejected",
        message: name ? `${name} rejected your key. Replace it in Settings, then retry.` : `${message || "A provider rejected your key."} Replace it in Settings, then retry.`,
        action: "settings",
      };
    case "INSUFFICIENT_CREDITS":
      return {
        title: "Out of credits",
        message: name ? `Your ${name} account has run out of credits. Top it up, then retry.` : `${message || "A provider account has run out of credits."} Top it up, then retry.`,
        action: "retry",
      };
    case "PROVIDER_RATE_LIMITED":
      return {
        title: "Provider rate limit",
        message: name ? `${name} is rate-limiting your key. Wait a moment, then retry.` : message || "A provider is rate-limiting your key. Wait a moment, then retry.",
        action: "retry",
      };
    case "PROVIDER_UNAVAILABLE":
      return {
        title: "Provider unavailable",
        message: name ? `${name} is unavailable right now. Try again shortly.` : message || "A provider is unavailable right now. Try again shortly.",
        action: "retry",
      };
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
    case "NETWORK":
      return { title: "Connection lost", message: GENERIC_COPY.NETWORK, action: "retry" };
    case "STREAM_ENDED":
      return { title: "Connection closed", message: "The connection closed before the answer finished.", action: "retry" };
    default:
      return {
        title: "Something went wrong",
        message: message || "The provider could not complete this request.",
        action: "retry",
      };
  }
}

async function readApiError(response: Response, fallback: StreamError): Promise<ApiRequestError> {
  let { code, message, provider } = fallback;
  try {
    const body = (await response.json()) as { error?: Partial<StreamError> };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
    provider = body.error?.provider ?? provider;
  } catch {}
  return new ApiRequestError(code, message, response.status, provider);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiRequestError("NETWORK", GENERIC_COPY.NETWORK, 0);
  }
  if (!response.ok) {
    throw await readApiError(response, { code: "REQUEST_FAILED", message: "The request failed." });
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiRequestError("INVALID_RESPONSE", "The server sent an unexpected response.", response.status);
  }
}

interface StreamMeta {
  conversationId: string;
  messageId: string;
}

export interface StreamEvents {
  onMeta?: (meta: StreamMeta) => void;
  onStage?: (stage: ChatStage, detail?: string) => void;
  onPlan?: (queries: string[]) => void;
  onProgress?: (progress: { completed: number; total: number }) => void;
  onSources?: (sources: Source[]) => void;
  onDelta?: (text: string) => void;
  onCitation?: (position: number) => void;
  onUsage?: (usage: Usage) => void;
  onDone?: (result: { content: string; noSources: boolean; truncated: boolean }) => void;
  onError?: (error: StreamError) => void;
  onStopped?: () => void;
}

export interface StreamHandle {
  stop: () => void;
}

export function streamAnswer(
  input: { conversationId?: string; question: string; mode: Mode },
  events: StreamEvents,
): StreamHandle {
  const controller = new AbortController();
  // Set once a terminal event (done, error, or the server's "stopped" stage) has been delivered.
  let settled = false;
  let stopped = false;
  let messageId: string | undefined;

  const settle = (deliver: () => void) => {
    if (settled) return;
    settled = true;
    deliver();
  };

  const run = async () => {
    let content = "";
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
        const error = await readApiError(response, {
          code: "PROVIDER_ERROR",
          message: "The answer could not be started.",
        });
        settle(() => events.onError?.({ code: error.code, message: error.message, provider: error.provider }));
        return;
      }
      if (!response.body) {
        settle(() => events.onError?.({ code: "PROVIDER_ERROR", message: "The answer stream was empty." }));
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
          switch (event.event) {
            case "meta":
              messageId = (data as StreamMeta).messageId;
              events.onMeta?.(data as StreamMeta);
              break;
            case "stage": {
              const { stage, detail } = data as { stage: ChatStage; detail?: string };
              if (stage === "stopped") settle(() => events.onStage?.(stage, detail));
              else events.onStage?.(stage, detail);
              break;
            }
            case "plan":
              events.onPlan?.((data as { queries: string[] }).queries);
              break;
            case "progress":
              events.onProgress?.(data as { completed: number; total: number });
              break;
            case "sources":
              events.onSources?.(data as Source[]);
              break;
            case "delta":
              {
                const text = (data as { text: string }).text;
                content += text;
                events.onDelta?.(text);
              }
              break;
            case "citation":
              events.onCitation?.((data as { position: number }).position);
              break;
            case "usage":
              events.onUsage?.(data as Usage);
              break;
            case "done": {
              const result = data as { noSources?: boolean; truncated?: boolean };
              settle(() =>
                events.onDone?.({
                  content,
                  noSources: result.noSources ?? false,
                  truncated: result.truncated ?? false,
                }),
              );
              break;
            }
            case "error":
              settle(() => events.onError?.(data as StreamError));
              break;
            default:
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
      settle(() =>
        events.onError?.({ code: "STREAM_ENDED", message: "The connection closed before the answer finished." }),
      );
    } catch (error) {
      if (controller.signal.aborted || stopped) {
        settle(() => events.onStopped?.());
        return;
      }
      settle(() =>
        events.onError?.({
          code: "NETWORK",
          message: error instanceof Error ? error.message : "The connection was interrupted.",
        }),
      );
    } finally {
      // Release the connection when we leave the loop early (error or abort).
      if (reader) void reader.cancel().catch(() => {});
      if (controller.signal.aborted) settle(() => events.onStopped?.());
    }
  };

  void run();

  return {
    stop() {
      if (settled || stopped) return;
      stopped = true;
      if (messageId) {
        void fetch("/api/chat/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId }),
        }).catch(() => {});
      }
      controller.abort();
    },
  };
}

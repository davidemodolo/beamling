"use client";

import { createParser } from "eventsource-parser";
import type { ChatStage, Mode, Source, Usage } from "./types";

class ApiRequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public provider?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    let code = "REQUEST_FAILED";
    let message = "The request failed.";
    let provider: string | undefined;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string; provider?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      provider = body.error?.provider;
    } catch {}
    throw new ApiRequestError(code, message, response.status, provider);
  }
  return (await response.json()) as T;
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
  onDone?: (result: { content: string; status: "complete" | "stopped"; noSources: boolean }) => void;
  onError?: (error: { code: string; message: string; provider?: string }) => void;
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
  let completed = false;
  let stopped = false;
  let messageId: string | undefined;

  const run = async () => {
    let content = "";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        let code = "PROVIDER_ERROR";
        let message = "The answer could not be started.";
        let provider: string | undefined;
        try {
          const body = (await response.json()) as { error?: { code?: string; message?: string; provider?: string } };
          code = body.error?.code ?? code;
          message = body.error?.message ?? message;
          provider = body.error?.provider;
        } catch {}
        events.onError?.({ code, message, provider });
        return;
      }
      if (!response.body) {
        events.onError?.({ code: "PROVIDER_ERROR", message: "The answer stream was empty." });
        return;
      }

      const parser = createParser({
        onEvent(event) {
          if (!event.data) return;
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
            case "stage":
              events.onStage?.(
                (data as { stage: ChatStage }).stage,
                (data as { detail?: string }).detail,
              );
              break;
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
            case "done":
              completed = true;
              events.onDone?.({
                content,
                status: "complete",
                noSources: (data as { noSources?: boolean }).noSources ?? false,
              });
              break;
            case "error":
              events.onError?.(data as { code: string; message: string; provider?: string });
              break;
            default:
              break;
          }
        },
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      reader.releaseLock();
    } catch (error) {
      if (controller.signal.aborted || stopped) {
        events.onStopped?.();
        return;
      }
      events.onError?.({
        code: "NETWORK",
        message: error instanceof Error ? error.message : "The connection was interrupted.",
      });
    } finally {
      if (!completed && !stopped && controller.signal.aborted) events.onStopped?.();
    }
  };

  void run();

  return {
    stop() {
      if (completed || stopped) return;
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

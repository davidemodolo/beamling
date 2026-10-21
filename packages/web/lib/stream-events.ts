import type { ChatStage, DoneEvent, SearchTrace, Source, Usage } from "./types";

export interface StreamError {
  code: string;
  message: string;
  provider?: string;
}

export interface StreamMeta {
  conversationId: string;
  messageId: string;
  userMessageId: string;
  /** Conversations the server deleted to keep the account within its cap. */
  removed: string[];
}

export interface StreamProgress {
  completed: number;
  total: number;
}

export type StreamEvent =
  | { event: "meta"; data: StreamMeta }
  | { event: "stage"; data: { stage: ChatStage; detail?: string } }
  | { event: "plan"; data: { queries: string[] } }
  | { event: "search"; data: SearchTrace }
  | { event: "progress"; data: StreamProgress }
  | { event: "sources"; data: Source[] }
  | { event: "delta"; data: { text: string } }
  | { event: "reasoning"; data: { text: string } }
  | { event: "citation"; data: { position: number } }
  | { event: "usage"; data: Usage }
  | { event: "done"; data: DoneEvent }
  | { event: "error"; data: StreamError };

const STAGES: readonly ChatStage[] = [
  "empty",
  "queued",
  "searching",
  "reading",
  "writing",
  "done",
  "stopped",
  "no-sources",
  "error",
];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Validates one SSE event. Unknown names and malformed payloads are ignored by the client. */
export function parseStreamEvent(name: string, input: unknown): StreamEvent | null {
  const data = record(input);
  if (!data) return null;
  switch (name) {
    case "meta": {
      const conversationId = text(data.conversationId);
      const messageId = text(data.messageId);
      const userMessageId = text(data.userMessageId);
      const removed = Array.isArray(data.removed) ? data.removed.filter((id): id is string => typeof id === "string") : [];
      return conversationId && messageId && userMessageId
        ? { event: "meta", data: { conversationId, messageId, userMessageId, removed } }
        : null;
    }
    case "stage": {
      const stage = text(data.stage);
      if (!stage || !STAGES.includes(stage as ChatStage)) return null;
      return { event: "stage", data: { stage: stage as ChatStage, detail: text(data.detail) ?? undefined } };
    }
    case "plan": {
      const queries = Array.isArray(data.queries) ? data.queries.filter((item): item is string => typeof item === "string") : null;
      return queries ? { event: "plan", data: { queries } } : null;
    }
    case "search": {
      const query = text(data.query);
      const status = text(data.status);
      if (!query || (status !== "searching" && status !== "done" && status !== "failed")) return null;
      const results = count(data.results);
      return { event: "search", data: { query, status, results: results ?? undefined } };
    }
    case "progress": {
      const completed = count(data.completed);
      const total = count(data.total);
      return completed !== null && total !== null ? { event: "progress", data: { completed, total } } : null;
    }
    case "sources":
      return Array.isArray(data) ? { event: "sources", data: data as Source[] } : null;
    case "delta": {
      const value = text(data.text);
      return value !== null ? { event: "delta", data: { text: value } } : null;
    }
    case "reasoning": {
      const value = text(data.text);
      return value !== null ? { event: "reasoning", data: { text: value } } : null;
    }
    case "citation": {
      const position = count(data.position);
      return position !== null ? { event: "citation", data: { position } } : null;
    }
    case "usage":
      return { event: "usage", data: data as unknown as Usage };
    case "done":
      return { event: "done", data: data as unknown as DoneEvent };
    case "error": {
      const code = text(data.code);
      const message = text(data.message);
      return code && message ? { event: "error", data: { code, message, provider: text(data.provider) ?? undefined } } : null;
    }
    default:
      return null;
  }
}

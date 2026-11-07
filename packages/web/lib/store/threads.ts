import type { Conversation, ConversationSummary, Message } from "../types";

/**
 * A message as the thread shows it. "failed" marks a question and error that never reached the
 * server (kept until the user retries); "provisional" marks streamed text shown because the reload
 * after an answer failed (replaced by the next successful load).
 */
export type ThreadMessage = Message & { local?: "failed" | "provisional" };

export interface ThreadState {
  status: "loading" | "ready" | "missing" | "error";
  conversation: ConversationSummary | null;
  messages: ThreadMessage[];
  hasMore: boolean;
  loadingEarlier: boolean;
  error?: string;
}

export function toSummary(conversation: Conversation): ConversationSummary {
  const { id, title, mode, pinned, createdAt, updatedAt } = conversation;
  return { id, title, mode, pinned, createdAt, updatedAt };
}

export function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export function upsertSummary(list: ConversationSummary[], summary: ConversationSummary): ConversationSummary[] {
  return list.some((item) => item.id === summary.id)
    ? list.map((item) => (item.id === summary.id ? summary : item))
    : [summary, ...list];
}

/**
 * Merges a freshly loaded newest page into the thread: earlier pages the user already loaded are
 * kept, provisional copies are dropped, and failed local messages stay at the end.
 */
export function mergeThread(previous: ThreadState | undefined, conversation: Conversation): ThreadState {
  const page = conversation.messages;
  const pageIds = new Set(page.map((message) => message.id));
  const firstAt = page[0]?.createdAt;
  const stored = previous?.messages.filter((message) => !message.local) ?? [];
  // Earlier pages are kept only when the new page overlaps them. A complete page replaces
  // everything, and a page with no overlap (many messages arrived elsewhere) would leave a gap.
  const contiguous = conversation.hasMoreMessages && stored.some((message) => pageIds.has(message.id));
  const earlier =
    firstAt && contiguous
      ? stored.filter((message) => !pageIds.has(message.id) && message.createdAt < firstAt)
      : [];
  const failed = previous?.messages.filter((message) => message.local === "failed") ?? [];
  return {
    status: "ready",
    conversation: toSummary(conversation),
    messages: [...earlier, ...page, ...failed],
    hasMore: earlier.length ? (previous?.hasMore ?? false) : conversation.hasMoreMessages,
    loadingEarlier: false,
  };
}

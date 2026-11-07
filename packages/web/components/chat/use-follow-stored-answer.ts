"use client";

import { useEffect } from "react";
import type { ThreadMessage } from "@/lib/store";

/** How often a conversation is reloaded while an answer from elsewhere is still being written. */
const STREAMING_POLL_MS = 4000;

/**
 * An answer started in another tab (or before a reload) is still being written: reload the thread
 * until it finishes. Returns that stored answer, or undefined when there is none or this tab is
 * streaming it.
 */
export function useFollowStoredAnswer(input: {
  conversationId: string | null;
  messages: ThreadMessage[] | undefined;
  streamingHere: boolean;
  reload: (conversationId: string) => Promise<unknown>;
}): ThreadMessage | undefined {
  const { conversationId, messages, streamingHere, reload } = input;
  const stored = streamingHere
    ? undefined
    : messages?.find((message) => message.role === "assistant" && (message.status === "streaming" || message.status === "pending"));
  const following = !!stored;

  useEffect(() => {
    if (!following || !conversationId) return;
    const timer = window.setInterval(() => void reload(conversationId).catch(() => {}), STREAMING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [following, conversationId, reload]);

  return stored;
}

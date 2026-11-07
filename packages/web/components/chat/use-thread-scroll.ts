"use client";

import { useCallback, useEffect, useRef } from "react";

/** Distance from the bottom, in pixels, within which the thread keeps following new text. */
const STICK_THRESHOLD_PX = 160;

/**
 * Keeps the thread scrolled to the bottom while new content arrives (streamed text, a stage change,
 * another message), until the user scrolls up.
 */
export function useThreadScroll(content: { liveText?: string; liveStage?: string; messageCount: number }) {
  const { liveText, liveStage, messageCount } = content;
  const threadRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (!stickRef.current) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveText, liveStage, messageCount]);

  const onScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }, []);

  return {
    threadRef,
    onScroll,
    /** Follow new text again, e.g. when the user asks a question. */
    stick: useCallback(() => {
      stickRef.current = true;
    }, []),
    /** Stop following, e.g. while earlier messages are prepended above. */
    release: useCallback(() => {
      stickRef.current = false;
    }, []),
  };
}

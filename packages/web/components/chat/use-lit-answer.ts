import { useEffect, useState } from "react";
import type { LiveAnswer } from "@/lib/answer-streams";

/** The answer that just finished streaming here, for a moment; the mascot lights its sources. */
export function useLitAnswer(live: LiveAnswer | undefined): string | null {
  const [streamedId, setStreamedId] = useState<string | null>(live?.messageId ?? null);
  const [litId, setLitId] = useState<string | null>(null);
  const liveId = live?.messageId ?? null;
  if (liveId && liveId !== streamedId) setStreamedId(liveId);
  if (!live && streamedId) {
    setStreamedId(null);
    setLitId(streamedId);
  }
  useEffect(() => {
    if (!litId) return;
    const timer = window.setTimeout(() => setLitId(null), 2600);
    return () => window.clearTimeout(timer);
  }, [litId]);
  return litId;
}

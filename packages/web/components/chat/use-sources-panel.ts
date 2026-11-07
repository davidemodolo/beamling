"use client";

import { useCallback, useState } from "react";
import type { LiveAnswer } from "@/lib/answer-streams";
import { searchProviderName } from "@/lib/provider-catalog";
import type { ThreadMessage } from "@/lib/store";
import type { SearchProvider, Source } from "@/lib/types";

/**
 * Which answer's sources are shown and how: the side panel on desktop, a sheet on mobile. While an
 * answer streams its live sources are shown; otherwise the answer the user last opened, or the latest.
 */
export function useSourcesPanel(input: {
  live: LiveAnswer | undefined;
  messages: ThreadMessage[];
  searchProvider: SearchProvider;
  isMobile: boolean;
  showToast: (message: string) => void;
}) {
  const { live, messages, searchProvider, isMobile, showToast } = input;
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const lastAssistant = messages.findLast((message) => message.role === "assistant");
  const contextMessage = (sourceMessageId && messages.find((message) => message.id === sourceMessageId)) || lastAssistant;
  const sources = live ? live.sources : (contextMessage?.sources ?? []);
  const providerName = searchProviderName(live?.searchProvider ?? contextMessage?.searchProvider ?? searchProvider);
  const loading = !!live && !live.sources.length && (live.stage === "searching" || live.stage === "reading");
  const panelOpen = !hidden && (sources.length > 0 || loading);

  /** A new answer starts: show its sources from scratch. */
  const reset = useCallback(() => {
    setActiveSource(null);
    setSourceMessageId(null);
    setSheetOpen(false);
    setHidden(false);
  }, []);

  const openSource = useCallback(
    (source: Source) => {
      setActiveSource(source.position);
      const scrollToSource = () => {
        document.getElementById(`source-${source.position}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
      if (isMobile) {
        setSheetOpen(true);
        window.setTimeout(scrollToSource, 160);
        return;
      }
      setHidden(false);
      window.setTimeout(scrollToSource, 90);
    },
    [isMobile],
  );

  const onCitation = useCallback(
    (messageId: string, source: Source) => {
      setSourceMessageId(messageId);
      openSource(source);
    },
    [openSource],
  );

  const onOpenSources = useCallback(
    (messageId: string) => {
      setSourceMessageId(messageId);
      if (isMobile) setSheetOpen(true);
      else setHidden(false);
    },
    [isMobile],
  );

  const openPosition = (list: Source[], position: number) => {
    const source = list.find((item) => item.position === position);
    if (source) openSource(source);
  };

  const toggle = () => {
    if (isMobile) {
      setSheetOpen(true);
      return;
    }
    if (!sources.length && !loading) {
      showToast("This answer has no sources");
      return;
    }
    setHidden((value) => !value);
  };

  return {
    sources,
    providerName,
    activeSource,
    loading,
    hidden,
    panelOpen,
    sheetOpen,
    reset,
    toggle,
    onCitation,
    onOpenSources,
    /** A citation in the streaming answer. */
    onLiveCitation: (position: number) => openPosition(live?.sources ?? [], position),
    /** A source picked in the mobile sheet. */
    onSheetSelect: (position: number) => {
      setActiveSource(position);
      openPosition(sources, position);
    },
    selectSource: setActiveSource,
    closePanel: () => setHidden(true),
    closeSheet: () => setSheetOpen(false),
  };
}

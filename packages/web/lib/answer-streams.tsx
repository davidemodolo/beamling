"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Attachment } from "./attachments";
import { streamAnswer, type StreamError, type StreamHandle } from "./api";
import { chatUploads, historyAttachments } from "./chat-images";
import { attachmentQuestionTitle } from "./data";
import type { PreparedFile, PreparedImage } from "./images";
import { useAccount, useConversations, withoutKey, type ThreadMessage } from "./store";
import type { ChatStage, DoneEvent, Mode, SearchProvider, SearchTrace, Source } from "./types";
import { createId } from "./utils";

export const STAGE_LABEL: Record<ChatStage, string> = {
  empty: "Ask a question",
  queued: "Thinking",
  searching: "Searching the web",
  reading: "Reading sources",
  writing: "Writing",
  done: "Answer complete",
  stopped: "Answer stopped",
  "no-sources": "No reliable sources",
  error: "The provider returned an error",
};

/** A question: its text (empty when it is only attachments) and its images and text files. */
export interface Ask {
  text: string;
  attachments: Attachment[];
}

/** An answer being streamed into a conversation. */
export interface LiveAnswer {
  conversationId: string;
  /** Stored ids, known once the server sends "meta". */
  messageId: string | null;
  userMessageId: string | null;
  /** The question shown in the thread while it is answered: a new one, or the edited one. Absent when an answer is only replaced. */
  ask?: Ask;
  /** The stored answer this run replaces. */
  replaces?: string;
  /** The stored question an edit rewrites; `ask` stands in for it. */
  replacesQuestion?: string;
  mode: Mode;
  searchProvider: SearchProvider;
  content: string;
  reasoning: string;
  searches: SearchTrace[];
  sources: Source[];
  stage: ChatStage;
  detail: string;
  citations: number;
  stopping: boolean;
}

export interface StartAnswer {
  conversationId: string;
  mode: Mode;
  searchProvider?: SearchProvider;
  /**
   * A new question. With `retryOf` it is the edited text of the latest question (its attachments are
   * the stored ones); without `ask`, `retryOf` reuses the stored question.
   */
  ask?: Ask;
  /** Images and text files just picked for `ask`, to keep on this device for follow-ups. */
  picked?: PreparedImage[];
  pickedFiles?: PreparedFile[];
  /** The latest stored answer to replace. */
  retryOf?: string;
  /** The stored question being edited (with `ask` and `retryOf`). */
  editOf?: string;
  /** Told when the server refused to replace an answer; the stored exchange is unchanged. */
  onRefused?: (message: string) => void;
}

interface StreamsValue {
  live: Record<string, LiveAnswer>;
  /** Latest screen-reader announcement per conversation. */
  announcements: Record<string, string>;
  /** Starts an answer; false when one is already running in that conversation. */
  start: (input: StartAnswer) => boolean;
  stop: (conversationId: string) => void;
}

const StreamsContext = createContext<StreamsValue | null>(null);

function doneMessage(result: DoneEvent): string {
  if (result.noSources) return "Answer complete, but no reliable sources were found.";
  if (result.truncated) return "Answer complete. It was cut short at the length limit.";
  if (result.searchFailures) return "Answer complete. Some searches failed, so it uses fewer sources.";
  return "Answer complete.";
}

/**
 * Owns every running answer for the chat shell, keyed by conversation. Answers keep streaming when
 * the user switches conversations, and each view shows only its own conversation's answer.
 */
export function AnswerStreamsProvider({ children }: { children: ReactNode }) {
  const { settings } = useAccount();
  const { addMessages, updateMessage, removeMessages, loadThread, titleFromFirstQuestion, dropFailedMessages, forgetConversations, threads } = useConversations();
  const [live, setLive] = useState<Record<string, LiveAnswer>>({});
  const [announcements, setAnnouncements] = useState<Record<string, string>>({});
  const handles = useRef(new Map<string, StreamHandle>());
  const alive = useRef(false);
  const latest = useRef({ threads, settings });

  useEffect(() => {
    latest.current = { threads, settings };
  });

  useEffect(() => {
    alive.current = true;
    const running = handles.current;
    return () => {
      // Leaving the chat shell disconnects; the server stores each answer as stopped.
      alive.current = false;
      for (const handle of running.values()) handle.abort();
      running.clear();
    };
  }, []);

  const start = useCallback(
    (input: StartAnswer): boolean => {
      const { conversationId, mode, ask } = input;
      const searchProvider = input.searchProvider ?? latest.current.settings.defaultSearchProvider;
      if (!alive.current || handles.current.has(conversationId)) return false;
      const llmModel = latest.current.settings.llmModel;
      const attachments = ask?.attachments.length ? ask.attachments : undefined;

      const patch = (update: (answer: LiveAnswer) => LiveAnswer) =>
        setLive((current) => (current[conversationId] ? { ...current, [conversationId]: update(current[conversationId]) } : current));
      const announce = (text: string) => setAnnouncements((current) => ({ ...current, [conversationId]: text }));
      const removeLive = () => setLive((current) => withoutKey(current, conversationId));

      let messageId: string | null = null;
      let userMessageId: string | null = null;
      const knownIds = new Set(latest.current.threads[conversationId]?.messages.map((message) => message.id));
      let content = "";
      let reasoning = "";
      let searches: SearchTrace[] = [];
      let sources: Source[] = [];
      let finished = false;
      // Deltas arrive per token; batch React updates to at most one animation frame so Markdown
      // does not re-parse the whole answer for every token.
      let pendingContent = "";
      let pendingReasoning = "";
      let flushFrame: number | null = null;
      const flushBuffered = () => {
        if (flushFrame !== null) {
          cancelAnimationFrame(flushFrame);
          flushFrame = null;
        }
        const contentChunk = pendingContent;
        const reasoningChunk = pendingReasoning;
        pendingContent = "";
        pendingReasoning = "";
        if (!contentChunk && !reasoningChunk) return;
        patch((current) => ({
          ...current,
          content: current.content + contentChunk,
          reasoning: current.reasoning + reasoningChunk,
        }));
      };
      const scheduleFlush = () => {
        if (flushFrame !== null) return;
        flushFrame = requestAnimationFrame(() => {
          flushFrame = null;
          flushBuffered();
        });
      };

      setLive((current) => ({
        ...current,
        [conversationId]: {
          conversationId,
          messageId: null,
          userMessageId: null,
          ask,
          replaces: input.retryOf,
          replacesQuestion: input.editOf,
          mode,
          searchProvider,
          content: "",
          reasoning: "",
          searches: [],
          sources: [],
          stage: "queued",
          detail: "",
          citations: 0,
          stopping: false,
        },
      }));
      announce(`Beamling is ${STAGE_LABEL.queued.toLowerCase()}.`);

      if (ask && !input.retryOf) titleFromFirstQuestion(conversationId, ask.text || attachmentQuestionTitle(ask.attachments));
      // An earlier question that never reached the server would otherwise end up below this answer.
      dropFailedMessages(conversationId);

      const finish = async (stage: ChatStage, message: string, error?: StreamError) => {
        if (finished) return;
        finished = true;
        flushBuffered();
        handles.current.delete(conversationId);
        announce(message);
        const now = new Date().toISOString();

        if (!messageId) {
          // The connection can fail after the server stored the exchange; reload to find out.
          const uncertain =
            stage === "stopped" || ["NETWORK", "STREAM_ENDED", "INTERNAL"].includes(error?.code ?? "");
          if (uncertain) {
            const stored = await loadThread(conversationId).catch(() => null);
            // The request was accepted if the new question is stored, or the replaced answer is gone.
            const accepted = input.retryOf
              ? stored && !stored.messages.some((message) => message.id === input.retryOf)
              : stored?.messages.some(
                  (message) => !knownIds.has(message.id) && message.role === "user" && message.content === ask?.text,
                );
            if (accepted) {
              removeLive();
              return;
            }
          }
          if (stage === "stopped") {
            // Stopped before anything was stored: there is nothing to show.
            removeLive();
            return;
          }
          if (input.retryOf) {
            // The replaced answer is still stored. A failed one shows the new error instead of a
            // second card; a complete one is left as it is and the caller is told.
            const id = input.retryOf;
            if (error) {
              updateMessage(conversationId, id, (current) =>
                current.status === "error" ? { ...current, errorCode: error.code, errorMessage: error.message } : current,
              );
              input.onRefused?.(error.message);
            }
            removeLive();
            return;
          }
          // Nothing was stored: keep the question and the error locally, so the user can retry.
          const local: ThreadMessage[] = [];
          if (ask) {
            local.push({ id: createId("local"), role: "user", content: ask.text, attachments, status: "complete", createdAt: now, local: "failed" });
          }
          if (error) {
            local.push({
              id: createId("local"),
              role: "assistant",
              content: "",
              status: "error",
              createdAt: now,
              mode,
              searchProvider,
              sources: [],
              llmModel,
              errorCode: error.code,
              errorMessage: error.message,
              local: "failed",
            });
          }
          addMessages(conversationId, local);
        } else {
          let refreshed = true;
          try {
            await loadThread(conversationId);
          } catch {
            refreshed = false;
          }
          if (!refreshed) {
            // The server replaced the retried answer when it accepted the retry.
            if (input.retryOf) removeMessages(conversationId, [input.retryOf]);
            // Keep what was streamed on screen until the conversation can be loaded again.
            const status = stage === "stopped" ? "stopped" : error ? "error" : "complete";
            const provisional: ThreadMessage[] = [];
            if (ask && input.editOf) {
              updateMessage(conversationId, input.editOf, (current) => ({ ...current, content: ask.text }));
            } else if (ask && userMessageId) {
              provisional.push({ id: userMessageId, role: "user", content: ask.text, attachments, status: "complete", createdAt: now, local: "provisional" });
            }
            provisional.push({
              id: messageId,
              role: "assistant",
              content,
              status,
              createdAt: now,
              mode,
              searchProvider,
              sources,
              llmModel,
              searches,
              reasoning: reasoning || undefined,
              errorCode: error?.code,
              errorMessage: error?.message,
              local: "provisional",
            });
            addMessages(conversationId, provisional);
          }
          // A row still marked streaming (the connection was cut before the outcome was stored) is left
          // as it is: the view follows it until the server records how it ended.
        }
        removeLive();
      };

      const context = historyAttachments(latest.current.threads[conversationId]?.messages ?? [], input.retryOf);
      const request = { conversationId, mode, searchProvider, question: ask?.text, retryOf: input.retryOf };
      // A replaced answer reuses its question's stored attachments; they travel as earlier ones.
      const own = input.retryOf ? [] : (ask?.attachments ?? []);
      const handle = streamAnswer(
        own.length || context.images.length || context.files.length
          ? chatUploads(conversationId, own, { images: input.picked ?? [], files: input.pickedFiles ?? [] }, context).then(
              (uploads) => ({ ...request, ...uploads }),
            )
          : request,
        {
          onMeta: (meta) => {
            messageId = meta.messageId;
            userMessageId = meta.userMessageId;
            patch((current) => ({ ...current, messageId: meta.messageId, userMessageId: meta.userMessageId }));
            if (meta.removed.length) forgetConversations(meta.removed);
          },
          onStage: (stage, detail) => {
            patch((current) => ({ ...current, stage, detail: detail ?? "" }));
            announce(`${STAGE_LABEL[stage]}${detail ? `: ${detail}` : ""}.`);
          },
          onPlan: (queries) => patch((current) => ({ ...current, detail: `${queries.length} searches planned` })),
          onSearch: (trace) => {
            const replace = (items: SearchTrace[]) => {
              const index = items.findIndex((item) => item.query === trace.query);
              return index < 0 ? [...items, trace] : items.map((item, i) => (i === index ? trace : item));
            };
            searches = replace(searches);
            patch((current) => ({ ...current, searches: replace(current.searches) }));
          },
          onProgress: ({ completed, total }) =>
            patch((current) => ({ ...current, detail: `${completed} of ${total} searches complete` })),
          onSources: (next) => {
            sources = next;
            patch((current) => ({ ...current, sources: next }));
          },
          onReasoning: (text) => {
            reasoning += text;
            pendingReasoning += text;
            scheduleFlush();
          },
          onDelta: (text) => {
            content += text;
            pendingContent += text;
            scheduleFlush();
          },
          onCitation: () => patch((current) => ({ ...current, citations: current.citations + 1 })),
          onDone: (result) => void finish(result.noSources ? "no-sources" : "done", doneMessage(result)),
          onError: (error) => void finish("error", `Error: ${error.message}`, error),
          onStopped: () => void finish("stopped", "Answer stopped. Partial text was kept."),
        },
      );
      handles.current.set(conversationId, handle);
      return true;
    },
    [addMessages, updateMessage, removeMessages, loadThread, titleFromFirstQuestion, dropFailedMessages, forgetConversations],
  );

  const stop = useCallback((conversationId: string) => {
    const handle = handles.current.get(conversationId);
    if (!handle) return;
    setLive((current) =>
      current[conversationId] ? { ...current, [conversationId]: { ...current[conversationId], stopping: true } } : current,
    );
    handle.stop();
  }, []);

  const value = useMemo(() => ({ live, announcements, start, stop }), [live, announcements, start, stop]);
  return <StreamsContext.Provider value={value}>{children}</StreamsContext.Provider>;
}

export function useAnswerStreams(): StreamsValue {
  const streams = useContext(StreamsContext);
  if (!streams) throw new Error("useAnswerStreams must be used inside AnswerStreamsProvider");
  return streams;
}

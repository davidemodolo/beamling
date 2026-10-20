"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BeamlingHandle } from "@beamling/mascot/react";
import { errorMessage, streamAnswer, type StreamHandle } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { ChatStage, Mode, Source } from "@/lib/types";
import { createId } from "@/lib/utils";

export interface LiveAnswer {
  id: string;
  content: string;
  sources: Source[];
}

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

interface StartInput {
  question: string;
  mode: Mode;
  /** False when re-asking: the user message is already in the thread. */
  appendUser: boolean;
  /** Returns the conversation to answer in, creating one if needed. */
  resolveConversation: () => Promise<string>;
}

interface AnswerStreamOptions {
  /** Called right before streaming begins (after the conversation exists). */
  onStart?: () => void;
  /** Called once the server has assigned the assistant message id. */
  onMessageId?: (messageId: string) => void;
  /** Called when the conversation could not be created or resolved. */
  onStartError?: (message: string) => void;
  /** Called after every finished, stopped, or failed answer. */
  onSettled?: () => void;
}

/** Runs one streamed answer at a time and exposes its live state for the chat view. */
export function useAnswerStream(options: AnswerStreamOptions) {
  const { addMessage, updateMessage, refreshConversation, settings } = useStore();
  const [live, setLive] = useState<LiveAnswer | null>(null);
  const [stage, setStage] = useState<ChatStage>("empty");
  const [detail, setDetail] = useState("");
  const [announce, setAnnounce] = useState("");
  const mascotRef = useRef<BeamlingHandle>(null);
  const runRef = useRef<StreamHandle | null>(null);
  // Claimed synchronously so a double submit cannot start two conversations or two streams.
  const busyRef = useRef(false);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const llmModel = settings.llmModel;

  const updateLive = useCallback((updater: (previous: LiveAnswer) => LiveAnswer) => {
    setLive((previous) => (previous ? updater(previous) : previous));
  }, []);

  const start = useCallback(
    async ({ question, mode, appendUser, resolveConversation }: StartInput) => {
      if (busyRef.current) return;
      busyRef.current = true;

      let conversationId: string;
      try {
        conversationId = await resolveConversation();
      } catch (error) {
        busyRef.current = false;
        setStage("error");
        optionsRef.current.onStartError?.(errorMessage(error, "Could not start a conversation."));
        return;
      }

      if (appendUser) {
        addMessage(conversationId, {
          id: createId("pending"),
          role: "user",
          content: question,
          status: "complete",
          createdAt: new Date().toISOString(),
        });
      }

      optionsRef.current.onStart?.();
      setLive({ id: "pending-answer", content: "", sources: [] });
      setStage("queued");
      setDetail("");
      setAnnounce(`Beamling is ${STAGE_LABEL.queued.toLowerCase()}.`);

      let messageId: string | null = null;
      let finishing = false;

      const addLocalError = (error: { code: string; message: string }) => {
        addMessage(conversationId, {
          id: createId("pending"),
          role: "assistant",
          content: "",
          status: "error",
          createdAt: new Date().toISOString(),
          mode,
          sources: [],
          llmModel,
          errorCode: error.code,
          errorMessage: error.message,
        });
      };

      const finish = async (state: ChatStage, message: string, error?: { code: string; message: string }) => {
        if (finishing) return;
        finishing = true;
        setStage(state);
        setAnnounce(message);
        runRef.current = null;
        if (state === "stopped") {
          await new Promise((resolve) => window.setTimeout(resolve, 450));
        }
        let refreshed = true;
        try {
          await refreshConversation(conversationId);
        } catch {
          refreshed = false;
        }
        if (error) {
          if (!refreshed || !messageId) {
            addLocalError(error);
          } else {
            const id = messageId;
            // If the server never recorded an outcome (e.g. the stream was cut), show the error locally.
            updateMessage(conversationId, id, (current) =>
              current.status === "pending" || current.status === "streaming"
                ? { ...current, status: "error", errorCode: error.code, errorMessage: error.message }
                : current,
            );
          }
        }
        setLive(null);
        busyRef.current = false;
        optionsRef.current.onSettled?.();
      };

      runRef.current = streamAnswer(
        { conversationId, question, mode },
        {
          onMeta: (meta) => {
            messageId = meta.messageId;
            updateLive((current) => ({ ...current, id: meta.messageId }));
            optionsRef.current.onMessageId?.(meta.messageId);
          },
          onStage: (nextStage, nextDetail) => {
            setStage(nextStage);
            setDetail(nextDetail ?? "");
            setAnnounce(`${STAGE_LABEL[nextStage]}${nextDetail ? `: ${nextDetail}` : ""}.`);
            if (nextStage === "stopped") {
              void finish("stopped", "Answer stopped. Partial text was kept.");
            }
          },
          onPlan: (queries) => {
            setDetail(`${queries.length} searches planned`);
          },
          onProgress: ({ completed, total }) => {
            setDetail(`${completed} of ${total} searches complete`);
          },
          onSources: (sources) => {
            updateLive((current) => ({ ...current, sources }));
            if (sources.length) mascotRef.current?.pulse(0.25);
          },
          onDelta: (text) => {
            updateLive((current) => ({ ...current, content: current.content + text }));
          },
          onCitation: () => {
            mascotRef.current?.pulse();
          },
          onDone: (result) => {
            void finish(
              result.noSources ? "no-sources" : "done",
              result.noSources
                ? "Answer complete, but no reliable sources were found."
                : result.truncated
                  ? "Answer complete. It was cut short at the length limit."
                  : "Answer complete.",
            );
          },
          onError: (error) => {
            if (!messageId) {
              // Nothing was persisted on the server, so record the failure locally.
              addLocalError(error);
              setStage("error");
              setAnnounce(`Error: ${error.message}`);
              setLive(null);
              runRef.current = null;
              busyRef.current = false;
              optionsRef.current.onSettled?.();
              return;
            }
            void finish("error", `Error: ${error.message}`, error);
          },
          onStopped: () => {
            void finish("stopped", "Answer stopped. Partial text was kept.");
          },
        },
      );
    },
    [addMessage, updateMessage, refreshConversation, llmModel, updateLive],
  );

  const stop = useCallback(() => runRef.current?.stop(), []);

  useEffect(() => {
    return () => {
      runRef.current?.stop();
      runRef.current = null;
    };
  }, []);

  return { live, stage, detail, announce, mascotRef, start, stop };
}

import type { Mode } from "../../types";
import { newCitations } from "../citations";
import { detectLanguage } from "../language";
import { deepPrompt, deeperPrompt, quickPrompt, type Prompt } from "../prompts";
import { chat } from "../providers";
import type { ChatResult } from "../providers/openrouter";
import { addUsage, promptMessages, type PreparedChat, type RunContext, type RunState } from "./context";

const SYNTHESIS_MAX_TOKENS: Record<Mode, number> = { quick: 8192, deep: 16384, deeper: 24576 };

function synthesisPrompt(prepared: PreparedChat, state: RunState, queries: string[]): Prompt {
  const { question, history } = prepared;
  const language = detectLanguage(question);
  switch (prepared.mode) {
    case "deeper":
      return deeperPrompt({ question, sources: state.sources, queries, history, language });
    case "deep":
      return deepPrompt({ question, sources: state.sources, subqueries: queries, history, language });
    case "quick":
      return quickPrompt({ question, sources: state.sources, history, language });
  }
}

/** Streams the final answer and emits citations as they complete. */
export async function streamSynthesis(ctx: RunContext, state: RunState, queries: string[]): Promise<ChatResult> {
  const { prepared, signal, emit } = ctx;
  emit("stage", { stage: "writing", detail: `Writing with ${prepared.model}` });
  const seen = new Set<number>();
  const result = await chat({
    purpose: "answer",
    key: prepared.llmKey,
    model: prepared.model,
    messages: promptMessages(synthesisPrompt(prepared, state, queries)),
    maxTokens: SYNTHESIS_MAX_TOKENS[prepared.mode],
    signal,
    onReasoning: (text) => {
      state.reasoning += text;
      emit("reasoning", { text });
    },
    onDelta: (text) => {
      state.content += text;
      emit("delta", { text });
      // A citation can only complete on a delta that contains its closing bracket.
      if (!text.includes("]")) return;
      for (const position of newCitations(state.content, state.sources.length, seen)) {
        emit("citation", { position });
      }
    },
  });
  addUsage(state, result);
  state.resolvedModel = result.model;
  state.upstreamProvider = result.provider;
  return result;
}

import type { Mode } from "../../types";
import { newCitations } from "../citations";
import { detectLanguage } from "../language";
import { deepPrompt, deeperPrompt, quickPrompt, type Prompt } from "../prompts";
import { chat } from "../providers";
import type { ChatResult } from "../providers/llm";
import { addUsage, askedQuestion, imageParts, promptMessages, type PreparedChat, type RunContext, type RunState } from "./context";

const SYNTHESIS_MAX_TOKENS: Record<Mode, number> = { quick: 8192, deep: 16384, deeper: 24576 };

function synthesisPrompt(prepared: PreparedChat, state: RunState, queries: string[]): Prompt {
  const { history } = prepared;
  const question = askedQuestion(prepared);
  const language = prepared.question ? detectLanguage(prepared.question) : undefined;
  const common = { question, sources: state.sources, history, language, images: prepared.imageIds };
  switch (prepared.mode) {
    case "deeper":
      return deeperPrompt({ ...common, queries });
    case "deep":
      return deepPrompt({ ...common, subqueries: queries });
    case "quick":
      return quickPrompt(common);
  }
}

/** Streams the final answer and emits citations as they complete. */
export async function streamSynthesis(ctx: RunContext, state: RunState, queries: string[]): Promise<ChatResult> {
  const { prepared, signal, emit } = ctx;
  emit("stage", { stage: "writing", detail: `Writing with ${prepared.llm.name}` });
  const seen = new Set<number>();
  const result = await chat({
    purpose: "answer",
    key: prepared.llmKey,
    model: prepared.llm,
    messages: promptMessages(synthesisPrompt(prepared, state, queries), imageParts(prepared)),
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

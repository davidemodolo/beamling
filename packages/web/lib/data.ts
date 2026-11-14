import { DEFAULT_LLM_MODEL, DEFAULT_SEARCH_PROVIDER } from "./provider-catalog";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  llmModel: DEFAULT_LLM_MODEL,
  defaultSearchProvider: DEFAULT_SEARCH_PROVIDER,
  defaultMode: "quick",
  analyticsOptOut: false,
};

export const DEFAULT_CONVERSATION_TITLE = "New conversation";
/** Conversation title for a question that is only attachments. */
export function attachmentQuestionTitle(attachments: { kind: string }[]): string {
  if (!attachments.length) return "";
  return attachments.some((item) => item.kind === "image") ? "Image question" : "File question";
}

/** Messages before the question that the prompt includes as conversation history. */
export const HISTORY_MESSAGES = 6;

/** Conversation summaries per page in the sidebar. */
export const CONVERSATION_PAGE_SIZE = 50;

/** Messages per page in a conversation thread (newest first, shown oldest first). */
export const MESSAGE_PAGE_SIZE = 60;

/** Title derived from the first question of a conversation. */
export function titleFromQuestion(question: string): string {
  return question.replace(/\s+/g, " ").trim().slice(0, 48) || DEFAULT_CONVERSATION_TITLE;
}

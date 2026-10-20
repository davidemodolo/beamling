import type { Activity } from "./engine.js";
import type { Expression } from "./expressions.js";

/** Answer states from the product spec (§16.4). */
export type AnswerState = "empty" | "queued" | "searching" | "reading" | "writing" | "done" | "stopped" | "no-sources" | "error";

/** How Beamling reacts to each answer state. */
export const ANSWER_STATE_MOOD: Record<AnswerState, { expression: Expression; activity: Activity }> = {
  empty: { expression: "neutral", activity: "idle" },
  queued: { expression: "curious", activity: "thinking" },
  searching: { expression: "focused", activity: "searching" },
  reading: { expression: "focused", activity: "reading" },
  writing: { expression: "neutral", activity: "writing" },
  done: { expression: "happy", activity: "idle" },
  stopped: { expression: "sleepy", activity: "idle" },
  "no-sources": { expression: "confused", activity: "idle" },
  error: { expression: "sad", activity: "idle" },
};

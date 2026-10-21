import type { Mode } from "./types";

export const MODES: readonly Mode[] = ["quick", "deep", "deeper"];

export const MODE_LABELS: Record<Mode, string> = {
  quick: "Quick",
  deep: "Deep",
  deeper: "Deeper",
};

export const MODE_HINTS: Record<Mode, string> = {
  quick: "One search pass and a concise answer.",
  deep: "Planned sub-queries and a longer report.",
  deeper: "An agentic research loop with up to 60 searches.",
};

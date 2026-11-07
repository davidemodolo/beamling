import type { Mode } from "./contracts";

export { MODES } from "./contracts";

export const MODE_LABELS: Record<Mode, string> = {
  quick: "Quick",
  deep: "Deep",
  deeper: "Deeper",
};

export const MODE_ICONS: Record<Mode, "zap" | "layers" | "sparkles"> = {
  quick: "zap",
  deep: "layers",
  deeper: "sparkles",
};

export const MODE_HINTS: Record<Mode, string> = {
  quick: "One search pass and a concise answer.",
  deep: "Planned sub-queries and a longer report.",
  deeper: "An agentic research loop with up to 60 searches.",
};

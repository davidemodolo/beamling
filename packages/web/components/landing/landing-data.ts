import { ALL_PROVIDERS, MODEL_GROUPS, SEARCH_PROVIDERS } from "@/lib/provider-catalog";
import { orList } from "@/lib/utils";

export const LLM_NAMES = MODEL_GROUPS.map((group) => group.provider.shortName);
export const SEARCH_NAMES = SEARCH_PROVIDERS.map((provider) => provider.shortName);

export const FEATURES = [
  {
    title: "Sources first",
    body: "A factual claim without a citation is a bug. Every number opens the exact source beside the answer, with the snippet that supports it.",
    icon: "book" as const,
    label: "01",
  },
  {
    title: "Your keys, your models",
    body: `Generation runs on ${orList(LLM_NAMES)} and retrieval on ${orList(SEARCH_NAMES)}. Your credentials do the work, with no shared provider account and no markup.`,
    icon: "key" as const,
    label: "02",
  },
  {
    title: "Nothing hidden",
    body: "Model, search provider, cost and latency on every answer, with token counts one hover away. If a provider fails, Beamling says so instead of switching silently.",
    icon: "chart" as const,
    label: "03",
  },
];

export const STEPS = [
  {
    title: "Connect your keys",
    body: "Pick a language model and a search provider. Paste the keys once; they are validated, encrypted, and never returned.",
  },
  {
    title: "Ask anything",
    body: "Quick runs one search pass. Deep plans sub-queries. Deeper gives the model a search tool and lets it research in rounds, up to 60 searches, before writing the report.",
  },
  {
    title: "Check the sources",
    body: "Every claim carries a number. Open the panel, read the snippet, follow the link. The answer is the map; the sources are the territory.",
  },
];

export const STATS = [
  { value: "3 s", label: "target p95 to first token" },
  { value: "8", label: "up to 8 sources per quick answer" },
  { value: "0%", label: "markup on your keys" },
  { value: String(ALL_PROVIDERS.length), label: "providers to choose from" },
];

export const LLM_NAMES = ["OpenRouter"] as const;
export const SEARCH_NAMES = ["Brave"] as const;

export const FEATURES = [
  {
    title: "Sources first",
    body: "A factual claim without a citation is a bug. Every number opens the exact source beside the answer, with the snippet that supports it.",
    icon: "book" as const,
    label: "01",
  },
  {
    title: "Your keys, your models",
    body: "Alpha 1 uses OpenRouter for generation and Brave Search for retrieval. Your credentials do the work, with no shared provider account and no markup.",
    icon: "key" as const,
    label: "02",
  },
  {
    title: "Nothing hidden",
    body: "Model, search provider, token counts, latency and estimated cost on every answer. If a provider fails, Beamling says so instead of switching silently.",
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
  { value: "3 s", label: "p95 to first token" },
  { value: "8", label: "sources per quick answer" },
  { value: "0%", label: "markup on your keys" },
  { value: "1 + 1", label: "providers in Alpha" },
];

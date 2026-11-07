import { MODE_HINTS, MODE_ICONS, MODE_LABELS, MODES } from "@/lib/modes";
import { MODEL_GROUPS, PROVIDERS, SEARCH_PROVIDERS } from "@/lib/provider-catalog";
import { orList } from "@/lib/utils";

export const LLM_NAMES = MODEL_GROUPS.map((group) => group.provider.shortName);
export const SEARCH_NAMES = SEARCH_PROVIDERS.map((provider) => provider.shortName);

/** The setup path, step by step. */
export const FREE_STEPS = [
  { title: "Sign in with Google", body: "No password needed.", cost: "Beamling" },
  {
    title: "Get an OpenRouter key",
    body: "OpenRouter lists some free models.",
    cost: "Your account",
    href: PROVIDERS.openrouter.keyUrl,
  },
  {
    title: "Get a Brave Search key",
    body: "Pick a plan on Brave.",
    cost: "Your account",
    href: PROVIDERS.brave.keyUrl,
  },
];

const MODE_DETAILS = {
  quick: "One search, a short cited answer.",
  deep: "Splits the question and searches each part.",
  deeper: "Keeps searching, then writes a report.",
};

export const MODE_CARDS = MODES.map((mode) => ({
  mode,
  label: MODE_LABELS[mode],
  icon: MODE_ICONS[mode],
  hint: MODE_HINTS[mode],
  body: MODE_DETAILS[mode],
}));

export const PRINCIPLES = [
  { icon: "book" as const, title: "Sources first", body: "Every claim links to its source." },
  { icon: "chart" as const, title: "Nothing hidden", body: "Model, estimated cost and time on every answer." },
  { icon: "lock" as const, title: "Your keys stay yours", body: "Encrypted at rest, no markup." },
  { icon: "globe" as const, title: "Open source", body: "MIT licensed." },
];

export const FAQ = [
  {
    q: "Is it free?",
    a: "Beamling charges nothing. Providers bill you under their own plans.",
  },
  {
    q: "Why my own keys?",
    a: "You choose the providers and deal with them directly. Beamling adds no markup.",
  },
  {
    q: "Who handles limits and billing?",
    a: "Your provider accounts. Limits, costs and data use follow each provider's terms.",
  },
  {
    q: "Can I use Claude, GPT or Gemini?",
    a: `Yes, through OpenRouter. Search runs on ${orList(SEARCH_NAMES)}.`,
  },
  {
    q: "Where is my data?",
    a: "Beamling stores it in the EU, encrypted. Export or delete it any time. What reaches a provider follows its terms.",
  },
];

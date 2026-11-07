import { MODE_HINTS, MODE_ICONS, MODE_LABELS, MODES } from "@/lib/modes";
import { MODEL_GROUPS, PROVIDERS, SEARCH_PROVIDERS } from "@/lib/provider-catalog";
import { orList } from "@/lib/utils";

export const LLM_NAMES = MODEL_GROUPS.map((group) => group.provider.shortName);
export const SEARCH_NAMES = SEARCH_PROVIDERS.map((provider) => provider.shortName);

/** The free setup path, step by step. */
export const FREE_STEPS = [
  { title: "Sign in with Google", body: "No password needed.", cost: "Free" },
  {
    title: "Get an OpenRouter key",
    body: "Free models, no card.",
    cost: "Free plan",
    href: PROVIDERS.openrouter.keyUrl,
  },
  {
    title: "Get a Brave Search key",
    body: "Brave has a free plan.",
    cost: "Free plan",
    href: PROVIDERS.brave.keyUrl,
  },
];

const MODE_DETAILS = {
  quick: "One search, a cited answer in seconds.",
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
  { icon: "chart" as const, title: "Nothing hidden", body: "Model, cost and time shown on every answer." },
  { icon: "lock" as const, title: "Your keys stay yours", body: "Encrypted at rest, no markup." },
  { icon: "globe" as const, title: "Open source", body: "MIT licensed." },
];

export const FAQ = [
  {
    q: "Is it free?",
    a: "Yes. Beamling is free, and OpenRouter and Brave both have free plans.",
  },
  {
    q: "Why my own keys?",
    a: "No middleman and no markup. You pick the models and set the limits.",
  },
  {
    q: "What if I hit a free limit?",
    a: "Free limits reset on their own. You can switch to a paid model in Settings.",
  },
  {
    q: "Can I use Claude, GPT or Gemini?",
    a: `Yes, through OpenRouter. Search runs on ${orList(SEARCH_NAMES)}.`,
  },
  {
    q: "Where is my data?",
    a: "In the EU, encrypted. Export or delete it any time.",
  },
  {
    q: "Are free models private?",
    a: "Not always: free hosts may train on prompts. Use a paid model for private questions.",
  },
];

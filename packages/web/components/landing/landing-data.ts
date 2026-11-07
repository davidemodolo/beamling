import { MODE_HINTS, MODE_ICONS, MODE_LABELS, MODES } from "@/lib/modes";
import { MODEL_GROUPS, PROVIDERS, SEARCH_PROVIDERS } from "@/lib/provider-catalog";
import { orList } from "@/lib/utils";

export const LLM_NAMES = MODEL_GROUPS.map((group) => group.provider.shortName);
export const SEARCH_NAMES = SEARCH_PROVIDERS.map((provider) => provider.shortName);

/** The free setup path, step by step. */
export const FREE_STEPS = [
  {
    title: "Sign in with Google",
    body: "No password and no newsletter. Accept the terms and you are in.",
    cost: "Free",
  },
  {
    title: "Get a free OpenRouter key",
    body: "Create an account and a key. No card needed. Free models allow about 50 requests a day.",
    cost: "$0 · no card",
    href: PROVIDERS.openrouter.keyUrl,
  },
  {
    title: "Get a Brave Search key",
    body: "Brave gives $5 of search credit every month, about 1,000 searches. No card needed.",
    cost: "$5 credit / month",
    href: PROVIDERS.brave.keyUrl,
  },
];

const MODE_DETAILS = {
  quick: "For facts, dates and quick checks. One search, eight sources, an answer in seconds.",
  deep: "For questions with several parts. The model plans sub-queries, searches them together and fills the gaps.",
  deeper: "For real research. The model keeps searching until the evidence is enough, then writes a report.",
};

export const MODE_CARDS = MODES.map((mode) => ({
  mode,
  label: MODE_LABELS[mode],
  icon: MODE_ICONS[mode],
  hint: MODE_HINTS[mode],
  body: MODE_DETAILS[mode],
}));

export const PRINCIPLES = [
  {
    icon: "book" as const,
    title: "Sources first",
    body: "Every claim carries a number. Click it to see the page and the passage it came from.",
  },
  {
    icon: "chart" as const,
    title: "Nothing hidden",
    body: "Each answer shows its model, search provider, cost and time. If a provider fails, Beamling tells you and does not quietly switch to another.",
  },
  {
    icon: "lock" as const,
    title: "Your keys stay yours",
    body: "Keys and conversations are encrypted at rest, keys are never shown again, and there is no markup on what providers charge.",
  },
  {
    icon: "globe" as const,
    title: "Open source",
    body: "The whole app is MIT-licensed and public. You can read the code that handles your keys.",
  },
];

export const FAQ = [
  {
    q: "Is Beamling really free?",
    a: "Beamling itself costs nothing. Models and search run on your own provider accounts, and with a free OpenRouter model and Brave's monthly credit those cost nothing either.",
  },
  {
    q: "Why do I need my own keys?",
    a: "So no one sits between you and the providers. There is no shared account and no markup: you choose the models, see the cost of each answer and set your own limits.",
  },
  {
    q: "What happens when I reach a free limit?",
    a: "OpenRouter's free requests reset every day at midnight UTC, and Brave's credit renews every month. Beamling says which limit you hit, and you can switch to a paid model in Settings at any time.",
  },
  {
    q: "Can I use Claude, GPT or Gemini?",
    a: `Yes. Add credit to your OpenRouter account and pick the model in Settings. Search can run on ${orList(SEARCH_NAMES)}.`,
  },
  {
    q: "Where are my keys and conversations stored?",
    a: "In Beamling's database in the EU, encrypted with keys held in Google Cloud KMS. Keys are never sent back to your browser. You can export or delete everything at any time.",
  },
  {
    q: "Are free models private?",
    a: "Free models are run by hosts that may keep prompts and use them for training. Avoid private questions with a free model, or use a paid one.",
  },
];

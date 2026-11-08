/**
 * What the browser and the server know about each provider: names, key format, capabilities and
 * models. Server-side behavior (HTTP calls, model factories) lives in `server/providers/`.
 */
import {
  CREDENTIAL_PROVIDER_IDS,
  LLM_PROVIDER_IDS,
  SEARCH_PROVIDER_IDS,
  isSearchProvider,
  type CredentialProvider,
  type LlmProvider,
  type SearchProvider,
} from "./contracts";

export interface ProviderInfo {
  id: CredentialProvider;
  name: string;
  shortName: string;
  placeholder: string;
  /** Where the user creates a key. */
  keyUrl: string;
  /** The key can be checked without a billable request; otherwise the form offers to save it unchecked. */
  freeValidation: boolean;
  /** The key has a plan, expiry and warning budget (Brave). */
  keyLimits?: boolean;
  /** List price per search request, used for the visible cost estimate. */
  searchCostUsd?: number;
  /** The provider reports what each generation cost; otherwise Beamling estimates it from token prices. */
  reportsCost?: boolean;
  /** Shown next to the key form and wherever the provider is picked. */
  notice?: string;
}

export const PROVIDERS: { readonly [P in CredentialProvider]: ProviderInfo & { id: P } } = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    shortName: "OpenRouter",
    placeholder: "sk-or-v1-...",
    keyUrl: "https://openrouter.ai/settings/keys",
    freeValidation: true,
    reportsCost: true,
    notice:
      "Some OpenRouter hosts are in China; you can exclude them in OpenRouter's settings. Beamling does not control these hosts or how they handle your data.",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    shortName: "DeepSeek",
    placeholder: "sk-...",
    keyUrl: "https://platform.deepseek.com/api_keys",
    freeValidation: true,
    searchCostUsd: 0.00075,
    notice:
      "DeepSeek is based in China and may process your questions there. Beamling does not control DeepSeek or how it handles your data.",
  },
  brave: {
    id: "brave",
    name: "Brave Search",
    shortName: "Brave",
    placeholder: "BSA...",
    keyUrl: "https://api-dashboard.search.brave.com/app/keys",
    freeValidation: false,
    keyLimits: true,
    searchCostUsd: 0.005,
  },
  tavily: {
    id: "tavily",
    name: "Tavily",
    shortName: "Tavily",
    placeholder: "tvly-...",
    keyUrl: "https://app.tavily.com/home",
    freeValidation: true,
    searchCostUsd: 0.008,
  },
  exa: {
    id: "exa",
    name: "Exa",
    shortName: "Exa",
    placeholder: "exa-...",
    keyUrl: "https://dashboard.exa.ai/api-keys",
    freeValidation: false,
    searchCostUsd: 0.005,
  },
};

export interface ModelInfo {
  /** Stored in settings and on each answer; unique across providers. */
  id: string;
  name: string;
  provider: LlmProvider;
  /** The model name sent to the provider's API. */
  apiModel: string;
  /** Costs nothing on the provider's free tier, within its daily request limit. */
  free?: true;
}

// The first model is the default, and the first free one is the free setup model.
export const MODELS: readonly ModelInfo[] = [
  {
    id: "nvidia/nemotron-3.5-super-vl:free",
    name: "Nemotron 3.5 Super · free",
    provider: "openrouter",
    apiModel: "nvidia/nemotron-3.5-super-vl:free",
    free: true,
  },
  { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B · free", provider: "openrouter", apiModel: "google/gemma-4-31b-it:free", free: true },
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", provider: "openrouter", apiModel: "deepseek/deepseek-v4.1-flash" },
  { id: "google/gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", provider: "openrouter", apiModel: "google/gemini-3.5-flash-lite" },
  { id: "openai/gpt-6-luna", name: "GPT-6 Luna", provider: "openrouter", apiModel: "openai/gpt-6-luna" },
  { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", provider: "openrouter", apiModel: "anthropic/claude-haiku-5.5" },
  { id: "deepseek:deepseek-flash", name: "DeepSeek V4.1 Flash · direct", provider: "deepseek", apiModel: "deepseek-flash" },
];

export const DEFAULT_LLM_MODEL = MODELS[0].id;
/** The model of the free setup path: an OpenRouter account and key cost nothing. */
export const FREE_LLM_MODEL = MODELS.find((model) => model.free)!.id;
export const DEFAULT_SEARCH_PROVIDER: SearchProvider = "brave";

export const providerInfo = <P extends CredentialProvider>(id: P): (typeof PROVIDERS)[P] => PROVIDERS[id];
export const providerName = (id: CredentialProvider): string => PROVIDERS[id].name;

/** Every provider in display order: model providers first, then search-only providers. */
export const ALL_PROVIDERS: readonly ProviderInfo[] = CREDENTIAL_PROVIDER_IDS.map((id) => PROVIDERS[id]);
export const SEARCH_PROVIDERS = SEARCH_PROVIDER_IDS.map((id) => PROVIDERS[id]);

export const modelInfo = (id: string): ModelInfo | undefined => MODELS.find((model) => model.id === id);
export const isAllowedModel = (id: string): boolean => Boolean(modelInfo(id));
/** Names of models removed from the catalog, so older answers keep a readable label. */
const RETIRED_MODEL_NAMES: Readonly<Record<string, string>> = {
  "anthropic/claude-sonnet-4.5": "Claude Sonnet 4.5",
  "anthropic/claude-haiku-4.5": "Claude Haiku 4.5",
  "openai/gpt-5.2": "GPT-5.2",
  "google/gemini-3.8-flash": "Gemini 3.8 Flash",
};
export const llmModelName = (id: string): string => modelInfo(id)?.name ?? RETIRED_MODEL_NAMES[id] ?? id;
/** The provider whose key runs this model; unknown ids fall back to the default model's provider. */
export const modelProvider = (id: string): LlmProvider => (modelInfo(id) ?? MODELS[0]).provider;

export const searchProviderInfo = (id: string): ProviderInfo =>
  isSearchProvider(id) ? PROVIDERS[id] : PROVIDERS[DEFAULT_SEARCH_PROVIDER];
export const searchProviderName = (id: string): string => searchProviderInfo(id).name;

/** What a provider's key is used for, for the key list. */
export function providerUses(id: CredentialProvider): string {
  const models = MODELS.filter((model) => model.provider === id).length;
  const search = isSearchProvider(id);
  if (models && search) return "Language models and web search";
  if (models) return "Language models";
  return "Web search";
}

/** Providers whose saved key can be used; a key the provider rejected does not count. */
export const usableProviders = (credentials: readonly { provider: string; status: string }[]): Set<string> =>
  new Set(credentials.filter((credential) => credential.status !== "invalid").map((credential) => credential.provider));

/** Whether the account has a key for a model and one for search; a DeepSeek key counts for both. */
export function setupState(keyed: ReadonlySet<string>) {
  const hasModelKey = LLM_PROVIDER_IDS.some((id) => keyed.has(id));
  const hasSearchKey = SEARCH_PROVIDER_IDS.some((id) => keyed.has(id));
  return { hasModelKey, hasSearchKey, complete: hasModelKey && hasSearchKey };
}

/**
 * The answer defaults moved onto providers that have a key: a default without a key is replaced by
 * the first keyed option, so a key saved for another provider is used instead of a "Key needed" error.
 */
export function usableDefaults(
  defaults: { llmModel: string; defaultSearchProvider: SearchProvider },
  keyed: ReadonlySet<string>,
): { llmModel: string; defaultSearchProvider: SearchProvider } {
  // A model removed from the catalog counts as unusable, so it is replaced like a model without a key.
  const llmModel = isAllowedModel(defaults.llmModel) && keyed.has(modelProvider(defaults.llmModel))
    ? defaults.llmModel
    : (MODELS.find((model) => keyed.has(model.provider))?.id ??
      (isAllowedModel(defaults.llmModel) ? defaults.llmModel : DEFAULT_LLM_MODEL));
  const defaultSearchProvider = keyed.has(defaults.defaultSearchProvider)
    ? defaults.defaultSearchProvider
    : (SEARCH_PROVIDER_IDS.find((id) => keyed.has(id)) ?? defaults.defaultSearchProvider);
  return { llmModel, defaultSearchProvider };
}

/** Models grouped under their provider, in display order, for model pickers. */
export const MODEL_GROUPS: readonly { provider: ProviderInfo; models: readonly ModelInfo[] }[] = LLM_PROVIDER_IDS.map((id) => ({
  provider: PROVIDERS[id],
  models: MODELS.filter((model) => model.provider === id),
})).filter((group) => group.models.length > 0);

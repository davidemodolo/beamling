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

export { isSearchProvider };

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
    notice:
      "OpenRouter sends each request to one of several hosts, and some of them, such as DeepSeek's own, are in China. You can exclude hosts in your OpenRouter settings. Beamling does not control these hosts and takes no responsibility for how they handle your data.",
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
      "DeepSeek is based in China, and its models and search may process your questions there. Check DeepSeek's terms and privacy policy before you use it. Beamling does not control DeepSeek and takes no responsibility for how it handles your data.",
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
}

export const MODELS: readonly ModelInfo[] = [
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", provider: "openrouter", apiModel: "deepseek/deepseek-v4.1-flash" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "openrouter", apiModel: "anthropic/claude-sonnet-4.5" },
  { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "openrouter", apiModel: "anthropic/claude-haiku-4.5" },
  { id: "openai/gpt-5.2", name: "GPT-5.2", provider: "openrouter", apiModel: "openai/gpt-5.2" },
  { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash", provider: "openrouter", apiModel: "google/gemini-3.8-flash" },
  { id: "deepseek:deepseek-flash", name: "DeepSeek V4.1 Flash · direct", provider: "deepseek", apiModel: "deepseek-flash" },
];

export const DEFAULT_LLM_MODEL = MODELS[0].id;
export const DEFAULT_SEARCH_PROVIDER: SearchProvider = "brave";

export const providerInfo = <P extends CredentialProvider>(id: P): (typeof PROVIDERS)[P] => PROVIDERS[id];
export const providerName = (id: CredentialProvider): string => PROVIDERS[id].name;

/** Every provider in display order: model providers first, then search-only providers. */
export const ALL_PROVIDERS: readonly ProviderInfo[] = CREDENTIAL_PROVIDER_IDS.map((id) => PROVIDERS[id]);
export const SEARCH_PROVIDERS = SEARCH_PROVIDER_IDS.map((id) => PROVIDERS[id]);

export const modelInfo = (id: string): ModelInfo | undefined => MODELS.find((model) => model.id === id);
export const isAllowedModel = (id: string): boolean => Boolean(modelInfo(id));
export const llmModelName = (id: string): string => modelInfo(id)?.name ?? id;
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

/** Models grouped under their provider, in display order, for model pickers. */
export const MODEL_GROUPS: readonly { provider: ProviderInfo; models: readonly ModelInfo[] }[] = LLM_PROVIDER_IDS.map((id) => ({
  provider: PROVIDERS[id],
  models: MODELS.filter((model) => model.provider === id),
})).filter((group) => group.models.length > 0);

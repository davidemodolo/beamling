export const DEFAULT_LLM_MODEL = "deepseek/deepseek-v4.1-flash";

export const OPENROUTER_MODELS = [
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5" },
  { id: "openai/gpt-5.2", name: "GPT-5.2" },
  { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
] as const;

export const OPENROUTER_MODEL_IDS = OPENROUTER_MODELS.map((model) => model.id);

export const llmModelName = (modelId: string) =>
  OPENROUTER_MODELS.find((model) => model.id === modelId)?.name ?? modelId;

export const SEARCH_PROVIDERS = [
  { id: "brave", name: "Brave Search", shortName: "Brave", placeholder: "BSA...", keyUrl: "https://api-dashboard.search.brave.com/app/keys" },
  { id: "tavily", name: "Tavily", shortName: "Tavily", placeholder: "tvly-...", keyUrl: "https://app.tavily.com/home" },
  { id: "exa", name: "Exa", shortName: "Exa", placeholder: "exa-...", keyUrl: "https://dashboard.exa.ai/api-keys" },
] as const;

export type SearchProviderInfo = (typeof SEARCH_PROVIDERS)[number];
export type SearchProviderId = SearchProviderInfo["id"];

export const SEARCH_PROVIDER_IDS = SEARCH_PROVIDERS.map((provider) => provider.id) as SearchProviderId[];
export const DEFAULT_SEARCH_PROVIDER: SearchProviderId = "brave";

export const isSearchProvider = (value: string): value is SearchProviderId =>
  (SEARCH_PROVIDER_IDS as readonly string[]).includes(value);

export const searchProviderInfo = (id: string): SearchProviderInfo =>
  SEARCH_PROVIDERS.find((provider) => provider.id === id) ?? SEARCH_PROVIDERS[0];

export const searchProviderName = (id: string): string => searchProviderInfo(id).name;

export const isAllowedModel = (id: string): boolean =>
  (OPENROUTER_MODEL_IDS as readonly string[]).includes(id);

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

export const SEARCH_PROVIDER_LABEL = "Brave Search";

export const isAllowedModel = (id: string): boolean =>
  (OPENROUTER_MODEL_IDS as readonly string[]).includes(id);

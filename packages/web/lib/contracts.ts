/** Stable domain vocabularies shared by route schemas, types and database mappings. */
export const MODES = ["quick", "deep", "deeper"] as const;
export type Mode = (typeof MODES)[number];

/**
 * Providers, by capability. A provider can offer models, web search or both; it has one key either
 * way. Adding a provider: list it here, describe it in `provider-catalog.ts` and register its
 * adapter in `server/providers/index.ts` (the compiler points at each place).
 */
export const LLM_PROVIDER_IDS = ["openrouter", "deepseek"] as const;
export type LlmProvider = (typeof LLM_PROVIDER_IDS)[number];

export const SEARCH_PROVIDER_IDS = ["brave", "tavily", "exa", "deepseek"] as const;
export type SearchProvider = (typeof SEARCH_PROVIDER_IDS)[number];

export type CredentialProvider = LlmProvider | SearchProvider;
export const CREDENTIAL_PROVIDER_IDS = [...new Set<CredentialProvider>([...LLM_PROVIDER_IDS, ...SEARCH_PROVIDER_IDS])] as [
  CredentialProvider,
  ...CredentialProvider[],
];

/** Stored with each key (and bound into its encryption context); derived from the provider. */
export const CREDENTIAL_KINDS = ["llm", "search"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const isLlmProvider = (value: string): value is LlmProvider => (LLM_PROVIDER_IDS as readonly string[]).includes(value);
export const isSearchProvider = (value: string): value is SearchProvider =>
  (SEARCH_PROVIDER_IDS as readonly string[]).includes(value);
export const isCredentialProvider = (value: string): value is CredentialProvider =>
  (CREDENTIAL_PROVIDER_IDS as readonly string[]).includes(value);

/** A provider with models stores its key as `llm`, even when the same key also serves search. */
export const credentialKind = (provider: CredentialProvider): CredentialKind => (isLlmProvider(provider) ? "llm" : "search");

export const CREDENTIAL_STATUSES = ["active", "invalid", "rate_limited", "unverified"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export const BRAVE_PLANS = ["free", "paid"] as const;
export type BravePlan = (typeof BRAVE_PLANS)[number];

export const BUDGET_PERIODS = ["month", "total"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const MESSAGE_STATUSES = ["pending", "streaming", "complete", "stopped", "error"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

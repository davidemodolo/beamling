/** Stable domain vocabularies shared by route schemas, types and database mappings. */
export const MODES = ["quick", "deep", "deeper"] as const;
export type Mode = (typeof MODES)[number];

export const SEARCH_PROVIDER_IDS = ["brave", "tavily", "exa"] as const;
export type SearchProvider = (typeof SEARCH_PROVIDER_IDS)[number];

export const CREDENTIAL_KINDS = ["llm", "search"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const CREDENTIAL_PROVIDER_IDS = ["openrouter", "brave", "tavily", "exa"] as const;
export type CredentialProvider = (typeof CREDENTIAL_PROVIDER_IDS)[number];

export const CREDENTIAL_STATUSES = ["active", "invalid", "rate_limited", "unverified"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export const BRAVE_PLANS = ["free", "paid"] as const;
export type BravePlan = (typeof BRAVE_PLANS)[number];

export const BUDGET_PERIODS = ["month", "total"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const MESSAGE_STATUSES = ["pending", "streaming", "complete", "stopped", "error"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

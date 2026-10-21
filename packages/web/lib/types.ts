export type Mode = "quick" | "deep" | "deeper";
export type SearchProvider = "brave" | "tavily" | "exa";
type Role = "user" | "assistant";
type MessageStatus = "pending" | "streaming" | "complete" | "stopped" | "error";
export type ChatStage =
  | "empty"
  | "queued"
  | "searching"
  | "reading"
  | "writing"
  | "done"
  | "stopped"
  | "no-sources"
  | "error";
export type SearchStatus = "searching" | "done" | "failed";

export interface SearchTrace {
  query: string;
  status: SearchStatus;
  results?: number;
}

export type CredentialKind = "llm" | "search";
export type CredentialStatus = "active" | "invalid" | "rate_limited" | "unverified";

export interface Source {
  id: string;
  position: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt?: string;
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  /** Generation cost reported by OpenRouter. */
  costUsd: number;
  /** Search cost estimated from Brave's list price. */
  searchCostUsd?: number;
  latencyMs?: number;
  searchRequests?: number;
  /** The search provider selected for this answer. */
  searchProvider?: SearchProvider;
  /** The model and upstream provider OpenRouter actually used, when it reports them. */
  resolvedModel?: string;
  upstreamProvider?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  status: MessageStatus;
  createdAt: string;
  mode?: Mode;
  searchProvider?: SearchProvider;
  sources?: Source[];
  llmModel?: string;
  usage?: Usage;
  errorCode?: string;
  errorMessage?: string;
  noSources?: boolean;
  uncited?: boolean;
  truncated?: boolean;
  degraded?: boolean;
  searchFailures?: number;
  searches?: SearchTrace[];
  reasoning?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  mode: Mode;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A conversation with its newest page of messages, oldest first. */
export interface Conversation extends ConversationSummary {
  messages: Message[];
  hasMoreMessages: boolean;
}

export interface ConversationPage {
  conversations: ConversationSummary[];
  nextCursor: string | null;
}

export type BravePlan = "free" | "paid";
export type BudgetPeriod = "month" | "total";

export interface Credential {
  id: string;
  kind: CredentialKind;
  provider: string;
  last4: string;
  status: CredentialStatus;
  plan?: BravePlan;
  expiresOn?: string;
  budgetUsd?: number;
  budgetPeriod?: BudgetPeriod;
  budgetStartedAt?: string;
  spentUsd?: number;
  requests?: number;
  warning?: "budget_80" | "budget_100" | "expiry_14" | "expiry_7" | "expiry_1";
  lastValidatedAt: string;
}

export interface Settings {
  llmModel: string;
  defaultSearchProvider: SearchProvider;
  defaultMode: Mode;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AppState extends ConversationPage {
  user: User;
  conversationCount: number;
  credentials: Credential[];
  settings: Settings;
}

/** Final event of an answer stream. */
export interface DoneEvent {
  noSources: boolean;
  truncated?: boolean;
  degraded?: boolean;
  searchFailures?: number;
}

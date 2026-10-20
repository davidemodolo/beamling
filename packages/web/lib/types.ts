export type Mode = "quick" | "deep";
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
}

export interface ConversationSummary {
  id: string;
  title: string;
  mode: Mode;
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

export interface Credential {
  id: string;
  kind: CredentialKind;
  provider: string;
  last4: string;
  status: CredentialStatus;
  lastValidatedAt: string;
}

export interface Settings {
  llmModel: string;
  defaultMode: Mode;
}

export interface GuestUser {
  id: string;
  isGuest: boolean;
  createdAt: string;
}

export interface AppState extends ConversationPage {
  user: GuestUser;
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

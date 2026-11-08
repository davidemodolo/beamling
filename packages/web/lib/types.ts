export type { BravePlan, CredentialKind, CredentialProvider, CredentialStatus, Mode, SearchProvider } from "./contracts";
import type { Attachment } from "./attachments";
import type { BravePlan, CredentialKind, CredentialStatus, MessageStatus, Mode, SearchProvider } from "./contracts";

type Role = "user" | "assistant";

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
  /** Generation cost: reported by the provider when it can, otherwise estimated from token prices. */
  costUsd: number;
  /** Search cost estimated from the selected provider's list price. */
  searchCostUsd?: number;
  latencyMs?: number;
  searchRequests?: number;
  /** The search provider selected for this answer. */
  searchProvider?: SearchProvider;
  /** The model and upstream host the provider actually used, when it reports them. */
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
  /** Images on a question: id and type only, never the bytes. */
  attachments?: Attachment[];
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

export interface Credential {
  id: string;
  kind: CredentialKind;
  provider: string;
  last4: string;
  status: CredentialStatus;
  plan?: BravePlan;
  expiresOn?: string;
  /** Monthly budget, counted from the start of the month or from when it was set. */
  budgetUsd?: number;
  budgetStartedAt?: string;
  spentUsd?: number;
  requests?: number;
  warning?: "budget_80" | "budget_100" | "expiry_14" | "expiry_7" | "expiry_1";
  /** Absent for a key saved without validation. */
  lastValidatedAt?: string;
}

export interface Settings {
  llmModel: string;
  defaultSearchProvider: SearchProvider;
  defaultMode: Mode;
  /** The account objected to product analytics; no events are sent for it. */
  analyticsOptOut: boolean;
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

/** An account's own usage, shown on the limits page. */
export interface UsageReport {
  storageBytes: number;
  conversations: number;
  questionsThisHour: number;
  questionsToday: number;
  /** The chats taking the most space, largest first, with decrypted titles for the owner only. */
  largest: { id: string; title: string; bytes: number; questions: number }[];
}

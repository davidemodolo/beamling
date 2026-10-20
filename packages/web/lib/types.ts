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
  costUsd: number;
  latencyMs?: number;
  searchRequests?: number;
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
}

export interface Conversation {
  id: string;
  title: string;
  mode: Mode;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
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

export interface AppState {
  user: GuestUser;
  conversations: Conversation[];
  credentials: Credential[];
  settings: Settings;
}

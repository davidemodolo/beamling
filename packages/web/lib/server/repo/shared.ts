import { DEFAULT_SETTINGS } from "../../data";
import type {
  ConversationSummary,
  Credential,
  CredentialStatus,
  Message,
  Settings,
  Source,
  Usage,
} from "../../types";
import type { conversations, credentials, messages, settings, sources } from "../schema";

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type SourceRow = typeof sources.$inferSelect;
export type CredentialRow = typeof credentials.$inferSelect;
type SettingsRow = typeof settings.$inferSelect;

/** A streaming answer older than this outlived the route's maxDuration and was interrupted. */
const STALE_STREAMING_MS = 3 * 60_000;
const CREDENTIAL_STATUSES: CredentialStatus[] = ["active", "invalid", "rate_limited", "unverified"];

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function staleBefore(): Date {
  return new Date(Date.now() - STALE_STREAMING_MS);
}

export function interruptedFields() {
  return {
    status: "error",
    errorCode: "INTERRUPTED",
    errorMessage: "The answer was interrupted.",
  } as const;
}

export function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const list = groups.get(key(row));
    if (list) list.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

export function mapSettings(row: SettingsRow | undefined): Settings {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    llmModel: row.llmModel,
    defaultMode: row.defaultMode === "deep" ? "deep" : "quick",
  };
}

function mapSource(row: SourceRow): Source {
  return {
    id: row.id,
    position: row.position,
    title: row.title ?? row.domain ?? "Untitled source",
    url: row.url,
    domain: row.domain ?? "",
    snippet: row.snippet ?? "",
    publishedAt: row.publishedAt ? iso(row.publishedAt) : undefined,
  };
}

function money(value: string | null): number | undefined {
  return value == null ? undefined : Number(value);
}

export function mapMessage(row: MessageRow, sourceRows: SourceRow[]): Message {
  const hasUsage = row.tokensIn != null || row.tokensOut != null || row.costUsd != null || row.searchCostUsd != null;
  const usage: Usage | undefined = hasUsage
    ? {
        tokensIn: row.tokensIn ?? 0,
        tokensOut: row.tokensOut ?? 0,
        costUsd: money(row.costUsd) ?? 0,
        searchCostUsd: money(row.searchCostUsd),
        latencyMs: row.latencyMs ?? undefined,
        searchRequests: row.searchRequests,
        resolvedModel: row.resolvedModel ?? undefined,
        upstreamProvider: row.upstreamProvider ?? undefined,
      }
    : undefined;

  // A row still streaming after the route's hard limit belongs to a crashed or restarted instance.
  // Report it as interrupted right away instead of waiting for the reaper.
  const stale = row.status === "streaming" && row.createdAt.getTime() <= staleBefore().getTime();
  const interrupted = stale ? interruptedFields() : null;
  const status = interrupted?.status ?? row.status;

  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    status:
      status === "pending" || status === "streaming" || status === "stopped" || status === "error"
        ? status
        : "complete",
    createdAt: iso(row.createdAt),
    mode: row.mode === "deep" ? "deep" : row.mode === "quick" ? "quick" : undefined,
    sources: sourceRows.map(mapSource),
    llmModel: row.llmModel ?? undefined,
    usage,
    errorCode: interrupted?.errorCode ?? row.errorCode ?? undefined,
    errorMessage: interrupted?.errorMessage ?? row.errorMessage ?? undefined,
    noSources: row.noSources,
    uncited: row.uncited,
    truncated: row.truncated,
    degraded: row.degraded,
    searchFailures: row.searchFailures,
  };
}

export function mapSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode === "deep" ? "deep" : "quick",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function mapCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    kind: row.kind === "search" ? "search" : "llm",
    provider: row.provider,
    last4: row.last4 ?? "0000",
    status: CREDENTIAL_STATUSES.includes(row.status as CredentialStatus)
      ? (row.status as CredentialStatus)
      : "unverified",
    lastValidatedAt: row.lastValidatedAt ? iso(row.lastValidatedAt) : iso(row.createdAt),
  };
}

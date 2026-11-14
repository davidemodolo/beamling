import { sql } from "drizzle-orm";
import { isImageMediaType, isTextFileName, MAX_FILE_NAME_CHARS, type Attachment } from "../../attachments";
import { DEFAULT_SETTINGS } from "../../data";
import { isSearchProvider } from "../../contracts";
import { DEFAULT_SEARCH_PROVIDER } from "../../provider-catalog";
import { decryptText } from "../workspace-key";
import type {
  ConversationSummary,
  Credential,
  Message,
  SearchTrace,
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

/**
 * A streaming answer older than this outlived the longest route (Deeper, 6 minutes) plus a grace
 * period, so it belongs to a crashed or restarted instance.
 */
export const STALE_STREAMING_SECONDS = 8 * 60;

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function staleBefore(): Date {
  return new Date(Date.now() - STALE_STREAMING_SECONDS * 1000);
}

/** The same cutoff evaluated by PostgreSQL, for decisions shared across instances. */
export function staleBeforeSql() {
  return sql`clock_timestamp() - make_interval(secs => ${STALE_STREAMING_SECONDS})`;
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
    defaultSearchProvider: isSearchProvider(row.defaultSearchProvider) ? row.defaultSearchProvider : DEFAULT_SEARCH_PROVIDER,
    defaultMode: row.defaultMode === "deeper" ? "deeper" : row.defaultMode === "deep" ? "deep" : "quick",
    analyticsOptOut: row.analyticsOptOut,
  };
}

async function mapSource(userId: string, row: SourceRow): Promise<Source> {
  const url = await decryptText(userId, "sources", row.id, "url", row.url);
  const title = row.title ? await decryptText(userId, "sources", row.id, "title", row.title) : null;
  const domain = row.domain ? await decryptText(userId, "sources", row.id, "domain", row.domain) : null;
  const snippet = row.snippet ? await decryptText(userId, "sources", row.id, "snippet", row.snippet) : null;
  return {
    id: row.id,
    position: row.position,
    title: title ?? domain ?? "Untitled source",
    url,
    domain: domain ?? "",
    snippet: snippet ?? "",
    publishedAt: row.publishedAt ? iso(row.publishedAt) : undefined,
  };
}

function money(value: string | null): number | undefined {
  return value == null ? undefined : Number(value);
}

export async function mapMessage(userId: string, row: MessageRow, sourceRows: SourceRow[]): Promise<Message> {
  const hasUsage = row.tokensIn != null || row.tokensOut != null || row.costUsd != null || row.searchCostUsd != null;
  const usage: Usage | undefined = hasUsage
    ? {
        tokensIn: row.tokensIn ?? 0,
        tokensOut: row.tokensOut ?? 0,
        costUsd: money(row.costUsd) ?? 0,
        searchCostUsd: money(row.searchCostUsd),
        latencyMs: row.latencyMs ?? undefined,
        searchRequests: row.searchRequests,
        searchProvider: isSearchProvider(row.searchProvider) ? row.searchProvider : DEFAULT_SEARCH_PROVIDER,
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
    content: await decryptText(userId, "messages", row.id, "content", row.content),
    status:
      status === "pending" || status === "streaming" || status === "stopped" || status === "error"
        ? status
        : "complete",
    createdAt: iso(row.createdAt),
    mode: row.mode === "deeper" ? "deeper" : row.mode === "deep" ? "deep" : row.mode === "quick" ? "quick" : undefined,
    searchProvider: isSearchProvider(row.searchProvider) ? row.searchProvider : DEFAULT_SEARCH_PROVIDER,
    sources: await Promise.all(sourceRows.map((source) => mapSource(userId, source))),
    llmModel: row.llmModel ?? undefined,
    usage,
    errorCode: interrupted?.errorCode ?? row.errorCode ?? undefined,
    errorMessage: interrupted?.errorMessage ?? (row.errorMessage ? await decryptText(userId, "messages", row.id, "error_message", row.errorMessage) : undefined),
    noSources: row.noSources,
    uncited: row.uncited,
    truncated: row.truncated,
    degraded: row.degraded,
    searchFailures: row.searchFailures,
    searches: await readSearches(userId, row),
    reasoning: row.reasoning
      ? await decryptText(userId, "messages", row.id, "reasoning", row.reasoning)
      : undefined,
    attachments: await readAttachments(userId, row),
  };
}

/** A question's attachment metadata; malformed entries are dropped. */
export async function readAttachments(userId: string, row: MessageRow): Promise<Attachment[] | undefined> {
  if (!row.attachments) return undefined;
  try {
    const value = JSON.parse(await decryptText(userId, "messages", row.id, "attachments", row.attachments)) as unknown;
    if (!Array.isArray(value)) return undefined;
    return value.flatMap((item: { id?: unknown; kind?: unknown; mediaType?: unknown; name?: unknown } | null): Attachment[] => {
      if (!item || typeof item.id !== "string") return [];
      if (item.kind === "image" && typeof item.mediaType === "string" && isImageMediaType(item.mediaType)) {
        return [{ id: item.id, kind: "image", mediaType: item.mediaType }];
      }
      if (item.kind === "text" && typeof item.name === "string" && isTextFileName(item.name)) {
        return [{ id: item.id, kind: "text", name: item.name.slice(-MAX_FILE_NAME_CHARS) }];
      }
      return [];
    });
  } catch {
    return undefined;
  }
}

async function readSearches(userId: string, row: MessageRow): Promise<SearchTrace[] | undefined> {
  if (!row.searches) return undefined;
  try {
    const value = JSON.parse(await decryptText(userId, "messages", row.id, "searches", row.searches)) as unknown;
    if (!Array.isArray(value)) return undefined;
    return value.filter(
      (item): item is SearchTrace =>
        !!item &&
        typeof item === "object" &&
        typeof (item as SearchTrace).query === "string" &&
        ["searching", "done", "failed"].includes(String((item as SearchTrace).status)),
    );
  } catch {
    return undefined;
  }
}

export async function mapSummary(userId: string, row: ConversationRow): Promise<ConversationSummary> {
  return {
    id: row.id,
    title: await decryptText(userId, "conversations", row.id, "title", row.title),
    mode: row.mode === "deeper" ? "deeper" : row.mode === "deep" ? "deep" : "quick",
    pinned: row.pinned,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export interface CredentialUsageSummary {
  requests: number;
  spentUsd: number;
}

function warningFor(row: CredentialRow, usage: CredentialUsageSummary | undefined): Credential["warning"] {
  const now = Date.now();
  const expiryDays = row.expiresOn ? Math.ceil((new Date(`${row.expiresOn}T23:59:59Z`).getTime() - now) / 86_400_000) : null;
  const budget = row.budgetUsd == null ? null : Number(row.budgetUsd);
  const spent = usage?.spentUsd ?? 0;
  const ratio = budget && budget > 0 ? spent / budget : null;

  if (ratio != null && ratio >= 1) return "budget_100";
  if (expiryDays != null && expiryDays <= 1) return "expiry_1";
  if (ratio != null && ratio >= 0.8) return "budget_80";
  if (expiryDays != null && expiryDays <= 7) return "expiry_7";
  if (expiryDays != null && expiryDays <= 14) return "expiry_14";
  return undefined;
}

export function mapCredential(row: CredentialRow, usage?: CredentialUsageSummary): Credential {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    last4: row.last4 ?? "0000",
    status: row.status,
    // Only providers with key limits store a plan.
    plan: row.plan ?? undefined,
    expiresOn: row.expiresOn ?? undefined,
    budgetUsd: row.budgetUsd == null ? undefined : Number(row.budgetUsd),
    budgetStartedAt: row.budgetStartedAt ? iso(row.budgetStartedAt) : undefined,
    spentUsd: usage?.spentUsd,
    requests: usage?.requests,
    warning: warningFor(row, usage),
    lastValidatedAt: row.lastValidatedAt ? iso(row.lastValidatedAt) : undefined,
  };
}

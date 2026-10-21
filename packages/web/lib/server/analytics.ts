import { createHmac } from "node:crypto";
import type { CredentialKind, CredentialStatus, Mode, SearchProvider } from "../types";
import { APP_VERSION } from "../version";
import { posthogConfig, posthogDeletionConfig, type PostHogConfig } from "./env";
import { log } from "./log";

export interface AnalyticsEventMap {
  account_created: Record<string, never>;
  question_asked: { mode: Mode; search_provider: SearchProvider; llm_model: string };
  answer_completed: {
    mode: Mode;
    search_provider: SearchProvider;
    llm_model: string;
    resolved_model?: string;
    upstream_provider?: string;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    search_cost_usd?: number;
    search_requests: number;
    search_failures: number;
    latency_ms: number;
    uncited: boolean;
    no_sources: boolean;
    degraded: boolean;
  };
  answer_failed: {
    mode: Mode;
    search_provider: SearchProvider;
    llm_model: string;
    error_code: string;
    latency_ms: number;
    search_failures: number;
  };
  answer_stopped: { mode: Mode; search_provider: SearchProvider; latency_ms: number };
  credential_added: { kind: CredentialKind; provider: string; status: CredentialStatus };
  credential_validation_failed: { kind: CredentialKind; provider: string; error_code: string };
  search_provider_selected: { search_provider: SearchProvider; previous_provider: SearchProvider };
}

export type AnalyticsEvent = keyof AnalyticsEventMap;

/** The allowlist is the contract: unknown keys are dropped before a payload leaves the server. */
export const ANALYTICS_EVENT_PROPERTIES = {
  account_created: [],
  question_asked: ["mode", "search_provider", "llm_model"],
  answer_completed: [
    "mode",
    "search_provider",
    "llm_model",
    "resolved_model",
    "upstream_provider",
    "tokens_in",
    "tokens_out",
    "cost_usd",
    "search_cost_usd",
    "search_requests",
    "search_failures",
    "latency_ms",
    "uncited",
    "no_sources",
    "degraded",
  ],
  answer_failed: ["mode", "search_provider", "llm_model", "error_code", "latency_ms", "search_failures"],
  answer_stopped: ["mode", "search_provider", "latency_ms"],
  credential_added: ["kind", "provider", "status"],
  credential_validation_failed: ["kind", "provider", "error_code"],
  search_provider_selected: ["search_provider", "previous_provider"],
} as const satisfies Record<AnalyticsEvent, readonly string[]>;

const CAPTURE_TIMEOUT_MS = 2_000;
const DELETE_TIMEOUT_MS = 3_000;
const MAX_IN_FLIGHT = 8;

export interface AnalyticsClient {
  capture<E extends AnalyticsEvent>(userId: string, event: E, properties: AnalyticsEventMap[E]): void;
  /** The PostHog identity of an account, or null when person deletion is not configured. */
  distinctIdFor(userId: string): string | null;
  /** Deletes a person and their events; resolves false on any failure so the caller can retry. */
  deletePerson(distinctId: string): Promise<boolean>;
  flush(): Promise<void>;
}

type Fetch = typeof globalThis.fetch;

/** Stable, non-reversible identity for PostHog. It is the only user data in an analytics request. */
export function analyticsDistinctId(userId: string, salt: string): string {
  return createHmac("sha256", salt).update(userId).digest("hex").slice(0, 32);
}

function scalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function buildAnalyticsPayload(
  config: PostHogConfig,
  userId: string,
  event: AnalyticsEvent,
  properties: Record<string, unknown>,
): {
  api_key: string;
  event: AnalyticsEvent;
  distinct_id: string;
  properties: Record<string, string | number | boolean>;
} {
  const allowed = new Set<string>(ANALYTICS_EVENT_PROPERTIES[event]);
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (allowed.has(key) && scalar(value)) clean[key] = value;
  }
  clean.app_version = APP_VERSION;
  // Server-side capture must not turn the hosting IP into a user location.
  clean.$geoip_disable = true;
  clean.$ip = "0.0.0.0";
  return {
    api_key: config.apiKey,
    event,
    distinct_id: analyticsDistinctId(userId, config.salt),
    properties: clean,
  };
}

function failureName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export function createAnalytics(options: {
  config: PostHogConfig | null;
  /** Defaults to `config`; set separately so the kill switch does not stop deletions. */
  deletionConfig?: PostHogConfig | null;
  fetchImpl?: Fetch;
  /** True for an account that objected to analytics; its events are dropped before they are sent. */
  isExcluded?: (userId: string) => Promise<boolean>;
  captureTimeoutMs?: number;
  deleteTimeoutMs?: number;
}): AnalyticsClient {
  const { config } = options;
  const deletionConfig = options.deletionConfig === undefined ? config : options.deletionConfig;
  const fetchImpl = options.fetchImpl ?? fetch;
  const captureTimeoutMs = options.captureTimeoutMs ?? CAPTURE_TIMEOUT_MS;
  const deleteTimeoutMs = options.deleteTimeoutMs ?? DELETE_TIMEOUT_MS;
  const inFlight = new Set<Promise<void>>();

  async function deliver(url: string, init: RequestInit, event: AnalyticsEvent): Promise<void> {
    try {
      const response = await fetchImpl(url, init);
      await response.body?.cancel();
      if (!response.ok) log.warn("PostHog event dropped", { event, status: response.status });
    } catch (error) {
      log.warn("PostHog event dropped", { event, error: failureName(error) });
    }
  }

  function capture<E extends AnalyticsEvent>(userId: string, event: E, properties: AnalyticsEventMap[E]): void {
    if (!config || inFlight.size >= MAX_IN_FLIGHT) return;
    const payload = buildAnalyticsPayload(config, userId, event, properties as Record<string, unknown>);
    const task = (async () => {
      // An objection must be honoured even when the check fails: no answer means no event.
      const excluded = options.isExcluded ? await options.isExcluded(userId).catch(() => true) : false;
      if (excluded) return;
      await deliver(
        `${config.host}/i/v0/e/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(captureTimeoutMs),
        },
        event,
      );
    })();
    inFlight.add(task);
    void task.then(
      () => inFlight.delete(task),
      () => inFlight.delete(task),
    );
  }

  function distinctIdFor(userId: string): string | null {
    return deletionConfig ? analyticsDistinctId(userId, deletionConfig.salt) : null;
  }

  async function deletePerson(distinctId: string): Promise<boolean> {
    if (!deletionConfig) return false;
    const url = `${deletionConfig.appHost}/api/projects/${encodeURIComponent(deletionConfig.projectId)}/persons/bulk_delete/`;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deletionConfig.personalApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          distinct_ids: [distinctId],
          delete_events: true,
          delete_recordings: true,
        }),
        signal: AbortSignal.timeout(deleteTimeoutMs),
      });
      const body = (await response.json().catch(() => null)) as { deletion_errors?: unknown[] } | null;
      if (!response.ok) {
        log.warn("PostHog person deletion failed", { status: response.status });
        return false;
      }
      if (body?.deletion_errors?.length) {
        log.warn("PostHog person deletion incomplete", { failures: body.deletion_errors.length });
        return false;
      }
      return true;
    } catch (error) {
      log.warn("PostHog person deletion failed", { error: failureName(error) });
      return false;
    }
  }

  async function flush(): Promise<void> {
    while (inFlight.size) await Promise.allSettled([...inFlight]);
  }

  return { capture, distinctIdFor, deletePerson, flush };
}

// One client per process: the shutdown hook is bundled separately from the route handlers, and its
// flush must see the events those handlers still have in flight.
const globalForAnalytics = globalThis as unknown as { __beamlingAnalytics?: AnalyticsClient };
export const analytics: AnalyticsClient = (globalForAnalytics.__beamlingAnalytics ??= createAnalytics({
  config: posthogConfig(),
  deletionConfig: posthogDeletionConfig(),
  // Loaded lazily: the analytics module stays importable without a database (unit tests, tooling).
  isExcluded: async (userId): Promise<boolean> =>
    (await import("./repo/settings")).analyticsExcluded(userId, analytics.distinctIdFor(userId)),
}));

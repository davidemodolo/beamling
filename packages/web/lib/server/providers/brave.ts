import { ApiError } from "../http";
import { log } from "../log";
import { providerFetch, unavailable } from "./errors";
import { waitForBraveSlot } from "./limiter";
import {
  clampQuery,
  DEFAULT_RETRY_WAIT_MS,
  requestSignal,
  normalizedSources,
  retryOnceOn429,
  retryWaitMs as baseRetryWaitMs,
  type RetrievedSource,
  type SearchOptions,
} from "./shared";


interface BraveWebResponse {
  web?: {
    results?: {
      title?: string;
      url?: string;
      description?: string;
      age?: string;
    }[];
  };
}

interface BraveErrorDetail {
  code?: unknown;
  detail?: unknown;
  message?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

function errorDetail(value: unknown): BraveErrorDetail {
  return value !== null && typeof value === "object" ? (value as BraveErrorDetail) : {};
}

/** Maps a Brave HTTP status and error body to a stable Beamling error. */
export function braveError(status: number, body: unknown = {}): ApiError {
  const detail = errorDetail(body);
  const message = text(detail.detail) || text(detail.message);
  const code = text(detail.code);
  const error = (errorCode: string, errorMessage: string, httpStatus: number) =>
    new ApiError(errorCode, errorMessage, httpStatus, "brave");
  if (/not included in the plan/i.test(message) || code === "OPTION_NOT_IN_PLAN") {
    return error(
      "BRAVE_PLAN_MISSING_SEARCH",
      "This key is not attached to Brave's Search plan. Create or select a Search-plan key at https://api-dashboard.search.brave.com/app/keys.",
      400,
    );
  }
  if (status === 401 || status === 403 || code === "SUBSCRIPTION_TOKEN_INVALID") {
    return error("CREDENTIAL_INVALID", "Brave Search rejected this key.", 400);
  }
  if (status === 402) return error("INSUFFICIENT_CREDITS", "Brave Search has no remaining quota.", 402);
  if (status === 429) return error("PROVIDER_RATE_LIMITED", "Brave Search is rate-limiting this key.", 429);
  if (status === 408 || status >= 500) return unavailable("brave");
  return error("PROVIDER_ERROR", `Brave Search returned HTTP ${status}.`, 502);
}

async function readError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    const parsed = (await response.json()) as { error?: unknown } | null;
    body = parsed?.error;
  } catch {}
  // Provider text can contain the query or a credential; keep only the stable status in logs.
  log.warn("Brave request failed", { status: response.status });
  return braveError(response.status, body);
}

function freshnessValue(days?: number): string | undefined {
  if (!days || days <= 0 || days > 365) return undefined;
  if (days <= 1) return "pd";
  if (days <= 7) return "pw";
  if (days <= 31) return "pm";
  return "py";
}

/** Milliseconds Brave asks us to wait, from Retry-After or the per-second reset header. */
function retryWaitMs(headers: Headers, now = Date.now()): number {
  const base = baseRetryWaitMs(headers, now);
  if (base !== DEFAULT_RETRY_WAIT_MS) return base;
  // X-RateLimit-Reset lists seconds until each window resets; the first is the per-second window.
  const reset = Number(headers.get("x-ratelimit-reset")?.split(",")[0]?.trim());
  if (Number.isFinite(reset) && reset >= 0) return reset * 1000;
  return base;
}

async function requestWebSearch(
  key: string,
  query: string,
  options: SearchOptions,
): Promise<Response> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", clampQuery(query));
  url.searchParams.set("count", String(Math.min(20, Math.max(1, options.count))));
  const freshness = freshnessValue(options.freshnessDays);
  if (freshness) url.searchParams.set("freshness", freshness);

  const send = async () => {
    await waitForBraveSlot(key, options.plan ?? "free", options.signal);
    return providerFetch(
      "brave",
      url,
      {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
        signal: requestSignal(options.signal),
        cache: "no-store",
      },
      options.signal,
    );
  };

  const response = await send();
  return retryOnceOn429(response, send, options.signal, retryWaitMs(response.headers));
}

export async function validateBraveKey(key: string, plan: "free" | "paid" = "free"): Promise<void> {
  const response = await requestWebSearch(key, "Beamling connectivity test", { count: 1, plan });
  if (!response.ok) throw await readError(response);
  await response.arrayBuffer().catch(() => {});
}

export async function searchBrave(
  key: string,
  query: string,
  options: SearchOptions,
): Promise<RetrievedSource[]> {
  const response = await requestWebSearch(key, query, options);
  if (!response.ok) throw await readError(response);
  let body: BraveWebResponse;
  try {
    const parsed = (await response.json()) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("Brave returned a non-object body.");
    }
    body = parsed as BraveWebResponse;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw unavailable("brave", "Brave Search returned an unreadable response.");
  }
  return normalizedSources(
    (Array.isArray(body.web?.results) ? body.web.results : []).map((item) => ({
      url: item.url,
      title: item.title,
      snippet: item.description,
      publishedAt: item.age,
    })),
  );
}

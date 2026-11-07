import { ApiError } from "../http";
import { log } from "../log";
import { providerFetch, unavailable } from "./errors";
import { clampQuery, normalizedSources, requestSignal, retryOnceOn429, type RetrievedSource, type SearchOptions } from "./shared";

interface TavilyResponse {
  results?: {
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
    score?: number;
  }[];
  usage?: { credits?: number };
}

interface TavilyErrorBody {
  detail?: { error?: unknown } | unknown;
  error?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

function errorBody(value: unknown): TavilyErrorBody {
  return value !== null && typeof value === "object" ? (value as TavilyErrorBody) : {};
}

function detailOf(body: TavilyErrorBody): string {
  if (typeof body.detail === "string") return body.detail.slice(0, 500);
  if (body.detail !== null && typeof body.detail === "object") {
    return text((body.detail as { error?: unknown }).error);
  }
  return text(body.error);
}

export function tavilyError(status: number, value: unknown = {}): ApiError {
  const body = errorBody(value);
  const detail = detailOf(body);
  const error = (code: string, message: string, httpStatus: number) => new ApiError(code, message, httpStatus, "tavily");
  if (status === 401) return error("CREDENTIAL_INVALID", "Tavily rejected this key.", 400);
  if (status === 432) return error("SEARCH_PLAN_MISSING", "This Tavily key does not include Search access.", 400);
  if (status === 433) return error("QUOTA_EXCEEDED", "This Tavily key reached its plan limit.", 402);
  if (status === 402) return error("INSUFFICIENT_CREDITS", "Tavily has no remaining credits for this key.", 402);
  if (status === 403) return error("CREDENTIAL_INVALID", "Tavily cannot use this key for Search.", 400);
  if (status === 429) return error("PROVIDER_RATE_LIMITED", "Tavily is rate-limiting this key.", 429);
  if (status === 408 || status >= 500) return unavailable("tavily");
  return error("PROVIDER_ERROR", detail || `Tavily returned HTTP ${status}.`, 502);
}

async function readError(response: Response): Promise<ApiError> {
  let body: TavilyErrorBody | undefined;
  try {
    body = (await response.json()) as TavilyErrorBody;
  } catch {}
  // Provider text can contain the query or a credential; keep only the stable status in logs.
  log.warn("Tavily request failed", { status: response.status });
  return tavilyError(response.status, body);
}

function timeRange(days?: number): string | undefined {
  if (!days || days <= 0 || days > 365) return undefined;
  if (days <= 1) return "day";
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  return "year";
}

async function requestSearch(key: string, query: string, options: SearchOptions): Promise<Response> {
  const body: Record<string, unknown> = {
    query: clampQuery(query),
    max_results: Math.min(20, Math.max(1, options.count)),
    search_depth: "basic",
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    include_usage: true,
    include_published_date: true,
    safe_search: true,
    topic: options.freshnessDays ? "news" : "general",
  };
  const range = timeRange(options.freshnessDays);
  if (range) body.time_range = range;

  const send = () =>
    providerFetch(
      "tavily",
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: requestSignal(options.signal),
        cache: "no-store",
      },
      options.signal,
    );

  const response = await send();
  return retryOnceOn429(response, send, options.signal);
}

interface TavilyUsageResponse {
  key?: { usage?: number | null; limit?: number | null };
}

/** Checks the key with the usage endpoint, which reports credits without spending one. */
export async function validateTavilyKey(key: string): Promise<void> {
  const response = await providerFetch("tavily", "https://api.tavily.com/usage", {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
    signal: requestSignal(),
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  const body = (await response.json().catch(() => null)) as TavilyUsageResponse | null;
  const usage = body?.key?.usage;
  const limit = body?.key?.limit;
  if (typeof usage === "number" && typeof limit === "number" && usage >= limit) throw tavilyError(433);
}

export async function searchTavily(key: string, query: string, options: SearchOptions): Promise<RetrievedSource[]> {
  const response = await requestSearch(key, query, options);
  if (!response.ok) throw await readError(response);
  let body: TavilyResponse;
  try {
    const parsed = (await response.json()) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("Tavily returned a non-object body.");
    }
    body = parsed as TavilyResponse;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw unavailable("tavily", "Tavily returned an unreadable response.");
  }
  return normalizedSources(
    (Array.isArray(body.results) ? body.results : []).map((item) => ({
      url: item.url,
      title: item.title,
      snippet: item.content,
      publishedAt: item.published_date,
    })),
  );
}

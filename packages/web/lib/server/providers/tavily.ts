import { ApiError } from "../http";
import { providerError, providerFetch, readJsonObject, readProviderError, textField } from "./errors";
import {
  clampQuery,
  freshnessWindow,
  normalizedSources,
  requestSignal,
  retryOnceOn429,
  type RetrievedSource,
  type SearchOptions,
} from "./shared";

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

export function tavilyError(status: number, value: unknown = {}): ApiError {
  const body = (value ?? {}) as TavilyErrorBody;
  const detail =
    body.detail !== null && typeof body.detail === "object"
      ? textField((body.detail as { error?: unknown }).error)
      : textField(body.detail) || textField(body.error);
  if (status === 432) return new ApiError("SEARCH_PLAN_MISSING", "This Tavily key does not include Search access.", 400, "tavily");
  if (status === 433) return new ApiError("QUOTA_EXCEEDED", "This Tavily key reached its plan limit.", 402, "tavily");
  return providerError("tavily", status, detail);
}

const readError = (response: Response) => readProviderError("tavily", response, tavilyError);

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
  const range = freshnessWindow(options.freshnessDays);
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
  const body = await readJsonObject<TavilyResponse>("tavily", response, options.signal);
  return normalizedSources(
    (Array.isArray(body.results) ? body.results : []).map((item) => ({
      url: item.url,
      title: item.title,
      snippet: item.content,
      publishedAt: item.published_date,
    })),
  );
}

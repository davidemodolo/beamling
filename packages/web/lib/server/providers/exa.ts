import { ApiError } from "../http";
import { log } from "../log";
import { providerFetch, unavailable } from "./errors";
import { clampQuery, normalizedSources, requestSignal, retryOnceOn429, type RetrievedSource, type SearchOptions } from "./shared";

interface ExaResponse {
  results?: {
    title?: string;
    url?: string;
    publishedDate?: string;
    highlights?: string[];
  }[];
  costDollars?: number;
}

interface ExaErrorBody {
  error?: unknown;
  tag?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

function errorBody(value: unknown): ExaErrorBody {
  return value !== null && typeof value === "object" ? (value as ExaErrorBody) : {};
}

export function exaError(status: number, value: unknown = {}): ApiError {
  const body = errorBody(value);
  const detail = text(body.error);
  const error = (code: string, message: string, httpStatus: number) => new ApiError(code, message, httpStatus, "exa");
  if (status === 401 || status === 403) return error("CREDENTIAL_INVALID", "Exa rejected this key.", 400);
  if (status === 402) return error("INSUFFICIENT_CREDITS", "Exa has no remaining credits for this key.", 402);
  if (status === 429) return error("PROVIDER_RATE_LIMITED", "Exa is rate-limiting this key.", 429);
  if (status === 408 || status >= 500) return unavailable("exa");
  return error("PROVIDER_ERROR", detail || `Exa returned HTTP ${status}.`, 502);
}

async function readError(response: Response): Promise<ApiError> {
  let body: ExaErrorBody | undefined;
  try {
    body = (await response.json()) as ExaErrorBody;
  } catch {}
  // Provider text can contain the query or a credential; keep only the stable status in logs.
  log.warn("Exa request failed", { status: response.status });
  return exaError(response.status, body);
}

function startDate(days?: number): string | undefined {
  if (!days || days <= 0 || days > 365) return undefined;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function requestSearch(key: string, query: string, options: SearchOptions): Promise<Response> {
  const body: Record<string, unknown> = {
    query: clampQuery(query),
    numResults: Math.min(100, Math.max(1, options.count)),
    type: "auto",
    contents: { highlights: true },
    moderation: true,
  };
  const since = startDate(options.freshnessDays);
  if (since) body.startPublishedDate = since;

  const send = () =>
    providerFetch(
      "exa",
      "https://api.exa.ai/search",
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": key },
        body: JSON.stringify(body),
        signal: requestSignal(options.signal),
        cache: "no-store",
      },
      options.signal,
    );

  const response = await send();
  return retryOnceOn429(response, send, options.signal);
}

export async function validateExaKey(key: string): Promise<void> {
  const response = await requestSearch(key, "Beamling connectivity test", { count: 1 });
  if (!response.ok) throw await readError(response);
  await response.arrayBuffer().catch(() => {});
}

export async function searchExa(key: string, query: string, options: SearchOptions): Promise<RetrievedSource[]> {
  const response = await requestSearch(key, query, options);
  if (!response.ok) throw await readError(response);
  let body: ExaResponse;
  try {
    const parsed = (await response.json()) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("Exa returned a non-object body.");
    }
    body = parsed as ExaResponse;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw unavailable("exa", "Exa returned an unreadable response.");
  }
  return normalizedSources(
    (Array.isArray(body.results) ? body.results : []).map((item) => ({
      url: item.url,
      title: item.title,
      snippet: (item.highlights ?? []).join(" "),
      publishedAt: item.publishedDate,
    })),
  );
}

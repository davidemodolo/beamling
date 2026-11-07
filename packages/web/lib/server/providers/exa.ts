import type { ApiError } from "../http";
import { providerError, providerFetch, readJsonObject, readProviderError, textField } from "./errors";
import {
  clampQuery,
  freshnessStart,
  normalizedSources,
  requestSignal,
  retryOnceOn429,
  type RetrievedSource,
  type SearchOptions,
} from "./shared";

interface ExaResponse {
  results?: {
    title?: string;
    url?: string;
    publishedDate?: string;
    highlights?: string[];
  }[];
  costDollars?: number;
}

export function exaError(status: number, value: unknown = {}): ApiError {
  return providerError("exa", status, textField((value as { error?: unknown } | null)?.error));
}

const readError = (response: Response) => readProviderError("exa", response, exaError);

async function requestSearch(key: string, query: string, options: SearchOptions): Promise<Response> {
  const body: Record<string, unknown> = {
    query: clampQuery(query),
    numResults: Math.min(100, Math.max(1, options.count)),
    type: "auto",
    contents: { highlights: true },
    moderation: true,
  };
  const since = freshnessStart(options.freshnessDays);
  if (since) body.startPublishedDate = since.toISOString();

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
  const body = await readJsonObject<ExaResponse>("exa", response, options.signal);
  return normalizedSources(
    (Array.isArray(body.results) ? body.results : []).map((item) => ({
      url: item.url,
      title: item.title,
      snippet: (item.highlights ?? []).join(" "),
      publishedAt: item.publishedDate,
    })),
  );
}

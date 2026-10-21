import { isSafeHttpUrl } from "../../url";
import { ApiError } from "../http";
import { log } from "../log";
import { providerFetch, unavailable } from "./errors";
import { clampQuery, MAX_RETRY_WAIT_MS, normalizedDate, plainText, requestSignal, retryWaitMs, sleep, type RetrievedSource, type SearchOptions } from "./shared";

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
  error?: string;
  tag?: string;
}

export function exaError(status: number, body: ExaErrorBody = {}): ApiError {
  const detail = (body.error ?? "").slice(0, 500);
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
  if (body?.error) log.warn("Exa request failed", { status: response.status, detail: body.error.slice(0, 300) });
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
  if (response.status !== 429) return response;
  const wait = retryWaitMs(response.headers);
  if (wait > MAX_RETRY_WAIT_MS) return response;
  await response.arrayBuffer().catch(() => {});
  await sleep(wait, options.signal);
  return send();
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
    body = (await response.json()) as ExaResponse;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw unavailable("exa", "Exa returned an unreadable response.");
  }
  const seen = new Set<string>();
  const out: RetrievedSource[] = [];
  for (const item of body.results ?? []) {
    if (!item.url || seen.has(item.url) || !isSafeHttpUrl(item.url) || item.url.length > 2048) continue;
    const snippet = plainText((item.highlights ?? []).join(" ")).slice(0, 1800);
    if (!snippet) continue;
    seen.add(item.url);
    const domain = new URL(item.url).hostname.replace(/^www\./, "").slice(0, 255);
    out.push({
      position: out.length + 1,
      title: (plainText(item.title) || domain).slice(0, 300),
      url: item.url,
      domain,
      snippet,
      publishedAt: normalizedDate(item.publishedDate)?.slice(0, 40),
    });
  }
  return out;
}

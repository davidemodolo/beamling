import { createHash } from "node:crypto";
import { isSafeHttpUrl } from "../../url";
import { ApiError } from "../http";
import { log } from "../log";
import { reserveProviderSlot } from "../repo";
import { providerFetch, unavailable } from "./errors";
import {
  clampQuery,
  DEFAULT_RETRY_WAIT_MS,
  MAX_RETRY_WAIT_MS,
  normalizedDate,
  plainText,
  requestSignal,
  retryWaitMs as baseRetryWaitMs,
  sleep,
  type RetrievedSource,
  type SearchOptions,
} from "./shared";

export type { RetrievedSource } from "./shared";

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

interface BraveErrorBody {
  error?: { code?: string; detail?: string; message?: string };
}

/** Maps a Brave HTTP status and error body to a stable Beamling error. */
export function braveError(status: number, body: BraveErrorBody["error"] = {}): ApiError {
  const detail = (body.detail ?? body.message ?? "").slice(0, 500);
  const error = (code: string, message: string, httpStatus: number) => new ApiError(code, message, httpStatus, "brave");
  if (/not included in the plan/i.test(detail) || body.code === "OPTION_NOT_IN_PLAN") {
    return error(
      "BRAVE_PLAN_MISSING_SEARCH",
      `This key is not attached to Brave's Search plan. Create or select a Search-plan key at https://api-dashboard.search.brave.com/app/keys.${detail ? ` Brave said: ${detail}` : ""}`,
      400,
    );
  }
  if (status === 401 || status === 403 || body.code === "SUBSCRIPTION_TOKEN_INVALID") {
    return error("CREDENTIAL_INVALID", "Brave Search rejected this key.", 400);
  }
  if (status === 402) return error("INSUFFICIENT_CREDITS", "Brave Search has no remaining quota.", 402);
  if (status === 429) return error("PROVIDER_RATE_LIMITED", "Brave Search is rate-limiting this key.", 429);
  if (status === 408 || status >= 500) return unavailable("brave");
  return error("PROVIDER_ERROR", detail || `Brave Search returned HTTP ${status}.`, 502);
}

async function readError(response: Response): Promise<ApiError> {
  let body: BraveErrorBody["error"];
  try {
    body = ((await response.json()) as BraveErrorBody).error;
  } catch {}
  if (body?.detail) log.warn("Brave request failed", { status: response.status, detail: body.detail.slice(0, 300) });
  return braveError(response.status, body);
}

function freshnessValue(days?: number): string | undefined {
  if (!days || days <= 0 || days > 365) return undefined;
  if (days <= 1) return "pd";
  if (days <= 7) return "pw";
  if (days <= 31) return "pm";
  return "py";
}

function minIntervalMs(plan: "free" | "paid"): number {
  if (plan === "paid") {
    const paid = Number(process.env.BRAVE_PAID_MIN_INTERVAL_MS ?? "0");
    return Number.isFinite(paid) && paid >= 0 ? paid : 0;
  }
  const raw = Number(process.env.BRAVE_MIN_INTERVAL_MS ?? "1100");
  return Number.isFinite(raw) && raw >= 0 ? raw : 1100;
}

/**
 * Waits for this key's next request slot. Slots are reserved in the database, so the spacing holds
 * across every instance; the key is stored only as a hash.
 */
async function waitForSlot(apiKey: string, plan: "free" | "paid", signal?: AbortSignal): Promise<void> {
  const interval = minIntervalMs(plan);
  if (interval <= 0) return;
  const key = `brave:${createHash("sha256").update(apiKey).digest("hex").slice(0, 32)}`;
  const wait = await reserveProviderSlot(key, interval);
  if (wait > 0) await sleep(wait, signal);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
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
    await waitForSlot(key, options.plan ?? "free", options.signal);
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
  if (response.status !== 429) return response;
  const wait = retryWaitMs(response.headers);
  if (wait > MAX_RETRY_WAIT_MS) return response;
  await response.arrayBuffer().catch(() => {});
  await sleep(wait, options.signal);
  return send();
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
    body = (await response.json()) as BraveWebResponse;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw unavailable("brave", "Brave Search returned an unreadable response.");
  }
  const results = body.web?.results ?? [];
  const seen = new Set<string>();
  const out: RetrievedSource[] = [];

  for (const item of results) {
    if (!item.url || seen.has(item.url) || !isSafeHttpUrl(item.url)) continue;
    // A source is usable only with a non-empty snippet: it is the only evidence the model sees.
    const snippet = plainText(item.description).slice(0, 1800);
    if (!snippet || item.url.length > 2048) continue;
    seen.add(item.url);
    const domain = new URL(item.url).hostname.replace(/^www\./, "").slice(0, 255);
    const publishedAt = normalizedDate(item.age);
    out.push({
      position: out.length + 1,
      title: (plainText(item.title) || domain).slice(0, 300),
      url: item.url,
      domain,
      snippet,
      publishedAt: publishedAt?.slice(0, 40),
    });
  }
  return out;
}

import type { BravePlan } from "../../contracts";
import { ApiError } from "../http";
import { providerError, providerFetch, readJsonObject, readProviderError, textField } from "./errors";
import { waitForBraveSlot } from "./limiter";
import {
  clampQuery,
  DEFAULT_RETRY_WAIT_MS,
  freshnessWindow,
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

interface BraveErrorBody {
  error?: { code?: unknown; detail?: unknown; message?: unknown };
}

/** Maps a Brave HTTP status and error body (`{ error: { code, detail } }`) to a stable Beamling error. */
export function braveError(status: number, value: unknown = {}): ApiError {
  const detail = (value as BraveErrorBody | null)?.error ?? {};
  const message = textField(detail.detail) || textField(detail.message);
  const code = textField(detail.code);
  if (/not included in the plan/i.test(message) || code === "OPTION_NOT_IN_PLAN") {
    return new ApiError(
      "BRAVE_PLAN_MISSING_SEARCH",
      "This key is not attached to Brave's Search plan. Create or select a Search-plan key at https://api-dashboard.search.brave.com/app/keys.",
      400,
      "brave",
    );
  }
  // Brave's own messages are not shown for unknown statuses; the generic message is used instead.
  return providerError("brave", code === "SUBSCRIPTION_TOKEN_INVALID" ? 401 : status);
}

const readError = (response: Response) => readProviderError("brave", response, braveError);

const BRAVE_FRESHNESS = { day: "pd", week: "pw", month: "pm", year: "py" } as const;

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
  const window = freshnessWindow(options.freshnessDays);
  if (window) url.searchParams.set("freshness", BRAVE_FRESHNESS[window]);

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

export async function validateBraveKey(key: string, plan: BravePlan): Promise<void> {
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
  const body = await readJsonObject<BraveWebResponse>("brave", response, options.signal);
  return normalizedSources(
    (Array.isArray(body.web?.results) ? body.web.results : []).map((item) => ({
      url: item.url,
      title: item.title,
      snippet: item.description,
      publishedAt: item.age,
    })),
  );
}

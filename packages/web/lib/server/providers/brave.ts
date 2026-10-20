import { createHash } from "node:crypto";
import { isSafeHttpUrl } from "../../url";
import { ApiError } from "../http";

export interface RetrievedSource {
  position: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt?: string;
}

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

function normalizedDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : value;
}

function plainText(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function mapStatus(status: number): { code: string; message: string } {
  if (status === 401) return { code: "INVALID_KEY", message: "Brave Search rejected this key." };
  if (status === 402) return { code: "INSUFFICIENT_CREDITS", message: "Brave Search has no remaining quota." };
  if (status === 429) {
    return { code: "PROVIDER_RATE_LIMITED", message: "Brave Search is rate-limiting this key." };
  }
  if (status >= 500) {
    return { code: "PROVIDER_UNAVAILABLE", message: "Brave Search is temporarily unavailable." };
  }
  return { code: "PROVIDER_ERROR", message: `Brave Search returned HTTP ${status}.` };
}

async function readError(response: Response): Promise<ApiError> {
  let message = "";
  try {
    const body = (await response.json()) as { error?: { detail?: string; message?: string } };
    message = body.error?.detail ?? body.error?.message ?? "";
  } catch {}
  if (message) console.warn("Brave request failed", { status: response.status, detail: message.slice(0, 300) });
  if (/not included in the plan/i.test(message)) {
    return new ApiError(
      "BRAVE_PLAN_MISSING_SEARCH",
      `This key is not attached to Brave's Search plan. Create or select a Search-plan key at https://api-dashboard.search.brave.com/app/keys. Brave said: ${message}`,
      400,
      "brave",
    );
  }
  const mapped = mapStatus(response.status);
  return new ApiError(mapped.code, message || mapped.message, response.status, "brave");
}

function clampQuery(query: string): string {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 75).join(" ");
  return words.slice(0, 600);
}

function freshnessValue(days?: number): string | undefined {
  if (!days || days <= 0 || days > 365) return undefined;
  if (days <= 1) return "pd";
  if (days <= 7) return "pw";
  if (days <= 31) return "pm";
  return "py";
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function minIntervalMs(): number {
  const raw = Number(process.env.BRAVE_MIN_INTERVAL_MS ?? "1100");
  return Number.isFinite(raw) && raw >= 0 ? raw : 1100;
}

// Per-process spacing, keyed by a hash so plaintext keys are not kept in long-lived maps.
const lastRequestAt = new Map<string, number>();
const queues = new Map<string, Promise<void>>();

function limiterKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function pruneLastRequests(now: number): void {
  const horizon = Math.max(minIntervalMs(), 60_000);
  for (const [key, at] of lastRequestAt) {
    if (now - at > horizon && !queues.has(key)) lastRequestAt.delete(key);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function withBraveSlot<T>(apiKey: string, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  const key = limiterKey(apiKey);
  pruneLastRequests(Date.now());
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  queues.set(key, tail);
  await previous;

  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const wait = (lastRequestAt.get(key) ?? 0) + minIntervalMs() - Date.now();
    if (wait > 0) await sleep(wait, signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    lastRequestAt.set(key, Date.now());
    return await work();
  } finally {
    release();
    if (queues.get(key) === tail) queues.delete(key);
  }
}

async function requestWebSearch(
  key: string,
  query: string,
  options: { count: number; freshnessDays?: number; signal?: AbortSignal },
): Promise<Response> {
  return withBraveSlot(key, options.signal, async () => {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", clampQuery(query));
    url.searchParams.set("count", String(Math.min(20, Math.max(1, options.count))));
    const freshness = freshnessValue(options.freshnessDays);
    if (freshness) url.searchParams.set("freshness", freshness);
    return fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
      signal: requestSignal(options.signal),
      cache: "no-store",
    });
  });
}

export async function validateBraveKey(key: string): Promise<void> {
  const response = await requestWebSearch(key, "Beamling connectivity test", { count: 1 });
  if (!response.ok) throw await readError(response);
  await response.arrayBuffer();
}

export async function searchBrave(
  key: string,
  query: string,
  options: { count: number; freshnessDays?: number; signal?: AbortSignal },
): Promise<RetrievedSource[]> {
  const response = await requestWebSearch(key, query, options);
  if (!response.ok) throw await readError(response);
  const body = (await response.json()) as BraveWebResponse;
  const results = body.web?.results ?? [];
  const seen = new Set<string>();
  const out: RetrievedSource[] = [];

  for (const item of results) {
    if (!item.url || seen.has(item.url) || !isSafeHttpUrl(item.url)) continue;
    // A source is usable only with a non-empty snippet: it is the only evidence the model sees.
    const snippet = plainText(item.description).slice(0, 1800);
    if (!snippet) continue;
    seen.add(item.url);
    const domain = new URL(item.url).hostname.replace(/^www\./, "");
    out.push({
      position: out.length + 1,
      title: plainText(item.title) || domain,
      url: item.url,
      domain,
      snippet,
      publishedAt: normalizedDate(item.age),
    });
  }
  return out;
}

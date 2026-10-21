export interface RetrievedSource {
  position: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt?: string;
}

export interface SearchOptions {
  count: number;
  freshnessDays?: number;
  signal?: AbortSignal;
  plan?: "free" | "paid";
}

export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RETRY_WAIT_MS = 5_000;
export const DEFAULT_RETRY_WAIT_MS = 1_000;

export function normalizedDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : value;
}

export function plainText(value: string | undefined): string {
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
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

export function clampQuery(query: string, maxWords = 50, maxChars = 400): string {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
  return words.slice(0, maxChars);
}

export function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

export function retryWaitMs(headers: Headers, now = Date.now()): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  return DEFAULT_RETRY_WAIT_MS;
}

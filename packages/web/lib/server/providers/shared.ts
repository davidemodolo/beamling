import { isSafeHttpUrl } from "../../url";

export interface RetrievedSource {
  position: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt?: string;
}

export interface SearchResultFields {
  url?: unknown;
  title?: unknown;
  snippet?: unknown;
  publishedAt?: unknown;
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


/** One shared 429 policy: read the body, wait, then retry once. */
export async function retryOnceOn429(
  response: Response,
  send: () => Promise<Response>,
  signal: AbortSignal | undefined,
  waitMs = retryWaitMs(response.headers),
): Promise<Response> {
  if (response.status !== 429) return response;
  if (waitMs > MAX_RETRY_WAIT_MS) return response;
  await response.arrayBuffer().catch(() => {});
  await sleep(waitMs, signal);
  return send();
}

/** Shared URL safety, title/snippet limits and domain normalization. */
export function normalizedSource(fields: SearchResultFields, position: number): RetrievedSource | null {
  const url = typeof fields.url === "string" ? fields.url : "";
  if (!url || !isSafeHttpUrl(url) || url.length > 2048) return null;
  const snippet = plainText(typeof fields.snippet === "string" ? fields.snippet : "").slice(0, 1800);
  if (!snippet) return null;
  const domain = new URL(url).hostname.replace(/^www\./, "").slice(0, 255);
  return {
    position,
    title: (plainText(typeof fields.title === "string" ? fields.title : "") || domain).slice(0, 300),
    url,
    domain,
    snippet,
    publishedAt:
      typeof fields.publishedAt === "string" ? normalizedDate(fields.publishedAt)?.slice(0, 40) : undefined,
  };
}

/** Normalizes provider results in order, dropping unusable entries and repeated URLs; positions start at 1. */
export function normalizedSources(items: readonly SearchResultFields[]): RetrievedSource[] {
  const seen = new Set<string>();
  const out: RetrievedSource[] = [];
  for (const fields of items) {
    if (typeof fields.url !== "string" || !fields.url || seen.has(fields.url)) continue;
    const source = normalizedSource(fields, out.length + 1);
    if (!source) continue;
    seen.add(fields.url);
    out.push(source);
  }
  return out;
}

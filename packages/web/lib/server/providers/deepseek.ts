import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ApiError } from "../http";
import { providerError, providerFetch, readJsonObject, readProviderError, textField } from "./errors";
import type { LlmAdapter, ModelStep } from "./llm";
import {
  clampQuery,
  freshnessStart,
  normalizedSources,
  requestSignal,
  retryOnceOn429,
  type RetrievedSource,
  type SearchOptions,
} from "./shared";

const API = "https://api.deepseek.com";
/** DeepSeek Search rejects queries longer than 128 characters. */
const MAX_QUERY_CHARS = 128;

/**
 * List prices in USD per million tokens at peak hours (api-docs.deepseek.com, November 2026).
 * Off-peak is half. Unknown models are priced as Flash.
 */
const PEAK_PRICES: Record<string, { cacheHit: number; cacheMiss: number; output: number }> = {
  "deepseek-flash": { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
  "deepseek-v4-pro": { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
};

/**
 * Peak is 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday. Chinese public holidays are off-peak
 * but are not tracked, so the estimate can only be high, never low.
 */
export function isDeepSeekPeak(at: Date): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/** Estimated cost of one step from its token counts; DeepSeek does not report a price. */
export function deepSeekCost(step: ModelStep, at = new Date()): number {
  const model = step.response?.modelId ?? "";
  const price = PEAK_PRICES[model] ?? PEAK_PRICES["deepseek-flash"];
  const input = step.usage.inputTokens ?? 0;
  const cached = Math.min(step.usage.inputTokenDetails?.cacheReadTokens ?? 0, input);
  const output = step.usage.outputTokens ?? 0;
  const peak = (cached * price.cacheHit + (input - cached) * price.cacheMiss + output * price.output) / 1_000_000;
  return isDeepSeekPeak(at) ? peak : peak / 2;
}

export const deepSeekModels: LlmAdapter = {
  model: (key, apiModel) => createDeepSeek({ apiKey: key }).chat(apiModel),
  // Thinking is off for research: the planner and gap review expect direct replies, and forcing the
  // first research step to call search requires it off. The answer is written with thinking on, so
  // the reasoning can be shown.
  providerOptions: { deepseek: { thinking: { type: "disabled" } } },
  answerProviderOptions: { deepseek: { thinking: { type: "enabled" } } },
  stepUsage: (step) => ({ costUsd: deepSeekCost(step) }),
};

export function deepSeekError(status: number, value: unknown = {}): ApiError {
  return providerError("deepseek", status, textField((value as { error?: { message?: unknown } } | null)?.error?.message));
}

const readError = (response: Response) => readProviderError("deepseek", response, deepSeekError);

interface BalanceResponse {
  is_available?: boolean;
}

/** Checks the key with the balance endpoint, which spends nothing. A key without balance is rejected. */
export async function validateDeepSeekKey(key: string): Promise<void> {
  const response = await providerFetch("deepseek", `${API}/user/balance`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
    signal: requestSignal(),
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  const body = (await response.json().catch(() => null)) as BalanceResponse | null;
  if (body?.is_available === false) throw deepSeekError(402);
}

/** Recency is a query operator; the base query is shortened so the whole query fits the limit. */
function searchQuery(query: string, freshnessDays?: number): string {
  const since = freshnessStart(freshnessDays);
  const after = since ? ` after:${since.toISOString().slice(0, 10)}` : "";
  return `${clampQuery(query, 50, MAX_QUERY_CHARS - after.length).trim()}${after}`;
}

interface SearchResponse {
  results?: {
    title?: string;
    url?: string;
    snippet?: string;
    summary?: string;
    date?: string | null;
  }[];
}

export async function searchDeepSeek(key: string, query: string, options: SearchOptions): Promise<RetrievedSource[]> {
  const send = () =>
    providerFetch(
      "deepseek",
      `${API}/v1/tools/search`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query: searchQuery(query, options.freshnessDays),
          count: Math.min(50, Math.max(1, options.count)),
        }),
        signal: requestSignal(options.signal),
        cache: "no-store",
      },
      options.signal,
    );
  const response = await retryOnceOn429(await send(), send, options.signal);
  if (!response.ok) throw await readError(response);
  const body = await readJsonObject<SearchResponse>("deepseek", response, options.signal);
  return normalizedSources(
    (Array.isArray(body.results) ? body.results : []).map((item) => ({
      url: item.url,
      title: item.title,
      // The summary is written for models to read; the short snippet is the fallback.
      snippet: item.summary || item.snippet,
      publishedAt: item.date ?? undefined,
    })),
  );
}

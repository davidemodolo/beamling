import type { CredentialProvider } from "../../contracts";
import { providerName } from "../../provider-catalog";
import type { CredentialStatus } from "../../types";
import { ApiError } from "../http";
import { log } from "../log";

export type ProviderName = CredentialProvider;

const label = (provider: ProviderName) => providerName(provider);

export function unavailable(provider: ProviderName, message?: string): ApiError {
  return new ApiError(
    "PROVIDER_UNAVAILABLE",
    message ?? `${label(provider)} is temporarily unavailable. Try again shortly.`,
    502,
    provider,
  );
}

/**
 * Normalizes a failure while talking to a provider. A stop requested by the caller stays an abort;
 * network errors, resets and our own request timeouts mean the provider is unavailable, never that
 * the key is wrong.
 */
export function transportError(provider: ProviderName, error: unknown, callerSignal?: AbortSignal): unknown {
  if (error instanceof ApiError) return error;
  if (callerSignal?.aborted) return error;
  return unavailable(provider, `${label(provider)} could not be reached. Try again shortly.`);
}

export async function providerFetch(
  provider: ProviderName,
  input: string | URL,
  init: RequestInit,
  callerSignal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw transportError(provider, error, callerSignal);
  }
}

/**
 * The HTTP status ladder every provider shares. Adapters map their provider-only statuses and
 * error codes first, then fall through to this. `detail` is the provider's message for unknown statuses.
 */
export function providerError(provider: ProviderName, status: number, detail = ""): ApiError {
  const name = label(provider);
  const error = (code: string, message: string, httpStatus: number) => new ApiError(code, message, httpStatus, provider);
  if (status === 401 || status === 403) return error("CREDENTIAL_INVALID", `${name} rejected this key.`, 400);
  if (status === 402) return error("INSUFFICIENT_CREDITS", `${name} has no remaining credits for this key.`, 402);
  if (status === 429) return error("PROVIDER_RATE_LIMITED", `${name} is rate-limiting this key.`, 429);
  if (status === 408 || status >= 500) return unavailable(provider);
  return error("PROVIDER_ERROR", detail.slice(0, 500) || `${name} returned HTTP ${status}.`, 502);
}

/** Reads a failed response's JSON body (if any) and maps it with the adapter's error function. */
export async function readProviderError(
  provider: ProviderName,
  response: Response,
  toError: (status: number, body: unknown) => ApiError,
): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {}
  // Provider text can contain the query or a credential; keep only the stable status in logs.
  log.warn("Provider request failed", { provider, status: response.status });
  return toError(response.status, body);
}

/** Parses a successful response that must be a JSON object; anything else means the provider is unavailable. */
export async function readJsonObject<T>(provider: ProviderName, response: Response, callerSignal?: AbortSignal): Promise<T> {
  try {
    const parsed: unknown = await response.json();
    if (parsed !== null && typeof parsed === "object") return parsed as T;
  } catch (error) {
    if (callerSignal?.aborted) throw error;
  }
  throw unavailable(provider, `${label(provider)} returned an unreadable response.`);
}

/** A provider's string field, or "" when it is missing or not a string. */
export function textField(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

/** Only answers about the key itself change its stored status; outages and unknown errors leave it as it was. */
export function credentialStatusFor(error: unknown): CredentialStatus | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "PROVIDER_RATE_LIMITED") return "rate_limited";
  if (["CREDENTIAL_INVALID", "INSUFFICIENT_CREDITS", "BRAVE_PLAN_MISSING_SEARCH", "SEARCH_PLAN_MISSING", "QUOTA_EXCEEDED"].includes(error.code)) return "invalid";
  return null;
}

import type { CredentialProvider } from "../../contracts";
import { providerName } from "../../provider-catalog";
import type { CredentialStatus } from "../../types";
import { ApiError } from "../http";

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

/** Only answers about the key itself change its stored status; outages and unknown errors leave it as it was. */
export function credentialStatusFor(error: unknown): CredentialStatus | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "PROVIDER_RATE_LIMITED") return "rate_limited";
  if (["CREDENTIAL_INVALID", "INSUFFICIENT_CREDITS", "BRAVE_PLAN_MISSING_SEARCH", "SEARCH_PLAN_MISSING", "QUOTA_EXCEEDED"].includes(error.code)) return "invalid";
  return null;
}

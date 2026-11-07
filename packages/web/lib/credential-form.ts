import type { BravePlan, CredentialProvider } from "./contracts";
import { PROVIDERS } from "./provider-catalog";

/** The key-limit fields as typed in the form; empty strings mean "not set". */
export interface CredentialLimitDraft {
  plan: BravePlan;
  expiresOn: string;
  budgetUsd: string;
}

export const EMPTY_LIMITS: CredentialLimitDraft = { plan: "free", expiresOn: "", budgetUsd: "" };

export function limitsPayload({ plan, expiresOn, budgetUsd }: CredentialLimitDraft) {
  return { plan, expiresOn: expiresOn || null, budgetUsd: budgetUsd ? Number(budgetUsd) : null };
}

/** One payload policy for onboarding and Settings; limits exist only for providers that have them. */
export function credentialInput(
  provider: CredentialProvider,
  key: string,
  { limits = EMPTY_LIMITS, validateNow = true }: { limits?: CredentialLimitDraft; validateNow?: boolean } = {},
) {
  const info = PROVIDERS[provider];
  // Providers with a free check are always checked; the rest honor the checkbox.
  const validate = info.freeValidation ? undefined : validateNow;
  // The server rejects limit fields (even null ones) for providers without key limits.
  if (!info.keyLimits) return { provider, key: key.trim(), validate };
  return { provider, key: key.trim(), ...limitsPayload(limits), validate };
}

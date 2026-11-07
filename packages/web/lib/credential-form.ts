import { BUDGET_PERIODS, type BravePlan, type BudgetPeriod, type CredentialProvider } from "./contracts";
import { PROVIDERS } from "./provider-catalog";

export const DEFAULT_BUDGET_PERIOD: BudgetPeriod = BUDGET_PERIODS[0];

export interface CredentialLimitDraft {
  plan: BravePlan;
  expiresOn: string;
  budgetUsd: string;
  budgetPeriod?: BudgetPeriod;
}

export interface CredentialInputDraft extends CredentialLimitDraft {
  provider: CredentialProvider;
  key: string;
  validateNow: boolean;
}

/** Providers with a free check are always checked; the rest honor the checkbox. */
export function shouldValidateKey(provider: CredentialProvider, validateNow: boolean): boolean {
  return PROVIDERS[provider].freeValidation || validateNow;
}

/** One payload policy for onboarding and Settings; limits exist only for providers that have them. */
export function credentialInput({ provider, key, plan, expiresOn, budgetUsd, budgetPeriod, validateNow }: CredentialInputDraft) {
  const validate = PROVIDERS[provider].freeValidation ? undefined : shouldValidateKey(provider, validateNow);
  // The server rejects limit fields (even null ones) for providers without key limits.
  if (!PROVIDERS[provider].keyLimits) return { provider, key: key.trim(), validate };
  return {
    provider,
    key: key.trim(),
    plan,
    expiresOn: expiresOn || null,
    budgetUsd: budgetUsd ? Number(budgetUsd) : null,
    budgetPeriod: budgetPeriod ?? DEFAULT_BUDGET_PERIOD,
    validate,
  };
}

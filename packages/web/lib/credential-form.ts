import { BUDGET_PERIODS, type BravePlan, type BudgetPeriod, type CredentialKind, type CredentialProvider, type SearchProvider } from "./contracts";
import { searchProviderInfo } from "./provider-catalog";

export const DEFAULT_BUDGET_PERIOD: BudgetPeriod = BUDGET_PERIODS[0];

export interface CredentialLimitDraft {
  plan: BravePlan;
  expiresOn: string;
  budgetUsd: string;
  budgetPeriod?: BudgetPeriod;
}

export interface CredentialInputDraft extends CredentialLimitDraft {
  kind: CredentialKind;
  provider: CredentialProvider;
  key: string;
  validateNow: boolean;
}

/** Offline-capable providers save without a billable check; the rest honor the checkbox. */
export function shouldValidateKey(provider: SearchProvider, validateNow: boolean): boolean {
  return searchProviderInfo(provider).freeValidation || validateNow;
}

/** One payload policy for onboarding and Settings; limits exist only for Brave. */
export function credentialInput({
  kind,
  provider,
  key,
  plan,
  expiresOn,
  budgetUsd,
  budgetPeriod,
  validateNow,
}: CredentialInputDraft) {
  const brave = provider === "brave";
  return {
    kind,
    provider,
    key: key.trim(),
    plan: brave ? plan : undefined,
    expiresOn: brave && expiresOn ? expiresOn : null,
    budgetUsd: brave && budgetUsd ? Number(budgetUsd) : null,
    budgetPeriod: brave ? (budgetPeriod ?? DEFAULT_BUDGET_PERIOD) : null,
    validate: kind === "search" ? shouldValidateKey(provider as SearchProvider, validateNow) : undefined,
  };
}

"use client";

import type { CredentialLimitDraft } from "@/lib/credential-form";
import type { ProviderInfo } from "@/lib/provider-catalog";

/** Plan, expiry and budget for a provider with key limits (Brave), as declared by the user. */
export function KeyLimitFields({
  id,
  provider,
  value,
  onChange,
}: {
  id: string;
  provider: ProviderInfo;
  value: CredentialLimitDraft;
  onChange: (value: CredentialLimitDraft) => void;
}) {
  const name = provider.shortName;
  return (
    <>
      <div className="field">
        <label className="label" htmlFor={`${id}-plan`}>{name} plan</label>
        <select
          id={`${id}-plan`}
          className="select"
          value={value.plan}
          onChange={(event) => onChange({ ...value, plan: event.target.value === "paid" ? "paid" : "free" })}
        >
          <option value="free">Free · 1 request/second</option>
          <option value="paid">Paid / provider plan</option>
        </select>
        <p className="hint">We ask because {name}&apos;s API does not expose the key plan.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor={`${id}-expiry`}>Key expiry (optional)</label>
        <input
          id={`${id}-expiry`}
          className="input"
          type="date"
          value={value.expiresOn}
          onChange={(event) => onChange({ ...value, expiresOn: event.target.value })}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${id}-budget`}>Monthly budget in USD (optional)</label>
        <input
          id={`${id}-budget`}
          className="input"
          type="number"
          min="0.01"
          step="0.01"
          value={value.budgetUsd}
          onChange={(event) => onChange({ ...value, budgetUsd: event.target.value })}
          placeholder="5.00"
        />
        <p className="hint">
          Copy the expiry and budget from the {name} dashboard. They are used only for warnings; Beamling estimates spend
          from request counts.
        </p>
      </div>
    </>
  );
}

/** Opt-out for providers whose only key check is a billable search request. */
export function ValidateNowField({ id, checked, onChange }: { id: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div>
      <label className="check-row" htmlFor={`${id}-validate`}>
        <input id={`${id}-validate`} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        Validate the key now
      </label>
      <p className="hint">
        {checked
          ? "Uses one search request."
          : "Saved unverified. You can validate it later in Settings."}
      </p>
    </div>
  );
}

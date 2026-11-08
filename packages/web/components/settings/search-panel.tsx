"use client";

import { errorMessage } from "@/lib/api";
import { isLlmProvider, type SearchProvider } from "@/lib/contracts";
import { useToast } from "@/lib/hooks/use-toast";
import { SEARCH_PROVIDERS, usableProviders } from "@/lib/provider-catalog";
import { useAccount } from "@/lib/store";
import { KeysNotice } from "./key-notices";
import { ProviderKey } from "./provider-key";

/** Each search provider with its key; the chosen one is the default for new answers. */
export function SearchPanel() {
  const { settings, updateSettings, credentials } = useAccount();
  const keyed = usableProviders(credentials);
  const [toast, showToast] = useToast();

  const choose = (id: SearchProvider, name: string) => {
    updateSettings({ defaultSearchProvider: id })
      .then(() => showToast(`${name} is now the default`))
      .catch((cause) => showToast(errorMessage(cause, "Could not save")));
  };

  return (
    <div className="settings-stack">
      <p className="hint">The default for new answers. You can change it for one answer from the composer.</p>
      <fieldset className="settings-stack choice-cards">
        <legend>Default search provider</legend>
        {SEARCH_PROVIDERS.map((provider) => {
          const id = provider.id as SearchProvider;
          const usable = keyed.has(id);
          // A provider that also runs models keeps its key on the Models tab.
          const sharedKey = isLlmProvider(id);
          return (
            <section className="settings-card" key={id}>
              <div className="settings-card-head">
                <label className="choice choice-head">
                  <input
                    type="radio"
                    name="search-provider"
                    value={id}
                    disabled={!usable}
                    checked={settings.defaultSearchProvider === id}
                    onChange={() => choose(id, provider.name)}
                  />
                  <span>
                    <strong>{provider.name}</strong>
                    <small>
                      {sharedKey
                        ? `Uses your ${provider.name} key from the Models tab`
                        : usable
                          ? "Ready"
                          : "Add a key to use it"}
                    </small>
                  </span>
                </label>
              </div>
              {sharedKey ? null : (
                <div className="settings-card-body tight">
                  <ProviderKey provider={provider} onToast={showToast} />
                </div>
              )}
            </section>
          );
        })}
      </fieldset>
      <KeysNotice />
      {toast}
    </div>
  );
}

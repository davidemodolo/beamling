"use client";

import { Icon } from "@/components/ui/icon";
import { errorMessage } from "@/lib/api";
import { useToast } from "@/lib/hooks/use-toast";
import { MODEL_GROUPS, SEARCH_PROVIDERS, modelProvider, providerInfo, searchProviderInfo } from "@/lib/provider-catalog";
import { useAccount } from "@/lib/store";
import { MODE_HINTS, MODE_ICONS, MODE_LABELS, MODES } from "@/lib/modes";

export function DefaultsPanel() {
  const { settings, updateSettings, credentials } = useAccount();
  const keyed = new Set(credentials.map((credential) => credential.provider));
  const notices = [...new Set([providerInfo(modelProvider(settings.llmModel)).notice, searchProviderInfo(settings.defaultSearchProvider).notice])].filter(Boolean);
  const [toast, showToast] = useToast();

  const save = (patch: Parameters<typeof updateSettings>[0], message: string) => {
    updateSettings(patch)
      .then(() => showToast(message))
      .catch((cause) => showToast(errorMessage(cause, "Could not save")));
  };

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <div className="settings-card-head">
          <div style={{ flex: 1 }}>
            <h2>Answer defaults</h2>
            <p>Used when you start a new question.</p>
          </div>
        </div>
        <div className="settings-card-body">
          <div className="field">
            <span className="label">Mode</span>
            <div className="segmented" style={{ width: "fit-content" }} role="group" aria-label="Default mode">
              {MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={settings.defaultMode === mode}
                  onClick={() => save({ defaultMode: mode }, `${MODE_LABELS[mode]} is now the default`)}
                >
                  <Icon name={MODE_ICONS[mode]} size={12} />
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            <p className="hint">{MODE_HINTS[settings.defaultMode]}</p>
          </div>

          <div className="field">
            <label className="label" htmlFor="llm-model">Model</label>
            <select
              id="llm-model"
              className="select"
              value={settings.llmModel}
              onChange={(event) => save({ llmModel: event.target.value }, "Model updated")}
            >
              {MODEL_GROUPS.map(({ provider, models }) => (
                <optgroup key={provider.id} label={keyed.has(provider.id) ? provider.name : `${provider.name} · no key`}>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="hint">Runs on your {providerInfo(modelProvider(settings.llmModel)).name} key.</p>
          </div>

          <div className="field">
            <label className="label" htmlFor="search-provider">Default search provider</label>
            <select
              id="search-provider"
              className="select"
              value={settings.defaultSearchProvider}
              onChange={(event) => save({ defaultSearchProvider: event.target.value as typeof settings.defaultSearchProvider }, "Search provider updated")}
            >
              {SEARCH_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {keyed.has(provider.id) ? provider.name : `${provider.name} · no key`}
                </option>
              ))}
            </select>
            <p className="hint">You can change it for an individual answer from the composer.</p>
          </div>

          {notices.map((notice) => (
            <div className="notice" key={notice}>
              <Icon name="alert" size={16} />
              <div>{notice}</div>
            </div>
          ))}
        </div>
      </section>

      {toast}
    </div>
  );
}

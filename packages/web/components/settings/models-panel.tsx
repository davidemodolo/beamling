"use client";

import { Icon } from "@/components/ui/icon";
import { errorMessage } from "@/lib/api";
import { isCredentialProvider } from "@/lib/contracts";
import { useToast } from "@/lib/hooks/use-toast";
import { MODE_HINTS, MODE_ICONS, MODE_LABELS, MODES } from "@/lib/modes";
import { MODEL_GROUPS, usableProviders } from "@/lib/provider-catalog";
import { useAccount } from "@/lib/store";
import { KeysNotice, RetiredKeys } from "./key-notices";
import { ProviderKey } from "./provider-key";

/** The default mode, then each model provider with its key and the models that key runs. */
export function ModelsPanel() {
  const { settings, updateSettings, credentials } = useAccount();
  const keyed = usableProviders(credentials);
  const [toast, showToast] = useToast();

  const save = (patch: Parameters<typeof updateSettings>[0], message: string) => {
    updateSettings(patch)
      .then(() => showToast(message))
      .catch((cause) => showToast(errorMessage(cause, "Could not save")));
  };

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <div className="settings-card-body">
          <div className="field">
            <span className="label">Default mode</span>
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
        </div>
      </section>

      {MODEL_GROUPS.map(({ provider, models }) => {
        const usable = keyed.has(provider.id);
        return (
          <section className="settings-card" key={provider.id} aria-labelledby={`${provider.id}-models-title`}>
            <div className="settings-card-head">
              <div style={{ flex: 1 }}>
                <h2 id={`${provider.id}-models-title`}>{provider.name}</h2>
                <p>{models.length === 1 ? "One model" : `${models.length} models`} on one key</p>
              </div>
            </div>
            <div className="settings-card-body tight">
              <ProviderKey provider={provider} onToast={showToast} />
              <fieldset className="choice-list" disabled={!usable}>
                <legend>{usable ? "Model" : "Add a key to use these models"}</legend>
                {models.map((model) => (
                  <label className="choice" key={model.id}>
                    <input
                      type="radio"
                      name="llm-model"
                      value={model.id}
                      checked={settings.llmModel === model.id}
                      onChange={() => save({ llmModel: model.id }, `${model.name} is now the default`)}
                    />
                    <span>{model.name}</span>
                  </label>
                ))}
              </fieldset>
              {provider.notice ? <p className="hint provider-notice">{provider.notice}</p> : null}
            </div>
          </section>
        );
      })}

      <RetiredKeys credentials={credentials.filter((item) => !isCredentialProvider(item.provider))} onToast={showToast} />
      <KeysNotice />
      {toast}
    </div>
  );
}

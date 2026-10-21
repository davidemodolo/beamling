"use client";

import { Icon } from "@/components/ui/icon";
import { errorMessage } from "@/lib/api";
import { useToast } from "@/lib/hooks/use-toast";
import { OPENROUTER_MODELS } from "@/lib/providers";
import { useStore } from "@/lib/store";
import { MODE_HINTS, MODE_LABELS, MODES } from "@/lib/modes";

export function DefaultsPanel() {
  const { settings, updateSettings } = useStore();
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
                  <Icon name={mode === "quick" ? "zap" : mode === "deep" ? "layers" : "sparkles"} size={12} />
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            <p className="hint">{MODE_HINTS[settings.defaultMode]}</p>
          </div>

          <div className="field">
            <label className="label" htmlFor="llm-model">OpenRouter model</label>
            <select
              id="llm-model"
              className="select"
              value={settings.llmModel}
              onChange={(event) => save({ llmModel: event.target.value }, "Model updated")}
            >
              {OPENROUTER_MODELS.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="label">Search</span>
            <div className="input mono" style={{ display: "flex", alignItems: "center" }}>Brave Search · Web Search</div>
          </div>
        </div>
      </section>

      {toast}
    </div>
  );
}

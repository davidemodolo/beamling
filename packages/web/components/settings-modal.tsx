"use client";

import { useRef, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { AccountPanel } from "./settings/account-panel";
import { ModelsPanel } from "./settings/models-panel";
import { SearchPanel } from "./settings/search-panel";

export type SettingsTab = "models" | "search" | "account";

const TABS: { id: SettingsTab; label: string; icon: "sparkles" | "search" | "user" }[] = [
  { id: "models", label: "Models", icon: "sparkles" },
  { id: "search", label: "Search", icon: "search" },
  { id: "account", label: "Account", icon: "user" },
];

export function SettingsModal({
  open,
  onClose,
  tab,
  onTabChange,
}: {
  open: boolean;
  onClose: () => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}) {
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});

  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((item) => item.id === tab);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const id = TABS[next].id;
    onTabChange(id);
    tabRefs.current[id]?.focus();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      width={680}
      footer={
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          Done
        </button>
      }
    >
      <div
        className="segmented"
        role="tablist"
        aria-label="Settings sections"
        style={{ width: "fit-content", marginBottom: 20 }}
        onKeyDown={onKeyDown}
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[item.id] = node;
            }}
            id={`settings-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={tab === item.id ? `settings-panel-${item.id}` : undefined}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => onTabChange(item.id)}
          >
            <Icon name={item.icon} size={12} /> {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`} tabIndex={0}>
        {tab === "models" ? <ModelsPanel /> : null}
        {tab === "search" ? <SearchPanel /> : null}
        {tab === "account" ? <AccountPanel /> : null}
      </div>
    </Modal>
  );
}

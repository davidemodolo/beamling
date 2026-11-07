"use client";

import { Icon } from "../ui/icon";
import { UserAvatar } from "../user-avatar";
import type { User } from "@/lib/types";

/** The chat header: conversation title and mode/model/provider line, the sources toggle and the account button. */
export function ChatTopbar(props: {
  title: string;
  subtitle: string;
  user: User | null;
  isMobile: boolean;
  sources: { count: number; loading: boolean; hidden: boolean; panelOpen: boolean; sheetOpen: boolean; onToggle: () => void };
  onOpenSidebar: () => void;
  onOpenSettings: () => void;
}) {
  const { title, subtitle, user, isMobile, sources, onOpenSidebar, onOpenSettings } = props;
  const expanded = isMobile ? sources.sheetOpen : sources.panelOpen;
  return (
    <header className="topbar">
      <button type="button" className="btn btn-ghost btn-icon mobile-only" onClick={onOpenSidebar} aria-label="Open conversations">
        <Icon name="menu" size={18} />
      </button>
      <div className="topbar-title">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="topbar-actions">
        {sources.count || sources.loading ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={sources.onToggle}
            aria-label={`Sources, ${sources.count}`}
            aria-expanded={expanded}
            aria-controls={expanded ? (isMobile ? "sources-sheet" : "sources-pane") : undefined}
            title="Sources"
          >
            <Icon name={sources.hidden ? "panel-right" : "layers"} size={15} />
            <span className="mono" style={{ fontSize: 11 }}>
              {sources.count}
            </span>
          </button>
        ) : null}
        <button type="button" className="avatar-button" onClick={onOpenSettings} aria-label="Open settings">
          <UserAvatar name={user?.name} email={user?.email} avatarUrl={user?.avatarUrl} />
        </button>
      </div>
    </header>
  );
}

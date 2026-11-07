"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { AnswerStreamsProvider } from "@/lib/answer-streams";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { StoreProvider, useAccount } from "@/lib/store";
import { SettingsModal, type SettingsTab } from "./settings-modal";
import { Sidebar } from "./sidebar";
import { SidebarContext, type SidebarContextValue } from "./sidebar-context";
import { WorkspaceError } from "./workspace-error";

function Frame({ children, notice }: { children: ReactNode; notice?: string }) {
  const { user, error } = useAccount();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("keys");
  const drawerRef = useRef<HTMLElement>(null);
  const closeDrawer = useCallback(() => setOpen(false), []);
  useFocusTrap(drawerRef, open, closeDrawer);

  const value = useMemo<SidebarContextValue>(
    () => ({
      openSidebar: () => setOpen(true),
      openSettings: (tab) => {
        if (tab) setSettingsTab(tab);
        setSettingsOpen(true);
      },
    }),
    [],
  );

  const shell = (
    <div className="app-shell">
      <Sidebar />
      {error && !user ? (
        <main className="main-pane" id="main">
          <WorkspaceError message={error} />
        </main>
      ) : (
        children
      )}
    </div>
  );

  return (
    <SidebarContext.Provider value={value}>
      {notice ? (
        <div className="app-noticed">
          <div className="service-notice" role="alert">
            {notice}{" "}
            <button type="button" onClick={() => value.openSettings("account")}>
              Download my data
            </button>
          </div>
          {shell}
        </div>
      ) : (
        shell
      )}
      {open ? (
        <>
          <button type="button" className="overlay" aria-label="Close menu" onClick={closeDrawer} tabIndex={-1} />
          <Sidebar mobile ref={drawerRef} onNavigate={closeDrawer} />
        </>
      ) : null}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tab={settingsTab}
        onTabChange={setSettingsTab}
      />
    </SidebarContext.Provider>
  );
}

/** `notice` is a deployment-wide message shown above the app, such as a scheduled shutdown. */
export function ChatShell({ children, notice }: { children: ReactNode; notice?: string }) {
  return (
    <StoreProvider>
      <AnswerStreamsProvider>
        <Frame notice={notice}>{children}</Frame>
      </AnswerStreamsProvider>
    </StoreProvider>
  );
}

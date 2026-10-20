"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AnswerStreamsProvider } from "@/lib/answer-streams";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { StoreProvider, useStore } from "@/lib/store";
import { SettingsModal, type SettingsTab } from "./settings-modal";
import { Sidebar } from "./sidebar";
import { WorkspaceError } from "./workspace-error";

interface SidebarContextValue {
  openSidebar: () => void;
  openSettings: (tab?: SettingsTab) => void;
}

const SidebarContext = createContext<SidebarContextValue>({ openSidebar: () => {}, openSettings: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

function Frame({ children }: { children: ReactNode }) {
  const { user, error } = useStore();
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

  return (
    <SidebarContext.Provider value={value}>
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

export function ChatShell({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <AnswerStreamsProvider>
        <Frame>{children}</Frame>
      </AnswerStreamsProvider>
    </StoreProvider>
  );
}

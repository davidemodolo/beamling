"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { StoreProvider } from "@/lib/store";
import { SettingsModal } from "./settings-modal";
import { Sidebar } from "./sidebar";

interface SidebarContextValue {
  openSidebar: () => void;
  openSettings: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({ openSidebar: () => {}, openSettings: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

function Frame({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const value = useMemo(
    () => ({ openSidebar: () => setOpen(true), openSettings: () => setSettingsOpen(true) }),
    [],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div className="app-shell">
        <Sidebar />
        {children}
      </div>
      {open ? (
        <>
          <button type="button" className="overlay" aria-label="Close menu" onClick={() => setOpen(false)} />
          <Sidebar mobile onNavigate={() => setOpen(false)} />
        </>
      ) : null}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </SidebarContext.Provider>
  );
}

export function ChatShell({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <Frame>{children}</Frame>
    </StoreProvider>
  );
}

"use client";

import { createContext, useContext } from "react";
import type { SettingsTab } from "./settings-modal";

export interface SidebarContextValue {
  openSidebar: () => void;
  openSettings: (tab?: SettingsTab) => void;
}

/** Provided by the chat shell; lets any pane open the mobile sidebar or the settings modal. */
export const SidebarContext = createContext<SidebarContextValue>({ openSidebar: () => {}, openSettings: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

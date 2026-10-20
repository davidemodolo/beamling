"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Toast } from "@/components/ui/toast";

/** A single transient toast: render `toast` somewhere and call `showToast(message)` to show it. */
export function useToast(): [toast: ReactNode, showToast: (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const clear = useCallback(() => setMessage(null), []);
  return [message ? <Toast message={message} onDone={clear} /> : null, setMessage];
}

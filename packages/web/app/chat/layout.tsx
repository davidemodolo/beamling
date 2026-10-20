import type { Metadata } from "next";
import { ChatShell } from "@/components/chat-shell";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <ChatShell>{children}</ChatShell>;
}

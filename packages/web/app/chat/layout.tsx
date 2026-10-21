import type { Metadata } from "next";
import { ChatShell } from "@/components/chat-shell";
import { requirePageUser } from "@/lib/server/page-auth";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("/chat");
  return <ChatShell>{children}</ChatShell>;
}

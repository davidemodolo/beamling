import type { Metadata } from "next";
import { ChatShell } from "@/components/chat-shell";
import { requirePageUser } from "@/lib/server/page-auth";
import { getShutdown } from "@/lib/server/repo";
import { shutdownDateLabel } from "@/lib/server/shutdown";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("/chat");
  const shutdown = await getShutdown();
  const notice = shutdown
    ? `Beamling shuts down on ${shutdownDateLabel(shutdown.scheduledAt)}. Every account and its data will then be deleted.`
    : undefined;
  return <ChatShell notice={notice}>{children}</ChatShell>;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChatShell } from "@/components/chat-shell";
import { requirePageUser } from "@/lib/server/page-auth";
import { alignDefaults, getShutdown } from "@/lib/server/repo";
import { shutdownDateLabel } from "@/lib/server/shutdown";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser("/chat");
  // Without a model key and a search key nothing can be answered: finish setup first.
  const [{ complete }, shutdown] = await Promise.all([alignDefaults(user.id), getShutdown()]);
  if (!complete) redirect("/onboarding");
  const notice = shutdown
    ? `Beamling shuts down on ${shutdownDateLabel(shutdown.scheduledAt)}. Every account and its data will then be deleted.`
    : undefined;
  return <ChatShell notice={notice}>{children}</ChatShell>;
}

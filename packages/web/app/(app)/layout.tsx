import { redirect } from "next/navigation";
import { ChatShell } from "@/components/chat-shell";
import { LEGAL_VERSION } from "@/lib/legal";
import { pageUser } from "@/lib/server/page-auth";
import { alignDefaults, getShutdown } from "@/lib/server/repo";
import { shutdownDateLabel } from "@/lib/server/shutdown";

/**
 * `/` and `/chat/:id`. Signed in, both are the app, so the shell stays mounted between them.
 * Signed out, `/` is the landing page and a conversation URL sends the visitor to sign in.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await pageUser();
  if (!user) return children;
  if (user.termsVersion !== LEGAL_VERSION) redirect("/welcome");
  // Without a model key and a search key nothing can be answered: finish setup first.
  const [{ complete }, shutdown] = await Promise.all([alignDefaults(user.id), getShutdown()]);
  if (!complete) redirect("/onboarding");
  const notice = shutdown
    ? `Beamling shuts down on ${shutdownDateLabel(shutdown.scheduledAt)}. Every account and its data will then be deleted.`
    : undefined;
  return <ChatShell notice={notice}>{children}</ChatShell>;
}

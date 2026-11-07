import type { Metadata } from "next";
import { ChatView } from "@/components/chat-view";
import { Landing } from "@/components/landing/landing";
import { pageUser } from "@/lib/server/page-auth";

export async function generateMetadata(): Promise<Metadata> {
  if (await pageUser()) return { title: "New question", robots: { index: false, follow: false } };
  return {
    title: { absolute: "Beamling · answers you can check" },
    description: "An open-source answer engine on your own keys. Every claim links to its source.",
    alternates: { canonical: "/" },
    openGraph: { url: "/" },
  };
}

/** Signed in: the app. Signed out: the landing page, which signing out is the only way back to. */
export default async function HomePage() {
  return (await pageUser()) ? <ChatView /> : <Landing />;
}

import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";
import { getCurrentUser } from "@/lib/server/session";

export const metadata: Metadata = {
  title: { absolute: "Beamling — answers you can check" },
  description:
    "A free, open-source answer engine that runs on your own model and search keys. Every claim links to its source.",
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

export default async function HomePage() {
  // The landing must render even when the database is down; it then shows the signed-out CTAs.
  const user = await getCurrentUser().catch(() => null);
  return <Landing signedIn={!!user} />;
}

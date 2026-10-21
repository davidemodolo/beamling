import type { Metadata } from "next";
import { CinematicLanding } from "@/components/landing/cinematic-landing";

export const metadata: Metadata = {
  title: { absolute: "Beamling — a little light on every answer" },
  description:
    "A hosted, bring-your-own-key answer engine. Ask anything and see exactly where the answer comes from.",
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

export default function HomePage() {
  return <CinematicLanding />;
}

import type { Metadata } from "next";
import { StoreProvider } from "@/lib/store";
import { requirePageUser } from "@/lib/server/page-auth";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("/onboarding");
  return <StoreProvider>{children}</StoreProvider>;
}

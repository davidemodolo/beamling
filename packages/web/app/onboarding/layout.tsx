import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StoreProvider } from "@/lib/store";
import { requirePageUser } from "@/lib/server/page-auth";
import { keyedProviders } from "@/lib/server/repo";
import { setupState } from "@/lib/provider-catalog";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser("/onboarding");
  // Setup is done once; later key changes happen in Settings.
  if (setupState(await keyedProviders(user.id)).complete) redirect("/");
  return <StoreProvider>{children}</StoreProvider>;
}

import type { Metadata } from "next";
import { LimitsView } from "@/components/limits-view";
import { requirePageUser } from "@/lib/server/page-auth";
import { usageReport } from "@/lib/server/repo";

export const metadata: Metadata = { title: "Limits", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The account's own limits and usage. Rendered per request for the signed-in owner only. */
export default async function LimitsPage() {
  const user = await requirePageUser("/limits");
  return <LimitsView usage={await usageReport(user.id)} />;
}

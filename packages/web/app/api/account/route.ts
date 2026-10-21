import { abortChats } from "@/lib/server/active-chats";
import { analytics } from "@/lib/server/analytics";
import { eraseAnalyticsNow } from "@/lib/server/analytics-erasure";
import { audit } from "@/lib/server/audit";
import { json } from "@/lib/server/http";
import { deleteAccount } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";
import { clearSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = apiRoute(
  async ({ request, user }) => {
    if (user) {
      const distinctId = analytics.distinctIdFor(user.id);
      await deleteAccount(user.id, distinctId);
      audit("account_deleted", { userId: user.id, headers: request.headers });
      abortChats({ userId: user.id });
      if (distinctId) await eraseAnalyticsNow(distinctId);
    }
    await clearSessionCookie();
    return json({ ok: true });
  },
  { session: "optional", requireTerms: false },
);

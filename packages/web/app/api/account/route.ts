import { abortChats } from "@/lib/server/active-chats";
import { eraseAnalyticsNow, queueAnalyticsErasure } from "@/lib/server/analytics-erasure";
import { json } from "@/lib/server/http";
import { deleteAccount } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";
import { clearSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = apiRoute(
  async ({ user }) => {
    if (user) {
      const distinctId = await queueAnalyticsErasure(user.id);
      await deleteAccount(user.id);
      abortChats({ userId: user.id });
      if (distinctId) await eraseAnalyticsNow(distinctId);
    }
    await clearSessionCookie();
    return json({ ok: true });
  },
  { session: "optional" },
);

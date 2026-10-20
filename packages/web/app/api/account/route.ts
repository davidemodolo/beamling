import { abortChats } from "@/lib/server/active-chats";
import { json } from "@/lib/server/http";
import { deleteAccount } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";
import { clearSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = apiRoute(
  async ({ user }) => {
    if (user) {
      await deleteAccount(user.id);
      abortChats({ userId: user.id });
    }
    await clearSessionCookie();
    return json({ ok: true });
  },
  { session: "optional" },
);

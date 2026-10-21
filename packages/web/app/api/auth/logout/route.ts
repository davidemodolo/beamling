import { audit } from "@/lib/server/audit";
import { json } from "@/lib/server/http";
import { apiRoute } from "@/lib/server/route";
import { revokeAllSessions, revokeCurrentSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `?scope=all` signs out every session of the account, not just this browser. */
export const POST = apiRoute(async ({ request, user }) => {
  if (user && new URL(request.url).searchParams.get("scope") === "all") {
    await revokeAllSessions(user.id);
    audit("sign_out_all", { userId: user.id, headers: request.headers });
  } else await revokeCurrentSession();
  return json({ ok: true });
}, { session: "optional", requireTerms: false });

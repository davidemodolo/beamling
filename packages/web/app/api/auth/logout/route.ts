import { json } from "@/lib/server/http";
import { apiRoute } from "@/lib/server/route";
import { revokeCurrentSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = apiRoute(async () => {
  await revokeCurrentSession();
  return json({ ok: true });
}, { session: "optional" });

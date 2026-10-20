import { json } from "@/lib/server/http";
import { getState } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bootstraps the guest workspace: settings, keys and the first page of conversations. */
export const GET = apiRoute(async ({ user }) => json(await getState(user)), { session: "create" });

import { authorizeInternal, internalAuthResponse } from "@/lib/server/internal-auth";
import { maxConcurrentChats } from "@/lib/server/env";
import { json } from "@/lib/server/http";
import { acceptingNewStreams, activeStreams } from "@/lib/server/repo";
import { APP_VERSION, BUILD_TIME, GIT_COMMIT } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = authorizeInternal(request, "METRICS_SECRET");
  if (auth !== "ok") return internalAuthResponse(auth);
  try {
    const [flag, streams] = await Promise.all([acceptingNewStreams(), activeStreams()]);
    return json({
      ok: true,
      database: "up",
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
      commit: GIT_COMMIT,
      builtAt: BUILD_TIME,
      acceptingNewStreams: flag,
      activeStreams: streams,
      maxConcurrentChats: maxConcurrentChats(),
    });
  } catch {
    return json({ ok: false, database: "down", timestamp: new Date().toISOString() }, { status: 503 });
  }
}

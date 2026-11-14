import { NextResponse } from "next/server";
import { settleCleanup } from "@/lib/server/cleanup";
import { getReadiness } from "@/lib/server/readiness";
import { APP_VERSION, BUILD_TIME, GIT_COMMIT } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Below the watchdog's 30-second probe timeout. */
const CLEANUP_WAIT_MS = 20_000;

export async function GET() {
  const ready = await getReadiness();
  // The probe's request is what gives a due cleanup the CPU to finish (see settleCleanup).
  await settleCleanup(CLEANUP_WAIT_MS);
  return NextResponse.json(
    {
      ok: ready.ok,
      database: ready.database,
      schema: ready.schema,
      kms: ready.kms,
      version: APP_VERSION,
      commit: GIT_COMMIT,
      builtAt: BUILD_TIME,
    },
    { status: ready.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

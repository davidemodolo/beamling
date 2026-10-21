import { NextResponse } from "next/server";
import { getReadiness } from "@/lib/server/readiness";
import { APP_VERSION, BUILD_TIME, GIT_COMMIT } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ready = await getReadiness();
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

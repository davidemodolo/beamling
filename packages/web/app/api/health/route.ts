import { NextResponse } from "next/server";
import { pool } from "@/lib/server/db";
import { APP_VERSION, BUILD_TIME, GIT_COMMIT } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    await pool.query("select 1");
    return NextResponse.json(
      { ok: true, database: "up", version: APP_VERSION, commit: GIT_COMMIT, builtAt: BUILD_TIME },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { ok: false, database: "down", version: APP_VERSION, commit: GIT_COMMIT, builtAt: BUILD_TIME },
      { status: 503, headers: NO_STORE },
    );
  }
}

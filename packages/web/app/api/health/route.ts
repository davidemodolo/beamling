import { NextResponse } from "next/server";
import { pool } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    await pool.query("select 1");
    return NextResponse.json({ ok: true, database: "up" }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, database: "down" }, { status: 503, headers: NO_STORE });
  }
}

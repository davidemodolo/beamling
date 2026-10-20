import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { getState } from "@/lib/server/repo";
import { getOrCreateUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getOrCreateUser();
    return NextResponse.json(await getState(user));
  } catch (error) {
    return errorResponse(error);
  }
}

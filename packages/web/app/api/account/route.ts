import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assertSameOrigin, errorResponse } from "@/lib/server/http";
import { deleteAccount } from "@/lib/server/repo";
import { getCurrentUser } from "@/lib/server/session";
import { SESSION_COOKIE } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    if (user) await deleteAccount(user.id);
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

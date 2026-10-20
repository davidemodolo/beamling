import { NextResponse } from "next/server";
import { assertSameOrigin, errorResponse } from "@/lib/server/http";
import { deleteCredential } from "@/lib/server/repo";
import { getOrCreateUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getOrCreateUser();
    const { id } = await context.params;
    const deleted = await deleteCredential(user.id, id);
    if (!deleted) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Credential not found." } }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

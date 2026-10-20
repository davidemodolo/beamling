import { NextResponse } from "next/server";
import { assertSameOrigin, errorResponse, idParam, notFound } from "@/lib/server/http";
import { deleteCredential } from "@/lib/server/repo";
import { requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const deleted = await deleteCredential(user.id, await idParam(context));
    if (!deleted) throw notFound("Credential not found.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

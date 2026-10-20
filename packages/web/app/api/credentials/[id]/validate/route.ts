import { NextResponse } from "next/server";
import { decryptCredential } from "@/lib/server/crypto";
import { ApiError, assertSameOrigin, errorResponse } from "@/lib/server/http";
import { validateProviderKey } from "@/lib/server/providers";
import { getCredentialById, updateCredentialValidation } from "@/lib/server/repo";
import { getOrCreateUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getOrCreateUser();
    const { id } = await context.params;
    const row = await getCredentialById(user.id, id);
    if (!row) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Credential not found." } }, { status: 404 });
    }
    const key = decryptCredential(user.id, row);
    try {
      await validateProviderKey(row.provider === "brave" ? "brave" : "openrouter", key);
      const credential = await updateCredentialValidation(user.id, id, "active");
      return NextResponse.json({ credential });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "INVALID_KEY";
      const status = code === "PROVIDER_RATE_LIMITED" ? "rate_limited" : "invalid";
      await updateCredentialValidation(user.id, id, status);
      if (error instanceof ApiError) throw error;
      throw new ApiError("INVALID_KEY", "The provider rejected this key.", 400, row.provider);
    }
  } catch (error) {
    return errorResponse(error);
  }
}

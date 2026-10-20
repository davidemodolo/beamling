import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedModel } from "@/lib/providers";
import { ApiError, assertSameOrigin, errorResponse, parseBody } from "@/lib/server/http";
import { updateSettings } from "@/lib/server/repo";
import { getOrCreateUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  llmModel: z.string().optional(),
  defaultMode: z.enum(["quick", "deep"]).optional(),
});

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getOrCreateUser();
    const patch = await parseBody(request, schema);
    if (patch.llmModel && !isAllowedModel(patch.llmModel)) {
      throw new ApiError("MODEL_NOT_ALLOWED", "That model is not in the Alpha 1 allowlist.", 400);
    }
    return NextResponse.json({ settings: await updateSettings(user.id, patch) });
  } catch (error) {
    return errorResponse(error);
  }
}

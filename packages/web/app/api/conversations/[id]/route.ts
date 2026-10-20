import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, errorResponse, parseBody } from "@/lib/server/http";
import { deleteConversation, getConversation, setConversationMode } from "@/lib/server/repo";
import { getOrCreateUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ mode: z.enum(["quick", "deep"]) });

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { id } = await context.params;
    const conversation = await getConversation(user.id, id);
    if (!conversation) throw new ApiError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    return NextResponse.json({ conversation });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await getOrCreateUser();
    const { id } = await context.params;
    const { mode } = await parseBody(request, schema);
    const conversation = await setConversationMode(user.id, id, mode);
    if (!conversation) throw new ApiError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    return NextResponse.json({ conversation });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await getOrCreateUser();
    const { id } = await context.params;
    const deleted = await deleteConversation(user.id, id);
    if (!deleted) throw new ApiError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

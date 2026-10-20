import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, errorResponse, idParam, notFound, parseBody } from "@/lib/server/http";
import { deleteConversation, getConversation, setConversationMode } from "@/lib/server/repo";
import { requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ mode: z.enum(["quick", "deep"]) });

type Context = { params: Promise<{ id: string }> };

const conversationNotFound = () => notFound("Conversation not found.", "CONVERSATION_NOT_FOUND");

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const conversation = await getConversation(user.id, await idParam(context));
    if (!conversation) throw conversationNotFound();
    return NextResponse.json({ conversation });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = await idParam(context);
    const { mode } = await parseBody(request, schema);
    const conversation = await setConversationMode(user.id, id, mode);
    if (!conversation) throw conversationNotFound();
    return NextResponse.json({ conversation });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const deleted = await deleteConversation(user.id, await idParam(context));
    if (!deleted) throw conversationNotFound();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

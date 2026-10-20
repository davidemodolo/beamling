import { NextResponse } from "next/server";
import { z } from "zod";
import { stopChat } from "@/lib/server/active-chats";
import { assertSameOrigin, errorResponse, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ messageId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { messageId } = await parseBody(request, schema);
    return NextResponse.json({ stopped: await stopChat(user.id, messageId) });
  } catch (error) {
    return errorResponse(error);
  }
}

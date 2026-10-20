import { NextResponse } from "next/server";
import { z } from "zod";
import { stopChat } from "@/lib/server/active-chats";
import { assertSameOrigin, errorResponse, parseBody } from "@/lib/server/http";
import { getOrCreateUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ messageId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getOrCreateUser();
    const { messageId } = await parseBody(request, schema);
    return NextResponse.json({ stopped: stopChat(user.id, messageId) });
  } catch (error) {
    return errorResponse(error);
  }
}

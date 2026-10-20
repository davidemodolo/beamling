import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, errorResponse, parseBody } from "@/lib/server/http";
import { consumeRateLimit, createConversation } from "@/lib/server/repo";
import { requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ mode: z.enum(["quick", "deep"]).default("quick") });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { mode } = await parseBody(request, schema);
    await consumeRateLimit(`conversations:${user.id}`, 120, 3600);
    return NextResponse.json({ conversation: await createConversation(user.id, mode) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

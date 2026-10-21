import { z } from "zod";
import { MODES } from "@/lib/contracts";
import { json, parseBody } from "@/lib/server/http";
import { consumeRateLimit, createConversation, listConversationPage } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ mode: z.enum(MODES).default("quick") });

/** The next page of conversation summaries, newest first. */
export const GET = apiRoute(async ({ request, user }) => {
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  return json(await listConversationPage(user.id, cursor));
});

export const POST = apiRoute(async ({ request, user }) => {
  const { mode } = await parseBody(request, schema);
  await consumeRateLimit(`conversations:${user.id}`, 120, 3600);
  const conversation = await createConversation(user.id, mode);
  // The per-account cap is applied when the first question is stored, so an empty row never displaces a conversation.
  return json({ conversation }, { status: 201 });
});

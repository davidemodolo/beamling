import { z } from "zod";
import { json, parseBody } from "@/lib/server/http";
import { consumeRateLimit, createConversation, listConversationPage } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ mode: z.enum(["quick", "deep", "deeper"]).default("quick") });

/** The next page of conversation summaries, newest first. */
export const GET = apiRoute(async ({ request, user }) => {
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  return json(await listConversationPage(user.id, cursor));
});

export const POST = apiRoute(async ({ request, user }) => {
  const { mode } = await parseBody(request, schema);
  await consumeRateLimit(`conversations:${user.id}`, 120, 3600);
  return json({ conversation: await createConversation(user.id, mode) }, { status: 201 });
});

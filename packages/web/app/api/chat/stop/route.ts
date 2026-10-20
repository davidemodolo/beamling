import { z } from "zod";
import { stopChat } from "@/lib/server/active-chats";
import { json, parseBody } from "@/lib/server/http";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ messageId: z.string().uuid() });

export const POST = apiRoute(async ({ request, user }) => {
  const { messageId } = await parseBody(request, schema);
  return json({ stopped: await stopChat(user.id, messageId) });
});

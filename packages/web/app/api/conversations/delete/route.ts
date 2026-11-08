import { z } from "zod";
import { MAX_CONVERSATIONS } from "@/lib/legal";
import { abortChats } from "@/lib/server/active-chats";
import { json, parseBody } from "@/lib/server/http";
import { deleteConversations } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select a chat first.").max(MAX_CONVERSATIONS, "Too many chats selected."),
});

/** Deletes several conversations at once; ids that are not the account's are ignored. */
export const POST = apiRoute(async ({ request, user }) => {
  const { ids } = await parseBody(request, schema);
  const deleted = await deleteConversations(user.id, [...new Set(ids)]);
  // Answers running elsewhere notice the deleted rows on their next stop-flag poll.
  for (const conversationId of deleted) abortChats({ userId: user.id, conversationId });
  return json({ deleted });
});

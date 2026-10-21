import { z } from "zod";
import { MODES } from "@/lib/contracts";
import { abortChats } from "@/lib/server/active-chats";
import { idParam, json, notFound, parseBody } from "@/lib/server/http";
import { deleteConversation, getConversation, updateConversation } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    mode: z.enum(MODES).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((input) => input.mode !== undefined || input.pinned !== undefined, {
    message: "Send a mode or a pinned state.",
  });

type Context = { params: Promise<{ id: string }> };

const conversationNotFound = () => notFound("Conversation not found.", "CONVERSATION_NOT_FOUND");

/** The conversation with its newest page of messages. */
export const GET = apiRoute<Context>(async ({ context, user }) => {
  const conversation = await getConversation(user.id, await idParam(context));
  if (!conversation) throw conversationNotFound();
  return json({ conversation });
});

export const PATCH = apiRoute<Context>(async ({ request, context, user }) => {
  const id = await idParam(context);
  const patch = await parseBody(request, schema);
  const conversation = await updateConversation(user.id, id, patch);
  if (!conversation) throw conversationNotFound();
  return json({ conversation });
});

export const DELETE = apiRoute<Context>(async ({ context, user }) => {
  const id = await idParam(context);
  const deleted = await deleteConversation(user.id, id);
  if (!deleted) throw conversationNotFound();
  // Answers running elsewhere notice the deleted row on their next stop-flag poll.
  abortChats({ userId: user.id, conversationId: id });
  return json({ ok: true });
});

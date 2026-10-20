import { ApiError, idParam, isUuid, json, notFound } from "@/lib/server/http";
import { getEarlierMessages } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** The page of messages before `?before=<messageId>`, oldest first. */
export const GET = apiRoute<Context>(async ({ request, context, user }) => {
  const id = await idParam(context);
  const before = new URL(request.url).searchParams.get("before") ?? "";
  if (!isUuid(before)) throw new ApiError("INVALID_ID", "Invalid message id.", 400);
  const page = await getEarlierMessages(user.id, id, before);
  if (!page) throw notFound("Conversation not found.", "CONVERSATION_NOT_FOUND");
  return json(page);
});

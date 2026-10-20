import { idParam, json, notFound } from "@/lib/server/http";
import { deleteCredential } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = apiRoute<{ params: Promise<{ id: string }> }>(async ({ context, user }) => {
  const deleted = await deleteCredential(user.id, await idParam(context));
  if (!deleted) throw notFound("Credential not found.");
  return json({ ok: true });
});

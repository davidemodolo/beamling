import { z } from "zod";
import { ApiError, idParam, json, notFound, parseBody } from "@/lib/server/http";
import { deleteCredential, getCredentialById, updateCredentialLimits } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  plan: z.enum(["free", "paid"]).optional(),
  expiresOn: z.string().date().optional().nullable(),
  budgetUsd: z.number().positive().max(1_000_000).optional().nullable(),
  budgetPeriod: z.enum(["month", "total"]).optional().nullable(),
});

export const PATCH = apiRoute<{ params: Promise<{ id: string }> }>(async ({ request, context, user }) => {
  const id = await idParam(context);
  const existing = await getCredentialById(user.id, id);
  if (!existing) throw notFound("Credential not found.");
  const input = await parseBody(request, schema);
  if (existing.provider !== "brave" && (input.plan !== undefined || input.expiresOn !== undefined || input.budgetUsd !== undefined)) {
    throw new ApiError("INVALID_PROVIDER", "Plan and limits apply only to Brave Search keys.", 400);
  }
  if (input.expiresOn) {
    const expiry = new Date(`${input.expiresOn}T23:59:59Z`);
    if (expiry.getTime() <= Date.now()) {
      throw new ApiError("INVALID_INPUT", "The expiry date must be in the future.", 400);
    }
  }
  const credential = await updateCredentialLimits(user.id, id, {
    plan: input.plan ?? (existing.plan as "free" | "paid" | null) ?? null,
    expiresOn: input.expiresOn !== undefined ? input.expiresOn : existing.expiresOn,
    budgetUsd: input.budgetUsd !== undefined ? input.budgetUsd : existing.budgetUsd == null ? null : Number(existing.budgetUsd),
    budgetPeriod: input.budgetPeriod !== undefined ? input.budgetPeriod : (existing.budgetPeriod as "month" | "total" | null),
  });
  if (!credential) throw notFound("Credential not found.");
  return json({ credential });
});

export const DELETE = apiRoute<{ params: Promise<{ id: string }> }>(async ({ context, user }) => {
  const deleted = await deleteCredential(user.id, await idParam(context));
  if (!deleted) throw notFound("Credential not found.");
  return json({ ok: true });
});

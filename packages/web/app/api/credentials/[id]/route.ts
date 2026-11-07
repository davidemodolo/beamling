import { z } from "zod";
import { BUDGET_PERIODS, BRAVE_PLANS, isCredentialProvider } from "@/lib/contracts";
import { PROVIDERS } from "@/lib/provider-catalog";
import { ApiError, idParam, json, notFound, parseBody } from "@/lib/server/http";
import { deleteCredential, getCredentialById, updateCredentialLimits } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";
import { audit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  plan: z.enum(BRAVE_PLANS).optional(),
  expiresOn: z.string().date().optional().nullable(),
  budgetUsd: z.number().positive().max(1_000_000).optional().nullable(),
  budgetPeriod: z.enum(BUDGET_PERIODS).optional().nullable(),
});

export const PATCH = apiRoute<{ params: Promise<{ id: string }> }>(async ({ request, context, user }) => {
  const id = await idParam(context);
  const existing = await getCredentialById(user.id, id);
  if (!existing) throw notFound("Credential not found.");
  const input = await parseBody(request, schema);
  if (
    !(isCredentialProvider(existing.provider) && PROVIDERS[existing.provider].keyLimits) &&
    (input.plan !== undefined ||
      input.expiresOn !== undefined ||
      input.budgetUsd !== undefined ||
      input.budgetPeriod !== undefined)
  ) {
    throw new ApiError("INVALID_PROVIDER", "Plan and limits do not apply to this key.", 400);
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

export const DELETE = apiRoute<{ params: Promise<{ id: string }> }>(async ({ request, context, user }) => {
  const id = await idParam(context);
  const deleted = await deleteCredential(user.id, id);
  if (!deleted) throw notFound("Credential not found.");
  audit("credential_deleted", { userId: user.id, headers: request.headers, fields: { credentialId: id } });
  return json({ ok: true });
});

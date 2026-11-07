import { z } from "zod";
import { BRAVE_PLANS, CREDENTIAL_PROVIDER_IDS, credentialKind } from "@/lib/contracts";
import { PROVIDERS } from "@/lib/provider-catalog";
import { analytics } from "@/lib/server/analytics";
import { audit } from "@/lib/server/audit";
import { encryptCredential } from "@/lib/server/crypto";
import { ApiError, json, parseBody } from "@/lib/server/http";
import { validateProviderKey } from "@/lib/server/providers";
import { credentialStatusFor } from "@/lib/server/providers/errors";
import { consumeRateLimit, consumeValidation, getCredentialRow, saveCredential } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    provider: z.enum(CREDENTIAL_PROVIDER_IDS),
    key: z.string().trim().min(8).max(600),
    plan: z.enum(BRAVE_PLANS).optional(),
    expiresOn: z.string().date().optional().nullable(),
    budgetUsd: z.number().positive().max(1_000_000).optional().nullable(),
    // false saves the key as unverified without calling the provider, for providers whose only
    // check is a billable request. The key is checked later with the validate endpoint.
    validate: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const info = PROVIDERS[value.provider];
    if (info.keyLimits && !value.plan) {
      ctx.addIssue({ code: "custom", path: ["plan"], message: `Choose the ${info.name} plan for this key.` });
    }
    if (!info.keyLimits && (value.plan !== undefined || value.expiresOn !== undefined || value.budgetUsd !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["provider"], message: `Plan and limits do not apply to ${info.name} keys.` });
    }
    if (value.validate === false && info.freeValidation) {
      ctx.addIssue({ code: "custom", path: ["validate"], message: `${info.name} keys are always checked; the check is free.` });
    }
    if (value.expiresOn) {
      const expiry = new Date(`${value.expiresOn}T23:59:59Z`);
      if (expiry.getTime() <= Date.now()) {
        ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "The expiry date must be in the future." });
      }
    }
  });

export const POST = apiRoute(async ({ request, user }) => {
  const input = await parseBody(request, schema);
  await consumeRateLimit(`credentials:${user.id}`, 20, 3600);
  if (input.validate !== false) await consumeValidation(user.id, request.headers);
  const kind = credentialKind(input.provider);

  const validate = input.validate !== false;
  try {
    if (validate) await validateProviderKey(input.provider, input.key, input.plan);
  } catch (error) {
    const status = credentialStatusFor(error);
    if (status && error instanceof ApiError) {
      analytics.capture(user.id, "credential_validation_failed", {
        kind,
        provider: input.provider,
        error_code: error.code,
      });
    }
    throw error;
  }

  const existing = await getCredentialRow(user.id, kind, input.provider);
  // Encrypt first, then update the existing row in place. A KMS/DB failure leaves the old credential
  // and its usage history intact, and concurrent replacements cannot rewrite the primary key.
  const encrypted = await encryptCredential(user.id, kind, input.provider, input.key, existing?.id);
  const credential = await saveCredential({
    userId: user.id,
    kind,
    provider: input.provider,
    encrypted,
    status: validate ? "active" : "unverified",
    // The schema requires a plan for providers with key limits and rejects it for the rest.
    plan: input.plan ?? null,
    expiresOn: input.expiresOn ?? null,
    budgetUsd: input.budgetUsd ?? null,
    preserveUsage: Boolean(existing),
  });
  audit("credential_saved", {
    userId: user.id,
    headers: request.headers,
    fields: { credentialId: credential.id, provider: credential.provider, replaced: Boolean(existing) },
  });
  analytics.capture(user.id, "credential_added", {
    kind: credential.kind,
    provider: credential.provider,
    status: credential.status,
  });
  return json({ credential }, { status: 201 });
});

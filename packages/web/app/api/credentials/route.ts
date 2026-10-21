import { z } from "zod";
import { BUDGET_PERIODS, BRAVE_PLANS, CREDENTIAL_KINDS, CREDENTIAL_PROVIDER_IDS } from "@/lib/contracts";
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
    kind: z.enum(CREDENTIAL_KINDS),
    provider: z.enum(CREDENTIAL_PROVIDER_IDS),
    key: z.string().trim().min(8).max(600),
    plan: z.enum(BRAVE_PLANS).optional(),
    expiresOn: z.string().date().optional().nullable(),
    budgetUsd: z.number().positive().max(1_000_000).optional().nullable(),
    budgetPeriod: z.enum(BUDGET_PERIODS).optional().nullable(),
    // false saves the key as unverified without calling the provider, for providers whose only
    // check is a billable search (Brave, Exa). The key is checked later with the validate endpoint.
    validate: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.provider === "brave" && !value.plan) {
      ctx.addIssue({ code: "custom", path: ["plan"], message: "Choose the Brave plan for this key." });
    }
    if (
      value.provider !== "brave" &&
      (value.plan !== undefined ||
        value.expiresOn !== undefined ||
        value.budgetUsd !== undefined ||
        value.budgetPeriod !== undefined)
    ) {
      ctx.addIssue({ code: "custom", path: ["provider"], message: "Plan and limits apply only to Brave Search keys." });
    }
    if (value.validate === false && value.provider !== "brave" && value.provider !== "exa") {
      ctx.addIssue({ code: "custom", path: ["validate"], message: "Only Brave and Exa keys can be saved without a check." });
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
  if ((input.kind === "llm") !== (input.provider === "openrouter")) {
    throw new ApiError("INVALID_PROVIDER", "Provider does not match credential kind.", 400);
  }

  const validate = input.validate !== false;
  try {
    if (validate) await validateProviderKey(input.provider, input.key, input.plan ?? "free");
  } catch (error) {
    const status = credentialStatusFor(error);
    if (status && error instanceof ApiError) {
      analytics.capture(user.id, "credential_validation_failed", {
        kind: input.kind,
        provider: input.provider,
        error_code: error.code,
      });
    }
    throw error;
  }

  const existing = await getCredentialRow(user.id, input.kind, input.provider);
  // Encrypt first, then update the existing row in place. A KMS/DB failure leaves the old credential
  // and its usage history intact, and concurrent replacements cannot rewrite the primary key.
  const encrypted = await encryptCredential(user.id, input.kind, input.provider, input.key, existing?.id);
  const credential = await saveCredential({
    userId: user.id,
    kind: input.kind,
    provider: input.provider,
    encrypted,
    status: validate ? "active" : "unverified",
    plan: input.provider === "brave" ? (input.plan ?? "free") : null,
    expiresOn: input.expiresOn ?? null,
    budgetUsd: input.budgetUsd ?? null,
    budgetPeriod: input.budgetPeriod ?? (input.budgetUsd == null ? null : "month"),
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

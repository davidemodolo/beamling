import { createHash } from "node:crypto";
import { z } from "zod";
import { encryptCredential } from "@/lib/server/crypto";
import { ApiError, json, parseBody } from "@/lib/server/http";
import { validateProviderKey } from "@/lib/server/providers";
import { consumeRateLimit, deleteCredential, getCredentialRow, saveCredential } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    kind: z.enum(["llm", "search"]),
    provider: z.enum(["openrouter", "brave", "tavily", "exa"]),
    key: z.string().trim().min(8).max(600),
    plan: z.enum(["free", "paid"]).optional(),
    expiresOn: z.string().date().optional().nullable(),
    budgetUsd: z.number().positive().max(1_000_000).optional().nullable(),
    budgetPeriod: z.enum(["month", "total"]).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.provider === "brave" && !value.plan) {
      ctx.addIssue({ code: "custom", path: ["plan"], message: "Choose the Brave plan for this key." });
    }
    if (value.expiresOn) {
      const expiry = new Date(`${value.expiresOn}T23:59:59Z`);
      if (expiry.getTime() <= Date.now()) {
        ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "The expiry date must be in the future." });
      }
    }
  });

function fingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export const POST = apiRoute(async ({ request, user }) => {
  const input = await parseBody(request, schema);
  await consumeRateLimit(`credentials:${user.id}`, 20, 3600);
  if ((input.kind === "llm") !== (input.provider === "openrouter")) {
    throw new ApiError("INVALID_PROVIDER", "Provider does not match credential kind.", 400);
  }

  await validateProviderKey(input.provider, input.key, input.plan ?? "free");

  const existing = await getCredentialRow(user.id, input.kind, input.provider);
  const sameKey = existing?.fingerprint === fingerprint(input.key);
  if (existing && !sameKey) await deleteCredential(user.id, existing.id);

  const credential = await saveCredential({
    userId: user.id,
    kind: input.kind,
    provider: input.provider,
    encrypted: await encryptCredential(
      user.id,
      input.kind,
      input.provider,
      input.key,
      sameKey ? existing?.id : undefined,
    ),
    status: "active",
    plan: input.provider === "brave" ? (input.plan ?? "free") : null,
    expiresOn: input.expiresOn ?? null,
    budgetUsd: input.budgetUsd ?? null,
    budgetPeriod: input.budgetPeriod ?? (input.budgetUsd == null ? null : "month"),
    preserveUsage: sameKey,
  });
  return json({ credential }, { status: 201 });
});

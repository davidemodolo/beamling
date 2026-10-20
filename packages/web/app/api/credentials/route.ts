import { z } from "zod";
import { encryptCredential } from "@/lib/server/crypto";
import { ApiError, json, parseBody } from "@/lib/server/http";
import { validateProviderKey } from "@/lib/server/providers";
import { consumeRateLimit, saveCredential } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.enum(["llm", "search"]),
  provider: z.enum(["openrouter", "brave"]),
  key: z.string().trim().min(8).max(600),
});

export const POST = apiRoute(async ({ request, user }) => {
  const input = await parseBody(request, schema);
  await consumeRateLimit(`credentials:${user.id}`, 20, 3600);
  if ((input.kind === "llm") !== (input.provider === "openrouter")) {
    throw new ApiError("INVALID_PROVIDER", "Provider does not match credential kind.", 400);
  }

  // Provider errors are already mapped: a rejected key, missing credits, or an outage.
  await validateProviderKey(input.provider, input.key);

  // saveCredential replaces any existing key for this provider in one atomic upsert.
  const credential = await saveCredential({
    userId: user.id,
    kind: input.kind,
    provider: input.provider,
    encrypted: encryptCredential(user.id, input.kind, input.provider, input.key),
    status: "active",
  });
  return json({ credential }, { status: 201 });
});

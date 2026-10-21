import { decryptCredential } from "@/lib/server/crypto";
import { ApiError, idParam, json, notFound } from "@/lib/server/http";
import { validateProviderKey } from "@/lib/server/providers";
import { credentialStatusFor } from "@/lib/server/providers/errors";
import { consumeRateLimit, getCredentialById, updateCredentialValidation } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = apiRoute<{ params: Promise<{ id: string }> }>(async ({ context, user }) => {
  const id = await idParam(context);
  await consumeRateLimit(`credentials:${user.id}`, 20, 3600);
  const row = await getCredentialById(user.id, id);
  if (!row) throw notFound("Credential not found.");
  const provider = row.provider === "brave" ? "brave" : "openrouter";

  let key: string;
  try {
    key = await decryptCredential(user.id, row);
  } catch {
    const credential = await updateCredentialValidation(user.id, id, "invalid");
    throw new ApiError("CREDENTIAL_UNREADABLE", "This saved key can no longer be read. Replace it.", 400, provider, {
      credential,
    });
  }

  try {
    await validateProviderKey(provider, key, row.plan === "paid" ? "paid" : "free");
  } catch (error) {
    const status = credentialStatusFor(error);
    // The response carries the stored credential, so the UI shows the status the server recorded.
    const credential = status ? await updateCredentialValidation(user.id, id, status) : null;
    if (error instanceof ApiError) {
      error.extra = { ...error.extra, ...(credential ? { credential } : {}) };
      throw error;
    }
    throw new ApiError("PROVIDER_UNAVAILABLE", "The key could not be checked right now. Try again shortly.", 502, provider);
  }
  return json({ credential: await updateCredentialValidation(user.id, id, "active") });
});

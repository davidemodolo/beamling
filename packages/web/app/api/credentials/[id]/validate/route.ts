import { analytics } from "@/lib/server/analytics";
import { isDecryptIntegrityError } from "@/lib/server/crypto";
import { log, summarizeError } from "@/lib/server/log";
import { ApiError, idParam, json, notFound } from "@/lib/server/http";
import { isSearchProvider } from "@/lib/provider-catalog";
import { validateProviderKey } from "@/lib/server/providers";
import { credentialStatusFor } from "@/lib/server/providers/errors";
import {
  consumeRateLimit,
  consumeValidation,
  getCredentialById,
  readCredentialKey,
  updateCredentialValidation,
} from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = apiRoute<{ params: Promise<{ id: string }> }>(async ({ request, context, user }) => {
  const id = await idParam(context);
  await consumeRateLimit(`credentials:${user.id}`, 20, 3600);
  await consumeValidation(user.id, request.headers);
  const row = await getCredentialById(user.id, id);
  if (!row) throw notFound("Credential not found.");
  const provider = row.kind === "search" && isSearchProvider(row.provider) ? row.provider : "openrouter";

  let key: string;
  try {
    key = await readCredentialKey(user.id, row);
  } catch (error) {
    // A KMS or network outage says nothing about the stored key: leave its status alone.
    if (!isDecryptIntegrityError(error)) {
      log.warn("Credential could not be decrypted", { error: summarizeError(error) });
      throw new ApiError("PROVIDER_UNAVAILABLE", "The key could not be checked right now. Try again shortly.", 503);
    }
    const credential = await updateCredentialValidation(user.id, id, "invalid");
    throw new ApiError("CREDENTIAL_UNREADABLE", "This saved key can no longer be read. Replace it.", 400, provider, {
      credential,
    });
  }

  try {
    await validateProviderKey(provider, key, row.plan === "paid" ? "paid" : "free");
  } catch (error) {
    const status = credentialStatusFor(error);
    if (status && error instanceof ApiError) {
      analytics.capture(user.id, "credential_validation_failed", {
        kind: row.kind === "llm" ? "llm" : "search",
        provider,
        error_code: error.code,
      });
    }
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

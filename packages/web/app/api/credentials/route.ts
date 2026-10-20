import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptCredential } from "@/lib/server/crypto";
import { ApiError, assertSameOrigin, errorResponse, parseBody } from "@/lib/server/http";
import { validateProviderKey } from "@/lib/server/providers";
import { consumeRateLimit, saveCredential } from "@/lib/server/repo";
import { requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.enum(["llm", "search"]),
  provider: z.enum(["openrouter", "brave"]),
  key: z.string().trim().min(8).max(600),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = await parseBody(request, schema);
    await consumeRateLimit(`credentials:${user.id}`, 20, 3600);
    if ((input.kind === "llm") !== (input.provider === "openrouter")) {
      throw new ApiError("INVALID_PROVIDER", "Provider does not match credential kind.", 400);
    }

    try {
      await validateProviderKey(input.provider, input.key);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("INVALID_KEY", `Could not validate the ${input.provider} key.`, 400, input.provider);
    }

    // saveCredential replaces any existing key for this provider in one atomic upsert.
    const encrypted = encryptCredential(user.id, input.kind, input.provider, input.key);
    const credential = await saveCredential({
      userId: user.id,
      id: encrypted.id,
      kind: input.kind,
      provider: input.provider,
      encrypted: {
        wrappedDek: encrypted.wrappedDek,
        dekNonce: encrypted.dekNonce,
        dekTag: encrypted.dekTag,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        tag: encrypted.tag,
        fingerprint: encrypted.fingerprint,
        last4: encrypted.last4,
      },
      status: "active",
    });
    return NextResponse.json({ credential }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

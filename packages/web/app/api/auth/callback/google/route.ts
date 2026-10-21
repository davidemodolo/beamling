import { completeLogin } from "@/lib/server/auth";
import { appUrl } from "@/lib/server/env";
import { ApiError, privateRedirect } from "@/lib/server/http";
import { log, summarizeError } from "@/lib/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { returnTo } = await completeLogin(request.url);
    return privateRedirect(`${appUrl()}${returnTo}`);
  } catch (error) {
    log.warn("Google sign-in failed", {
      error: summarizeError(error),
      code: error instanceof Error && "code" in error ? String(error.code) : undefined,
    });
    const reason = error instanceof ApiError && error.code === "SIGNUPS_PAUSED" ? "signups_paused" : "auth_failed";
    return privateRedirect(`${appUrl()}/login?error=${reason}`);
  }
}

import { completeLogin } from "@/lib/server/auth";
import { appUrl, authCallbacksPerIpPerHour } from "@/lib/server/env";
import { ApiError, clientIpKey, privateRedirect } from "@/lib/server/http";
import { log, summarizeError } from "@/lib/server/log";
import { consumeRateLimit } from "@/lib/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await consumeRateLimit(`auth-callback-ip:${clientIpKey(request.headers)}`, authCallbacksPerIpPerHour(), 3600);
    const { returnTo } = await completeLogin(request.url, clientIpKey(request.headers));
    return privateRedirect(`${appUrl()}${returnTo}`);
  } catch (error) {
    log.warn("Google sign-in failed", {
      error: summarizeError(error),
      code: error instanceof Error && "code" in error ? String(error.code) : undefined,
    });
    const reason =
      error instanceof ApiError && error.code === "SIGNUPS_PAUSED"
        ? "signups_paused"
        : error instanceof ApiError && error.code === "SIGNUP_NOT_INVITED"
          ? "signup_not_invited"
          : "auth_failed";
    return privateRedirect(`${appUrl()}/login?error=${reason}`);
  }
}

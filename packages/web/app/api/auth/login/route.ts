import { beginLogin } from "@/lib/server/auth";
import { appUrl, loginsPerIpPerHour } from "@/lib/server/env";
import { ApiError, clientIpKey, privateRedirect } from "@/lib/server/http";
import { log, summarizeError } from "@/lib/server/log";
import { consumeRateLimit } from "@/lib/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const next = new URL(request.url).searchParams.get("next");
  try {
    await consumeRateLimit(`login-ip:${clientIpKey(request.headers)}`, loginsPerIpPerHour(), 3600);
    return privateRedirect(await beginLogin(next));
  } catch (error) {
    // A sign-in outage must stay a human-readable page, not a JSON API error.
    const reason =
      error instanceof ApiError && error.code === "RATE_LIMITED" ? "login_rate_limited" : "auth_unavailable";
    log.warn("Sign-in could not start", { reason, error: summarizeError(error) });
    return privateRedirect(`${appUrl()}/login?error=${reason}`);
  }
}

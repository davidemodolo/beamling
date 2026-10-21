import { beginLogin } from "@/lib/server/auth";
import { loginsPerIpPerHour } from "@/lib/server/env";
import { clientIpKey, errorResponse, privateRedirect } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await consumeRateLimit(`login-ip:${clientIpKey(request.headers)}`, loginsPerIpPerHour(), 3600);
    const next = new URL(request.url).searchParams.get("next");
    return privateRedirect(await beginLogin(next));
  } catch (error) {
    return errorResponse(error);
  }
}

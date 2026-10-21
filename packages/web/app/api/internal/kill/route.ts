import { z } from "zod";
import { authorizeInternal, internalAuthResponse } from "@/lib/server/internal-auth";
import { cleanText, errorResponse, json, parseBody } from "@/lib/server/http";
import { log } from "@/lib/server/log";
import { setAcceptingNewStreams } from "@/lib/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  acceptingNewStreams: z.boolean(),
  reason: z.string().transform(cleanText).pipe(z.string().trim().max(200)).optional(),
});

export async function POST(request: Request) {
  const auth = authorizeInternal(request, "KILL_SWITCH_SECRET");
  if (auth !== "ok") return internalAuthResponse(auth);
  try {
    const input = await parseBody(request, schema);
    const flag = await setAcceptingNewStreams(input.acceptingNewStreams, input.reason);
    log.info("New-stream flag changed", {
      enabled: flag.enabled,
      reason: flag.reason ?? undefined,
    });
    return json({ acceptingNewStreams: flag });
  } catch (error) {
    return errorResponse(error);
  }
}

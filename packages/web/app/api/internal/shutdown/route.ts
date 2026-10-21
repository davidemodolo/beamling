import { z } from "zod";
import { SHUTDOWN_NOTICE_DAYS } from "@/lib/legal";
import { audit } from "@/lib/server/audit";
import { mailConfigured } from "@/lib/server/env";
import { ApiError, cleanText, errorResponse, json, parseBody } from "@/lib/server/http";
import { authorizeInternal, internalAuthResponse } from "@/lib/server/internal-auth";
import { log } from "@/lib/server/log";
import { cancelShutdown, getShutdown, scheduleShutdown, shutdownProgress } from "@/lib/server/repo";
import { processShutdown } from "@/lib/server/shutdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("schedule"),
    // Notice period before every account is deleted; never shorter than the promised minimum.
    days: z.number().int().min(SHUTDOWN_NOTICE_DAYS).max(365).default(SHUTDOWN_NOTICE_DAYS),
    reason: z.string().transform(cleanText).pipe(z.string().trim().max(1000)).optional(),
    // false schedules without email, for a deployment that cannot send mail. Users still see the banner.
    notify: z.boolean().default(true),
  }),
  z.object({ action: z.literal("cancel") }),
]);

async function status() {
  const shutdown = await getShutdown();
  return {
    shutdown: shutdown
      ? { scheduledAt: shutdown.scheduledAt.toISOString(), reason: shutdown.reason, notify: shutdown.notify }
      : null,
    mailConfigured: mailConfigured(),
    ...(await shutdownProgress()),
  };
}

/** Operator view of a scheduled shutdown and how many accounts have been notified. */
export async function GET(request: Request) {
  const auth = authorizeInternal(request, "KILL_SWITCH_SECRET");
  if (auth !== "ok") return internalAuthResponse(auth);
  try {
    return json(await status());
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Schedules or cancels the end of the service. Scheduling emails every account, shows a banner,
 * stops new sign-ups and, on the date, deletes every account with all its data.
 */
export async function POST(request: Request) {
  const auth = authorizeInternal(request, "KILL_SWITCH_SECRET");
  if (auth !== "ok") return internalAuthResponse(auth);
  try {
    const input = await parseBody(request, schema);
    if (input.action === "cancel") {
      await cancelShutdown();
      audit("shutdown_cancelled", { headers: request.headers });
      log.warn("Service shutdown cancelled");
      return json(await status());
    }
    if (input.notify && !mailConfigured()) {
      throw new ApiError(
        "MAIL_NOT_CONFIGURED",
        "Set SMTP_URL and MAIL_FROM to email the notice, or send notify: false to schedule without email.",
        409,
      );
    }
    const scheduledAt = new Date(Date.now() + input.days * 86_400_000);
    await scheduleShutdown(scheduledAt, input.reason ?? null, input.notify);
    audit("shutdown_scheduled", { headers: request.headers, fields: { scheduledAt: scheduledAt.toISOString() } });
    log.warn("Service shutdown scheduled", { scheduledAt: scheduledAt.toISOString(), notify: input.notify });
    // Start sending now; the cleanup job resumes anything left after a restart.
    if (input.notify) void processShutdown().catch((error) => log.error("Shutdown run failed", error));
    return json(await status());
  } catch (error) {
    return errorResponse(error);
  }
}

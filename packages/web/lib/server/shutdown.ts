import { legalDetails } from "../legal";
import { ALL_PROVIDERS } from "../provider-catalog";
import { orList } from "../utils";
import { analytics } from "./analytics";
import { audit } from "./audit";
import { appUrl, mailConfigured } from "./env";
import { log, summarizeError } from "./log";
import { sendMail } from "./mail";
import {
  accountsToRetire,
  deleteAccount,
  getShutdown,
  markShutdownNotified,
  shutdownRecipients,
  withShutdownLock,
  type Shutdown,
} from "./repo";

/** Notices sent per batch, with a pause between messages so a shared SMTP relay is not flooded. */
const NOTICE_BATCH = 50;
const NOTICE_SPACING_MS = 250;
const DELETE_BATCH = 50;

let running: Promise<void> | undefined;

/** The closing date as people read it, in the operator's time zone with its abbreviation (CET/CEST). */
export function shutdownDateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
    timeZoneName: "short",
  }).format(date);
}

export function shutdownNotice(shutdown: Shutdown): { subject: string; text: string } {
  const legal = legalDetails();
  const url = appUrl();
  const date = shutdownDateLabel(shutdown.scheduledAt);
  const contact = legal.contactEmail || `${url}/contact`;
  const text = [
    "Hello,",
    "",
    `Beamling (${url}) will shut down on ${date}. Thank you for using it.`,
    "",
    `On that date every account is permanently deleted with all its data: conversations, sources, saved provider keys and settings. Your ${orList(ALL_PROVIDERS.map((provider) => provider.shortName))} accounts are not affected; you may want to revoke the keys you saved in Beamling from their dashboards.`,
    "",
    "To keep your conversations, download them before then: sign in, open Settings → Account and choose \"Download my data\".",
    ...(shutdown.reason ? ["", shutdown.reason] : []),
    "",
    `This is a one-off service notice sent to every Beamling account. Questions: ${contact}`,
    legal.entity,
  ].join("\n");
  return { subject: `Beamling is shutting down on ${date}`, text };
}

async function sendNotices(shutdown: Shutdown): Promise<void> {
  if (!shutdown.notify || !mailConfigured()) return;
  const notice = shutdownNotice(shutdown);
  for (;;) {
    const batch = await shutdownRecipients(NOTICE_BATCH);
    if (!batch.length) return;
    for (const recipient of batch) {
      try {
        await sendMail({ to: recipient.email, ...notice });
        await markShutdownNotified(recipient.id);
      } catch (error) {
        // Stop the run: the next cleanup tick retries everyone not marked yet.
        log.error("Shutdown notice could not be sent", undefined, { error: summarizeError(error) });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, NOTICE_SPACING_MS));
    }
  }
}

/** Deletes every account, through the same path as a user's own deletion. */
async function retireAll(): Promise<void> {
  let deleted = 0;
  for (;;) {
    const ids = await accountsToRetire(DELETE_BATCH);
    if (!ids.length) break;
    for (const id of ids) {
      await deleteAccount(id, analytics.distinctIdFor(id));
      audit("shutdown_account_deleted", { userId: id });
      deleted += 1;
    }
  }
  if (deleted) log.warn("Service shutdown deleted accounts", { deleted });
}

/**
 * Advances a scheduled shutdown: before the date it emails the notice to every account not yet
 * notified; from the date on it deletes every account. Runs from the cleanup job and right after
 * the operator schedules it; one run at a time across instances, and both steps are idempotent.
 */
export function processShutdown(): Promise<void> {
  running ??= (async () => {
    if (!(await getShutdown())) return;
    await withShutdownLock(async () => {
      // Read again under the lock: another instance may have cancelled or rescheduled meanwhile.
      const shutdown = await getShutdown();
      if (!shutdown) return;
      if (shutdown.scheduledAt.getTime() > Date.now()) await sendNotices(shutdown);
      else await retireAll();
    });
  })().finally(() => {
    running = undefined;
  });
  return running;
}

/** True once the closing date has passed: sign-in and sign-up are refused. */
export function isClosed(shutdown: Shutdown | null): boolean {
  return Boolean(shutdown && shutdown.scheduledAt.getTime() <= Date.now());
}

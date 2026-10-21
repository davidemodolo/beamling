import { createTransport, type Transporter } from "nodemailer";
import { mailFrom, smtpUrl } from "./env";

let transport: Pick<Transporter, "sendMail"> | undefined;

/** Replaces the SMTP transport, e.g. with a capturing one in tests. `undefined` restores SMTP_URL. */
export function setMailTransport(next: Pick<Transporter, "sendMail"> | undefined): void {
  transport = next;
}

/** smtps:// is TLS from the first byte; smtp:// must upgrade with STARTTLS or the message is not sent. */
function transportOptions(url: string) {
  const parsed = new URL(url);
  const secure = parsed.protocol === "smtps:";
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || (secure ? 465 : 587),
    secure,
    requireTLS: !secure,
    auth: parsed.username
      ? { user: decodeURIComponent(parsed.username), pass: decodeURIComponent(parsed.password) }
      : undefined,
    connectionTimeout: 15_000,
  };
}

/**
 * Sends one plain-text service notice. Beamling sends no other email: no newsletters, no tracking
 * pixels, no links other than its own pages.
 */
export async function sendMail(message: { to: string; subject: string; text: string }): Promise<void> {
  const url = smtpUrl();
  const from = mailFrom();
  if (!url || !from) throw new Error("SMTP_URL and MAIL_FROM are required to send email.");
  transport ??= createTransport(transportOptions(url));
  await transport.sendMail({ from, ...message });
}

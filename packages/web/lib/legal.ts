export interface LegalDetails {
  entity: string;
  address: string | undefined;
  /** VAT number or other company registration, when the operator is a business. */
  vatId: string | undefined;
  contactEmail: string;
  governingLaw: string;
  /** Name and location of the SMTP provider that delivers service notices, e.g. "Brevo (France)". */
  mailProvider: string | undefined;
  /** How long the hosting provider keeps application logs, in days. */
  logRetentionDays: number;
  /** How long database backups and point-in-time recovery history are kept, in days. */
  backupRetentionDays: number;
}

function days(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Public operator details. Production requires entity and contact email at boot; address only with a VAT ID. */
export function legalDetails(): LegalDetails {
  return {
    entity: process.env.LEGAL_ENTITY?.trim() || "the Beamling operator",
    address: process.env.LEGAL_ADDRESS?.trim() || undefined,
    vatId: process.env.LEGAL_VAT_ID?.trim() || undefined,
    contactEmail: process.env.LEGAL_CONTACT_EMAIL?.trim() || "",
    governingLaw: process.env.LEGAL_GOVERNING_LAW?.trim() || "Italian law",
    mailProvider: process.env.LEGAL_MAIL_PROVIDER?.trim() || undefined,
    logRetentionDays: days("LEGAL_LOG_RETENTION_DAYS", 30),
    backupRetentionDays: days("LEGAL_BACKUP_RETENTION_DAYS", 7),
  };
}

/**
 * Version of the terms and privacy notice an account must accept. Change it (and the date) whenever
 * either document changes materially; every account is asked to accept again on its next visit.
 */
export const LEGAL_VERSION = "2026-11-14";
export const LEGAL_LAST_UPDATED = "14 November 2026";

/** Minimum age to hold an account. */
export const MINIMUM_AGE = 18;

/** A conversation is deleted this many days after its last activity (new question or mode change). */
export const CONVERSATION_RETENTION_DAYS = 60;

/** Conversations kept per account; creating one more deletes the oldest, unpinned ones first. */
export const MAX_CONVERSATIONS = 100;

/** Questions per conversation; the next one must start a new chat. */
export const MAX_QUESTIONS_PER_CONVERSATION = 100;

/** Encrypted storage per account (chats, answers, sources). New questions are refused at the limit. */
export const STORAGE_LIMIT_MB = 10;
export const STORAGE_LIMIT_BYTES = STORAGE_LIMIT_MB * 1024 * 1024;

/** From this share of the storage limit the limits page warns. */
export const STORAGE_WARNING_RATIO = 0.8;

/** Questions per account. */
export const QUESTIONS_PER_HOUR = 60;
export const QUESTIONS_PER_DAY = 500;

/** Characters per question. */
export const MAX_QUESTION_CHARS = 4000;

/** From this many conversations the sidebar warns that the oldest will be deleted. */
export const CONVERSATION_WARNING_THRESHOLD = 90;

/** Minimum notice, in days, before a scheduled shutdown deletes every account. */
export const SHUTDOWN_NOTICE_DAYS = 14;

/** Accounts with no sign-in or session use for this long are deleted with all their data. */
export const INACTIVE_ACCOUNT_MONTHS = 24;

/** Accounts that never accepted the terms are deleted after this many days. */
export const UNACCEPTED_ACCOUNT_DAYS = 7;

export const SOURCE_URL = "https://github.com/davidemodolo/beamling";

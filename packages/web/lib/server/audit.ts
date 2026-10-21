import { hmacToken } from "./crypto";
import { clientIpKey } from "./http";
import { log } from "./log";

export type AuditEvent =
  | "sign_in"
  | "sign_out_all"
  | "terms_accepted"
  | "credential_saved"
  | "credential_deleted"
  | "data_exported"
  | "analytics_opt_out"
  | "analytics_opt_in"
  | "account_deleted"
  | "inactive_account_deleted"
  | "shutdown_account_deleted"
  | "shutdown_scheduled"
  | "shutdown_cancelled"
  | "internal_auth_failed";

/**
 * Security audit trail in the structured log: who (keyed hash of the account), from where (keyed
 * hash of the client IP) and what. Never pass content, keys or email addresses as fields.
 */
export function audit(
  event: AuditEvent,
  input: {
    userId?: string;
    headers?: Headers;
    /** An IP hash already computed with clientIpKey, when the headers are not at hand. */
    ipKey?: string;
    fields?: Record<string, string | number | boolean>;
  },
): void {
  log.info("audit", {
    event,
    ...input.fields,
    userId: input.userId ? hmacToken(input.userId) : undefined,
    ip: input.ipKey ?? (input.headers ? clientIpKey(input.headers) : undefined),
  });
}

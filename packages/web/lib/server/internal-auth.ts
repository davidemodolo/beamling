import { createHash, timingSafeEqual } from "node:crypto";
import { audit } from "./audit";
import { internalSecret } from "./env";
import { json } from "./http";

export type InternalAuth = "ok" | "unauthorized" | "disabled";

/** Bearer-token check for operator endpoints. A short or missing secret disables the endpoint. */
export function authorizeInternal(request: Request, name: "KILL_SWITCH_SECRET" | "METRICS_SECRET"): InternalAuth {
  const expected = internalSecret(name);
  if (!expected) return "disabled";
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  // Comparing fixed-length digests keeps the comparison constant-time without revealing the secret's length.
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  if (provided && timingSafeEqual(digest(provided), digest(expected))) return "ok";
  audit("internal_auth_failed", { headers: request.headers, fields: { endpoint: name } });
  return "unauthorized";
}

export function internalAuthResponse(auth: Exclude<InternalAuth, "ok">): Response {
  if (auth === "disabled") {
    return json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  return json(
    { error: { code: "UNAUTHORIZED", message: "Unauthorized." } },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}

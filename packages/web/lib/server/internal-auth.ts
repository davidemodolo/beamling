import { timingSafeEqual } from "node:crypto";
import { internalSecret } from "./env";
import { json } from "./http";

export type InternalAuth = "ok" | "unauthorized" | "disabled";

/** Bearer-token check for operator endpoints. A short or missing secret disables the endpoint. */
export function authorizeInternal(request: Request, name: "KILL_SWITCH_SECRET" | "METRICS_SECRET"): InternalAuth {
  const expected = internalSecret(name);
  if (!expected) return "disabled";
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!provided) return "unauthorized";
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right) ? "ok" : "unauthorized";
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

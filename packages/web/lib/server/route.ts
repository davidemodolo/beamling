import { randomUUID } from "node:crypto";
import { LEGAL_VERSION } from "../legal";
import { hmacToken } from "./crypto";
import { ApiError, assertSameOrigin, clientIpKey, errorResponse, PRIVATE_HEADERS } from "./http";
import { log } from "./log";
import { consumeRateLimit } from "./repo";
import { getCurrentUser, requireUser, type SessionUser } from "./session";

type SessionMode = "required" | "optional";

interface RouteOptions<S extends SessionMode> {
  /** "optional" lets the handler run without a session, e.g. sign-out. */
  session?: S;
  /**
   * false lets an account that has not accepted the current terms call the route: reading and
   * accepting the terms, exporting data, signing out and deleting the account.
   */
  requireTerms?: boolean;
}

type RouteUser<S extends SessionMode> = S extends "optional" ? SessionUser | null : SessionUser;

interface RouteInput<P, S extends SessionMode> {
  request: Request;
  context: P;
  user: RouteUser<S>;
}

/** Reads per user (and, for many workspaces behind one address, per IP) and window. */
const READS_PER_WINDOW = 600;
const READS_PER_IP_WINDOW = 3000;
const READ_WINDOW_SECONDS = 600;
/** Writes per user and window, across every mutation route; routes add tighter limits of their own. */
const WRITES_PER_WINDOW = 300;
const WRITE_WINDOW_SECONDS = 600;

const loaders: Record<SessionMode, () => Promise<SessionUser | null>> = {
  required: requireUser,
  optional: getCurrentUser,
};

/**
 * Wraps a route handler with the checks every API route needs: same-origin for mutations, the
 * session, acceptance of the current terms, per-user read and write limits, private cache headers
 * and the stable error shape.
 */
export function apiRoute<P = unknown, S extends SessionMode = "required">(
  handler: (input: RouteInput<P, S>) => Promise<Response>,
  options: RouteOptions<S> = {},
): (request: Request, context: P) => Promise<Response> {
  const session = options.session ?? "required";
  const requireTerms = options.requireTerms ?? true;
  return async (request, context) => {
    const requestId = randomUUID();
    const started = Date.now();
    let user: SessionUser | null = null;
    let status = 500;
    try {
      const isRead = request.method === "GET" || request.method === "HEAD";
      if (!isRead) assertSameOrigin(request);
      user = await loaders[session]();
      if (user && requireTerms && user.termsVersion !== LEGAL_VERSION) {
        throw new ApiError("TERMS_REQUIRED", "Accept the updated terms and privacy notice to continue.", 403);
      }
      if (user && isRead) {
        await consumeRateLimit(`reads:${user.id}`, READS_PER_WINDOW, READ_WINDOW_SECONDS);
        await consumeRateLimit(`reads-ip:${clientIpKey(request.headers)}`, READS_PER_IP_WINDOW, READ_WINDOW_SECONDS);
      } else if (user) {
        await consumeRateLimit(`writes:${user.id}`, WRITES_PER_WINDOW, WRITE_WINDOW_SECONDS);
      }
      const response = await handler({ request, context, user: user as RouteUser<S> });
      status = response.status;
      for (const [name, value] of Object.entries(PRIVATE_HEADERS)) {
        if (!response.headers.has(name)) response.headers.set(name, value);
      }
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      const response = errorResponse(error, requestId);
      status = response.status;
      return response;
    } finally {
      log.info("request", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        durationMs: Date.now() - started,
        userId: user ? hmacToken(user.id) : undefined,
      });
    }
  };
}

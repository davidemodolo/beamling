import { randomUUID } from "node:crypto";
import { hmacToken } from "./crypto";
import { assertSameOrigin, clientIpKey, errorResponse, PRIVATE_HEADERS } from "./http";
import { log } from "./log";
import { consumeRateLimit } from "./repo";
import { getCurrentUser, requireUser, type SessionUser } from "./session";

type SessionMode = "required" | "optional";

interface RouteOptions<S extends SessionMode> {
  /** "optional" lets the handler run without a session, e.g. sign-out. */
  session?: S;
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

const loaders: Record<SessionMode, () => Promise<SessionUser | null>> = {
  required: requireUser,
  optional: getCurrentUser,
};

/**
 * Wraps a route handler with the checks every API route needs: same-origin for mutations, the
 * session, a per-user read limit for GETs, private cache headers and the stable error shape.
 */
export function apiRoute<P = unknown, S extends SessionMode = "required">(
  handler: (input: RouteInput<P, S>) => Promise<Response>,
  options: RouteOptions<S> = {},
): (request: Request, context: P) => Promise<Response> {
  const session = options.session ?? "required";
  return async (request, context) => {
    const requestId = randomUUID();
    const started = Date.now();
    let user: SessionUser | null = null;
    let status = 500;
    try {
      if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request);
      user = await loaders[session]();
      if (user && request.method === "GET") {
        await consumeRateLimit(`reads:${user.id}`, READS_PER_WINDOW, READ_WINDOW_SECONDS);
        await consumeRateLimit(`reads-ip:${clientIpKey(request.headers)}`, READS_PER_IP_WINDOW, READ_WINDOW_SECONDS);
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

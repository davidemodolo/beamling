import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { hmacToken } from "./crypto";
import { appUrl, trustedProxyHops } from "./env";
import { log } from "./log";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public provider?: string,
    /** Extra top-level fields for the error response, e.g. the record the failed request changed. */
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const INTERNAL_ERROR_MESSAGE = "Something went wrong.";

/** Authenticated responses must never be stored by browsers or intermediaries. */
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;

export function json(data: unknown, init?: { status?: number; headers?: HeadersInit }): NextResponse {
  const headers = new Headers(PRIVATE_HEADERS);
  for (const [name, value] of new Headers(init?.headers)) headers.set(name, value);
  return NextResponse.json(data, { status: init?.status, headers });
}

/** Redirects that carry or affect a session must not be cached by browsers or intermediaries. */
export function privateRedirect(url: string, status = 307): NextResponse {
  const response = NextResponse.redirect(url, status);
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
  return response;
}

export function errorResponse(error: unknown, requestId?: string): NextResponse {
  if (error instanceof ApiError) {
    return json(
      { ...error.extra, error: { code: error.code, message: error.message, provider: error.provider } },
      { status: error.status, headers: requestId ? { "x-request-id": requestId } : undefined },
    );
  }
  log.error("Unhandled API error", error, requestId ? { requestId } : undefined);
  return json(
    { error: { code: "INTERNAL", message: INTERNAL_ERROR_MESSAGE } },
    { status: 500, headers: requestId ? { "x-request-id": requestId } : undefined },
  );
}

export function notFound(message: string, code = "NOT_FOUND"): ApiError {
  return new ApiError(code, message, 404);
}

/** JSON bodies are small; anything larger is refused before it is buffered. */
export const MAX_BODY_BYTES = 64 * 1024;

function tooLarge(): ApiError {
  return new ApiError("PAYLOAD_TOO_LARGE", "The request body is too large.", 413);
}

async function readLimitedText(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const text = await readLimitedText(request);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError("INVALID_INPUT", result.error.issues[0]?.message ?? "Invalid input.", 400);
  }
  return result.data;
}

// C0 control characters except tab, newline and carriage return. Postgres text cannot store NUL.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Removes control characters from user input. */
export function cleanText(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

/** Removes NUL, the one character Postgres text rejects, from provider output before it is stored. */
export function storableText(value: string): string {
  return value.replace(/\u0000/g, "");
}

const uuidSchema = z.string().uuid();

/** Reads the `id` route param and rejects anything that is not a UUID before it reaches Postgres. */
export async function idParam(context: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) throw new ApiError("INVALID_ID", "Invalid id.", 400);
  return id;
}

export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    // Host headers and X-Forwarded-Host are proxy input; APP_URL is the only trusted origin.
    if (new URL(origin).origin !== new URL(appUrl()).origin) {
      throw new ApiError("INVALID_ORIGIN", "Cross-origin request rejected.", 403);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_ORIGIN", "Cross-origin request rejected.", 403);
  }
}

/**
 * Hashed client IP for rate limiting. Each trusted proxy appends the address it received the
 * request from, so only the entry written by the outermost trusted proxy is reliable; everything
 * before it is client-controlled. A request with fewer entries than trusted hops did not come
 * through the proxies and gets no address.
 */
export function clientIpKey(headers: Headers): string {
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const hops = trustedProxyHops();
  const ip = hops > 0 && forwarded.length >= hops ? forwarded[forwarded.length - hops] : "unknown";
  return hmacToken(`ip:${ip}`);
}

/** Postgres error code, unwrapping drizzle's query error wrapper. */
export function pgErrorCode(error: unknown): string | undefined {
  for (let current = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

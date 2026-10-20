import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { hashToken } from "./crypto";
import { trustedProxyHops } from "./env";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public provider?: string,
  ) {
    super(message);
  }
}

export const INTERNAL_ERROR_MESSAGE = "Something went wrong.";

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, provider: error.provider } },
      { status: error.status },
    );
  }
  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: INTERNAL_ERROR_MESSAGE } },
    { status: 500 },
  );
}

export function notFound(message: string, code = "NOT_FOUND"): ApiError {
  return new ApiError(code, message, 404);
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError("INVALID_INPUT", result.error.issues[0]?.message ?? "Invalid input.", 400);
  }
  return result.data;
}

const uuidSchema = z.string().uuid();

/** Reads the `id` route param and rejects anything that is not a UUID before it reaches Postgres. */
export async function idParam(context: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) throw new ApiError("INVALID_ID", "Invalid id.", 400);
  return id;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  try {
    if (new URL(origin).host !== host) {
      throw new ApiError("INVALID_ORIGIN", "Cross-origin request rejected.", 403);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_ORIGIN", "Cross-origin request rejected.", 403);
  }
}

/** Hashed client IP for rate limiting. Proxies append to X-Forwarded-For, so earlier entries are client-controlled. */
export function clientIpKey(headers: Headers): string {
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const hops = trustedProxyHops();
  const ip =
    (hops > 0 ? forwarded[forwarded.length - hops] ?? forwarded[0] : undefined) ??
    headers.get("x-real-ip") ??
    "unknown";
  return hashToken(`ip:${ip}`).slice(0, 32);
}

/** Postgres error code, unwrapping drizzle's query error wrapper. */
export function pgErrorCode(error: unknown): string | undefined {
  for (let current = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

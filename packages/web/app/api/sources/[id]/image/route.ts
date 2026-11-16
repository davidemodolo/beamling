import { isFakeProviders } from "@/lib/server/env";
import { ApiError, idParam, notFound } from "@/lib/server/http";
import { sniffImageType } from "@/lib/server/image-type";
import { log } from "@/lib/server/log";
import { fakeImage } from "@/lib/server/providers/fake";
import { consumeRateLimit, getSourceImageUrl } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";
import { fetchAnswerImage, SafeFetchError, type FetchedImage } from "@/lib/server/safe-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Pictures per account per hour, on top of the read limit. */
const IMAGES_PER_HOUR = 120;
/** Picture fetches in flight on this instance, so pictures cannot take every connection. */
const MAX_IN_FLIGHT = 4;

let inFlight = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await task();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

const unavailable = () => new ApiError("IMAGE_UNAVAILABLE", "This picture could not be loaded.", 502);

async function load(url: string, signal: AbortSignal): Promise<FetchedImage> {
  if (isFakeProviders()) {
    const bytes = fakeImage(url);
    const type = bytes && sniffImageType(Buffer.from(bytes));
    if (!bytes || !type) throw unavailable();
    return { type, bytes: Buffer.from(bytes) };
  }
  try {
    return await withSlot(() => fetchAnswerImage(url, signal));
  } catch (error) {
    // The upstream URL is never logged: it is the user's encrypted data.
    if (!(error instanceof SafeFetchError)) log.warn("Answer picture fetch failed");
    throw unavailable();
  }
}

/** The picture of one of the account's sources, fetched from its host and passed through, never stored. */
export const GET = apiRoute<Context>(async ({ request, context, user }) => {
  const id = await idParam(context);
  const url = await getSourceImageUrl(user.id, id);
  if (!url) throw notFound("Picture not found.", "IMAGE_NOT_FOUND");
  await consumeRateLimit(`images:${user.id}`, IMAGES_PER_HOUR, 3600);
  const image = await load(url, request.signal);
  return new Response(new Uint8Array(image.bytes), {
    status: 200,
    headers: {
      "Content-Type": image.type,
      "Content-Length": String(image.bytes.length),
      "Cache-Control": "private, max-age=604800, immutable",
      "Content-Disposition": "inline",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
});

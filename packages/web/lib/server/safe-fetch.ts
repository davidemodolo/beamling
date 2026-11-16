import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request, type RequestOptions } from "node:https";
import type { IncomingMessage } from "node:http";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { sniffImageType, type RasterImageType } from "./image-type";

/** Largest picture the answer image route serves. */
export const MAX_ANSWER_IMAGE_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;
const USER_AGENT = "Beamling image fetcher";

/** Why a fetch was refused. Never shown to the user: the route answers with a generic error. */
export class SafeFetchError extends Error {}

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

/** True only for a public unicast address: no private, loopback, link-local, metadata or reserved range. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6) return false;
  const lower = address.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1): judge the IPv4 address inside.
  const mapped = /^(?:0{0,4}:){0,5}ffff:(.+)$/.exec(lower.replace(/^::/, "0:0:0:0:0:"));
  if (mapped) {
    const inner = mapped[1];
    if (isIP(inner) === 4) return isPublicAddress(inner);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(inner);
    if (!hex) return false;
    const value = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
    return isPublicAddress([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join("."));
  }
  return !blocked.check(lower, "ipv6");
}

/** An https URL on port 443 without credentials, or an error. */
function checkedUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeFetchError("invalid url");
  }
  if (url.protocol !== "https:") throw new SafeFetchError("not https");
  if (url.port && url.port !== "443") throw new SafeFetchError("port");
  if (url.username || url.password) throw new SafeFetchError("credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new SafeFetchError("private address");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new SafeFetchError("private host");
  }
  return url;
}

/**
 * Resolves the host and refuses it when any address is not public. The connection uses the
 * addresses checked here, so a second DNS answer cannot point it somewhere else.
 */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, "", 0);
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
      return callback(new SafeFetchError("private address"), "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, all: LookupAddress[]) => void)(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

function get(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const options: RequestOptions = {
    method: "GET",
    lookup: publicLookup,
    headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9", "User-Agent": USER_AGENT },
    signal,
    agent: false,
  };
  return new Promise((resolve, reject) => {
    const req = request(url, options, resolve);
    req.on("error", reject);
    req.end();
  });
}

async function readCapped(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_ANSWER_IMAGE_BYTES) {
      response.destroy();
      throw new SafeFetchError("too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export interface FetchedImage {
  type: RasterImageType;
  bytes: Buffer;
}

/**
 * Fetches a picture for an answer under the SSRF rules: https on 443 only, public addresses only
 * (checked at connect time), at most 3 redirects each checked again, 8 s in total, no cookies or
 * user headers, at most MAX_ANSWER_IMAGE_BYTES, and bytes that are a known raster image type.
 */
export async function fetchAnswerImage(value: string, signal?: AbortSignal): Promise<FetchedImage> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let url = checkedUrl(value);
  for (let redirects = 0; ; redirects++) {
    const response = await get(url, combined);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      if (redirects >= MAX_REDIRECTS) throw new SafeFetchError("too many redirects");
      url = checkedUrl(new URL(response.headers.location, url));
      continue;
    }
    if (status !== 200) {
      response.resume();
      throw new SafeFetchError(`status ${status}`);
    }
    const declared = String(response.headers["content-type"] ?? "").toLowerCase();
    if (declared.includes("svg") || declared.includes("html") || declared.includes("xml")) {
      response.resume();
      throw new SafeFetchError("not a raster image");
    }
    const length = Number(response.headers["content-length"]);
    if (Number.isFinite(length) && length > MAX_ANSWER_IMAGE_BYTES) {
      response.resume();
      throw new SafeFetchError("too large");
    }
    const bytes = await readCapped(response);
    const type = sniffImageType(bytes);
    if (!type) throw new SafeFetchError("not a raster image");
    return { type, bytes };
  }
}

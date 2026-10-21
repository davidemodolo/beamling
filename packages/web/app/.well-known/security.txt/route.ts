import { legalDetails } from "@/lib/legal";
import { appUrl } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPIRY_DAYS = 180;

/** RFC 9116 security contact. Expires is always half a year ahead, so a running deployment never serves a stale file. */
export function GET(): Response {
  const legal = legalDetails();
  const origin = new URL(appUrl()).origin;
  const expires = new Date(Date.now() + EXPIRY_DAYS * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  const lines = [
    ...(legal.contactEmail ? [`Contact: mailto:${legal.contactEmail}`] : []),
    `Contact: ${origin}/contact`,
    `Expires: ${expires.toISOString()}`,
    `Policy: ${origin}/security`,
    `Canonical: ${origin}/.well-known/security.txt`,
    "Preferred-Languages: en",
  ];
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}

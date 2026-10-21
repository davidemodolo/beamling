import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// The Content-Security-Policy header is set per request in proxy.ts, because it carries a nonce.
function packageVersion(): string {
  for (const file of [path.join(process.cwd(), "../../package.json"), path.join(process.cwd(), "package.json")]) {
    try {
      const version = (JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }).version;
      if (typeof version === "string" && version) return version;
    } catch {}
  }
  return "0.0.0-dev";
}

const appVersion = (process.env.APP_VERSION || packageVersion()).replace(/^v/, "");
const gitCommit = process.env.GIT_COMMIT || process.env.GITHUB_SHA || "local";
const buildTime = process.env.BUILD_TIME || new Date().toISOString();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=()" },
  // Browsers ignore HSTS on plain-http responses, so this is safe for local Docker runs.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_GIT_COMMIT: gitCommit,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
  reactStrictMode: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // API responses are data, never documents: nothing in them may run or be framed.
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }] },
    ];
  },
};

export default nextConfig;

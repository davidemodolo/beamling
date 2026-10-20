const DEFAULT_APP_URL = "http://localhost:3000";

export function appUrl(): string {
  return (process.env.OPENROUTER_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL).replace(
    /\/$/,
    "",
  );
}

export function isFakeProviders(): boolean {
  return process.env.BEAMLING_FAKE_PROVIDERS === "1";
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function secureCookies(): boolean {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  if (isProduction()) return !/^http:\/\/(localhost|127\.0\.0\.1)/.test(appUrl());
  return appUrl().startsWith("https://");
}

export function credentialMasterKey(): Buffer {
  const raw = process.env.CREDENTIAL_MASTER_KEY;
  if (!raw) {
    throw new Error("CREDENTIAL_MASTER_KEY is not set. Generate one with: openssl rand -base64 32");
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    throw new Error("CREDENTIAL_MASTER_KEY must be exactly 32 bytes, base64 encoded.");
  }
  return decoded;
}

export const SESSION_COOKIE = "beamling_session";
export const SESSION_TTL_DAYS = 30;

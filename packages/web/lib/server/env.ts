const DEV_DATABASE_URL = "postgres://beamling:beamling@127.0.0.1:5432/beamling";
const DEV_APP_URL = "http://localhost:3000";
const LOCAL_URL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function configuredAppUrl(): string | undefined {
  return process.env.APP_URL ?? process.env.OPENROUTER_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
}

export function appUrl(): string {
  return (configuredAppUrl() ?? DEV_APP_URL).replace(/\/$/, "");
}

function isLocalAppUrl(): boolean {
  return LOCAL_URL_RE.test(appUrl());
}

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL ?? (isProduction() ? undefined : DEV_DATABASE_URL);
}

export function databaseSsl(): { rejectUnauthorized: boolean; ca?: string } | undefined {
  if (process.env.DATABASE_SSL !== "true") return undefined;
  return {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
    ca: process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n") || undefined,
  };
}

// Fixture providers accept any "test-" key, so production only allows them on a local app URL.
export function isFakeProviders(): boolean {
  if (process.env.BEAMLING_FAKE_PROVIDERS !== "1") return false;
  return !isProduction() || isLocalAppUrl();
}

export function secureCookies(): boolean {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  if (isProduction()) return !isLocalAppUrl();
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

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// Number of trusted reverse proxies in front of the app; the client IP is read from that position in X-Forwarded-For.
export function trustedProxyHops(): number {
  const value = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  return Number.isInteger(value) && value >= 0 ? value : 1;
}

export function maxConcurrentChats(): number {
  return positiveInt("MAX_CONCURRENT_CHATS", 50);
}

/** Returns the configuration problems that must stop a production server from starting. */
export function productionConfigErrors(): string[] {
  if (!isProduction()) return [];
  const errors: string[] = [];
  if (!process.env.DATABASE_URL) errors.push("DATABASE_URL is required.");
  if (!configuredAppUrl()) errors.push("APP_URL is required (the public URL of this deployment).");
  try {
    credentialMasterKey();
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (process.env.BEAMLING_FAKE_PROVIDERS === "1" && !isLocalAppUrl()) {
    errors.push("BEAMLING_FAKE_PROVIDERS=1 is only allowed when APP_URL is a localhost URL.");
  }
  return errors;
}

export const SESSION_COOKIE = "beamling_session";
export const SESSION_TTL_DAYS = 30;

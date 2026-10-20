const DEV_DATABASE_URL = "postgres://beamling:beamling@127.0.0.1:5432/beamling";
const DEV_APP_URL = "http://localhost:3000";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function configuredAppUrl(): string | undefined {
  return process.env.APP_URL ?? process.env.OPENROUTER_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
}

export function appUrl(): string {
  return (configuredAppUrl() ?? DEV_APP_URL).replace(/\/$/, "");
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}

function isLocalAppUrl(): boolean {
  const url = parseUrl(appUrl());
  return url !== null && url.protocol === "http:" && isLocalHost(url.hostname);
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

// The __Host- prefix makes the browser refuse the cookie unless it is Secure, host-only and on path "/".
export function sessionCookieName(): string {
  return secureCookies() ? "__Host-beamling_session" : "beamling_session";
}

export const SESSION_TTL_DAYS = 30;

interface MasterKey {
  id: string;
  key: Buffer;
}

function decodeMasterKey(name: string, raw: string): Buffer {
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new Error(`${name} must be exactly 32 bytes, base64 encoded.`);
  return decoded;
}

/** The key that wraps new credentials. */
export function currentMasterKey(): MasterKey {
  const raw = process.env.CREDENTIAL_MASTER_KEY;
  if (!raw) {
    throw new Error("CREDENTIAL_MASTER_KEY is not set. Generate one with: openssl rand -base64 32");
  }
  return { id: process.env.CREDENTIAL_MASTER_KEY_ID || "k1", key: decodeMasterKey("CREDENTIAL_MASTER_KEY", raw) };
}

/** Retired keys that can still unwrap credentials, as "id:base64,id:base64", until they are re-wrapped. */
export function previousMasterKeys(): MasterKey[] {
  const raw = process.env.CREDENTIAL_PREVIOUS_MASTER_KEYS?.trim();
  if (!raw) return [];
  return raw.split(",").map((entry) => {
    const separator = entry.indexOf(":");
    const id = entry.slice(0, separator).trim();
    if (separator <= 0 || !id) throw new Error("CREDENTIAL_PREVIOUS_MASTER_KEYS entries must look like id:base64key.");
    return { id, key: decodeMasterKey(`CREDENTIAL_PREVIOUS_MASTER_KEYS (${id})`, entry.slice(separator + 1).trim()) };
  });
}

export function masterKeyById(id: string): Buffer {
  const current = currentMasterKey();
  if (current.id === id) return current.key;
  const previous = previousMasterKeys().find((candidate) => candidate.id === id);
  if (!previous) throw new Error(`No master key with id "${id}" is configured.`);
  return previous.key;
}

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Number of trusted reverse proxies in front of the app; the client IP is read from that position in
 * X-Forwarded-For. 0 ignores the header, so every client shares one per-IP bucket.
 */
export function trustedProxyHops(): number {
  return nonNegativeInt(process.env.TRUSTED_PROXY_HOPS) ?? 1;
}

export function maxConcurrentChats(): number {
  return positiveInt("MAX_CONCURRENT_CHATS", 50);
}

export function guestsPerIpPerHour(): number {
  return positiveInt("GUESTS_PER_IP_PER_HOUR", 20);
}

/** Global cap on new guest workspaces, independent of the client IP. */
export function guestsPerHour(): number {
  return positiveInt("MAX_GUESTS_PER_HOUR", 1000);
}

function databaseHost(): { hostname: string; password: string } | null {
  const url = parseUrl(process.env.DATABASE_URL ?? "");
  return url ? { hostname: url.hostname, password: decodeURIComponent(url.password) } : null;
}

/** Returns the configuration problems that must stop a production server from starting. */
export function productionConfigErrors(): string[] {
  if (!isProduction()) return [];
  const errors: string[] = [];
  if (!process.env.DATABASE_URL) errors.push("DATABASE_URL is required.");

  const configured = configuredAppUrl();
  const url = configured ? parseUrl(configured) : null;
  if (!configured) {
    errors.push("APP_URL is required (the public URL of this deployment).");
  } else if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    errors.push("APP_URL must be an absolute http(s) URL.");
  } else if (!isLocalAppUrl()) {
    if (url.protocol !== "https:") errors.push("APP_URL must use https:// outside localhost.");
    if (process.env.COOKIE_SECURE === "false") errors.push("COOKIE_SECURE=false is only allowed on localhost.");
    if (nonNegativeInt(process.env.TRUSTED_PROXY_HOPS) === undefined) {
      errors.push(
        "TRUSTED_PROXY_HOPS is required outside localhost: the number of reverse proxies that append to X-Forwarded-For.",
      );
    }
  }

  try {
    currentMasterKey();
    previousMasterKeys();
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (process.env.BEAMLING_FAKE_PROVIDERS === "1" && !isLocalAppUrl()) {
    errors.push("BEAMLING_FAKE_PROVIDERS=1 is only allowed when APP_URL is a localhost URL.");
  }
  return errors;
}

/** Risky but legal production settings, logged at startup. */
export function productionConfigWarnings(): string[] {
  if (!isProduction() || isLocalAppUrl()) return [];
  const warnings: string[] = [];
  const database = databaseHost();
  if (database && !isLocalHost(database.hostname) && database.hostname !== "db") {
    if (process.env.DATABASE_SSL !== "true") warnings.push("DATABASE_SSL is off for a remote database.");
    if (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false") {
      warnings.push("DATABASE_SSL_REJECT_UNAUTHORIZED=false disables certificate checks.");
    }
  }
  if (database?.password === "beamling") warnings.push("The database uses the default local password.");
  if (trustedProxyHops() === 0) warnings.push("TRUSTED_PROXY_HOPS=0: per-IP limits are shared by every client.");
  return warnings;
}

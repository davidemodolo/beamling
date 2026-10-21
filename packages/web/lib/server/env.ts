import { hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
const DEV_DATABASE_URL = "postgres://beamling:beamling@127.0.0.1:5432/beamling";
const DEV_APP_URL = "http://localhost:3000";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface PostHogConfig {
  apiKey: string;
  host: string;
  appHost: string;
  salt: string;
  personalApiKey: string;
  projectId: string;
}

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
  return url !== null && isLocalHost(url.hostname);
}

/** An https origin; plain-http localhost is accepted outside production only, for local fakes. */
function validOrigin(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const url = parseUrl(raw);
  if (!url) return undefined;
  const local = isLocalHost(url.hostname);
  if (local ? isProduction() : url.protocol !== "https:") return undefined;
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
  return url.origin;
}

function posthogIngestionHost(): string | undefined {
  return process.env.POSTHOG_HOST ? validOrigin(process.env.POSTHOG_HOST) : validOrigin("https://eu.i.posthog.com");
}

/** PostHog's app host serves the personal API used for person deletion; ingestion uses the i. host. */
function posthogAppHost(ingestionHost: string): string | undefined {
  if (process.env.POSTHOG_APP_HOST) return validOrigin(process.env.POSTHOG_APP_HOST);
  if (ingestionHost === "https://eu.i.posthog.com") return "https://eu.posthog.com";
  if (ingestionHost === "https://us.i.posthog.com") return "https://us.posthog.com";
  return ingestionHost;
}

/**
 * Analytics is opt-in. `ANALYTICS_ENABLED=false` is the kill switch; without `=true` no events leave
 * the process. Local and test environments therefore stay silent unless explicitly configured.
 */
export function analyticsEnabled(): boolean {
  return process.env.ANALYTICS_ENABLED === "true";
}

/** Capture settings: present only while analytics is enabled. */
export function posthogConfig(): PostHogConfig | null {
  return analyticsEnabled() ? posthogSettings() : null;
}

/**
 * Deletion settings ignore the kill switch: events captured before `ANALYTICS_ENABLED=false` still
 * have to be erasable when their account is deleted.
 */
export function posthogDeletionConfig(): PostHogConfig | null {
  return posthogSettings();
}

function posthogSettings(): PostHogConfig | null {
  const apiKey = process.env.POSTHOG_API_KEY?.trim();
  const salt = process.env.ANALYTICS_SALT?.trim();
  const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const projectId = process.env.POSTHOG_PROJECT_ID?.trim();
  const host = posthogIngestionHost();
  const appHost = host ? posthogAppHost(host) : undefined;
  if (!apiKey || !salt || !personalApiKey || !projectId || !host || !appHost) return null;
  return { apiKey, salt, host, appHost, personalApiKey, projectId };
}

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL ?? (isProduction() ? undefined : DEV_DATABASE_URL);
}

export function databaseSsl(): { rejectUnauthorized: boolean; ca?: string } | undefined {
  if (process.env.DATABASE_SSL !== "true") return undefined;
  const ca =
    process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n") ||
    (process.env.DATABASE_SSL_CA_FILE ? readFileSync(process.env.DATABASE_SSL_CA_FILE, "utf8") : undefined);
  return {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
    ca,
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

export function loginsPerIpPerHour(): number {
  return positiveInt("LOGINS_PER_IP_PER_HOUR", 60);
}

export const OIDC_TRANSACTION_TTL_SECONDS = 600;

export function oidcIssuer(): string {
  return (process.env.OIDC_ISSUER ?? "https://accounts.google.com").replace(/\/$/, "");
}

export function oidcClientId(): string {
  return process.env.OIDC_CLIENT_ID ?? "";
}

export function oidcClientSecret(): string {
  return process.env.OIDC_CLIENT_SECRET ?? "";
}

export function oidcRedirectUri(): string {
  return process.env.OIDC_REDIRECT_URI ?? `${appUrl()}/api/auth/callback/google`;
}

export function authSecret(): Buffer {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("AUTH_SECRET is not set. Generate one with: openssl rand -base64 32");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new Error("AUTH_SECRET must be exactly 32 bytes, base64 encoded.");
  return decoded;
}

// Keyed by purpose and secret, so a changed AUTH_SECRET never reuses a key derived from the old one.
const subkeys = new Map<string, Buffer>();

/**
 * A separate 32-byte key per use of AUTH_SECRET (HKDF-SHA256), so the OIDC transaction cookie and
 * the IP hashes never share a key.
 */
export function authSubkey(purpose: "oidc-transaction" | "ip-hash"): Buffer {
  const cacheKey = `${purpose}:${process.env.AUTH_SECRET}`;
  let key = subkeys.get(cacheKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", authSecret(), Buffer.alloc(0), `beamling:auth-secret:v1:${purpose}`, 32));
    subkeys.set(cacheKey, key);
  }
  return key;
}

export function newAccountsPerHour(): number {
  return positiveInt("NEW_ACCOUNTS_PER_HOUR", 200);
}

export function oidcTransactionCookieName(): string {
  return secureCookies() ? "__Host-beamling_oidc" : "beamling_oidc";
}

export const INTERNAL_SECRET_MIN_BYTES = 32;

/** Operator secrets are accepted only when long enough; otherwise the endpoint stays disabled. */
export function internalSecret(name: "KILL_SWITCH_SECRET" | "METRICS_SECRET"): string | undefined {
  const value = process.env[name]?.trim();
  return value && Buffer.byteLength(value, "utf8") >= INTERNAL_SECRET_MIN_BYTES ? value : undefined;
}

export function kmsProvider(): "env" | "aws" | "gcp" {
  const value = process.env.KMS_PROVIDER ?? "env";
  if (value === "env" || value === "aws" || value === "gcp") return value;
  throw new Error("KMS_PROVIDER must be env, aws or gcp.");
}

export interface GcpServiceAccount {
  client_email: string;
  private_key: string;
}

/**
 * A service-account key passed as a secret, for hosts that cannot mount a credentials file.
 * Workload Identity and GOOGLE_APPLICATION_CREDENTIALS remain supported when this is absent.
 */
export function gcpCredentials(): GcpServiceAccount | undefined {
  const raw = process.env.GCP_KMS_CREDENTIALS?.trim();
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("GCP_KMS_CREDENTIALS must be a JSON service-account key.");
  }
  const candidate = value as Partial<Record<keyof GcpServiceAccount, unknown>> | null;
  if (typeof candidate?.client_email !== "string" || typeof candidate.private_key !== "string" || !candidate.client_email || !candidate.private_key) {
    throw new Error("GCP_KMS_CREDENTIALS must contain client_email and private_key.");
  }
  return { client_email: candidate.client_email, private_key: candidate.private_key };
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

  // APP_URL is the public origin for same-origin checks, cookies and OIDC redirects. Unlike the
  // development fallback, production may not infer it from a provider-specific alias.
  const configured = process.env.APP_URL;
  const url = configured ? parseUrl(configured) : null;
  if (!configured) {
    errors.push("APP_URL is required (the public URL of this deployment).");
  } else if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    errors.push("APP_URL must be an absolute http(s) URL.");
  } else if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    errors.push("APP_URL must be an origin only, without credentials, a path, query or fragment.");
  } else if (!isLocalHost(url.hostname)) {
    if (url.protocol !== "https:") errors.push("APP_URL must use https:// outside localhost.");
    if (process.env.COOKIE_SECURE === "false") errors.push("COOKIE_SECURE=false is only allowed on localhost.");
    if (nonNegativeInt(process.env.TRUSTED_PROXY_HOPS) === undefined) {
      errors.push(
        "TRUSTED_PROXY_HOPS is required outside localhost: the number of reverse proxies that append to X-Forwarded-For.",
      );
    }
  }

  try {
    authSecret();
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (!process.env.OIDC_CLIENT_ID) errors.push("OIDC_CLIENT_ID is required.");
  if (!process.env.OIDC_CLIENT_SECRET) errors.push("OIDC_CLIENT_SECRET is required.");
  try {
    const issuer = parseUrl(oidcIssuer());
    if (!issuer || (issuer.protocol !== "https:" && !isLocalAppUrl())) {
      errors.push("OIDC_ISSUER must be an https URL outside localhost.");
    }
    if (issuer && (issuer.username || issuer.password)) {
      errors.push("OIDC_ISSUER must not contain credentials.");
    }
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (url) {
    const redirect = parseUrl(oidcRedirectUri());
    if (!redirect) {
      errors.push("OIDC_REDIRECT_URI must be an absolute URL.");
    } else {
      if (redirect.origin !== url.origin) errors.push("OIDC_REDIRECT_URI must use the same origin as APP_URL.");
      if (redirect.pathname !== "/api/auth/callback/google") {
        errors.push("OIDC_REDIRECT_URI must end at /api/auth/callback/google.");
      }
    }
  }
  try {
    const provider = kmsProvider();
    if (provider === "env" && !isLocalAppUrl()) errors.push("KMS_PROVIDER=env is not allowed outside localhost.");
    if (provider === "aws" && !process.env.KMS_KEY_ID) errors.push("KMS_KEY_ID is required for the AWS KMS adapter.");
    if (provider === "gcp" && !process.env.KMS_KEY_NAME) errors.push("KMS_KEY_NAME is required for the GCP KMS adapter.");
    if (provider === "gcp") gcpCredentials();
    if (provider === "env") {
      currentMasterKey();
      previousMasterKeys();
    }
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (process.env.BEAMLING_FAKE_PROVIDERS === "1" && !isLocalAppUrl()) {
    errors.push("BEAMLING_FAKE_PROVIDERS=1 is only allowed when APP_URL is a localhost URL.");
  }
  errors.push(...analyticsConfigErrors());
  return errors;
}

function analyticsConfigErrors(): string[] {
  const flag = process.env.ANALYTICS_ENABLED;
  if (flag && flag !== "true" && flag !== "false") {
    return ["ANALYTICS_ENABLED must be exactly true or false."];
  }
  if (!analyticsEnabled()) return [];
  const errors: string[] = [];
  if (!process.env.POSTHOG_API_KEY?.trim()) errors.push("POSTHOG_API_KEY is required when analytics is enabled.");
  if (!process.env.POSTHOG_PERSONAL_API_KEY?.trim()) {
    errors.push("POSTHOG_PERSONAL_API_KEY is required when analytics is enabled, so account deletion can remove events.");
  }
  if (!process.env.POSTHOG_PROJECT_ID?.trim()) {
    errors.push("POSTHOG_PROJECT_ID is required when analytics is enabled.");
  } else if (!/^\d+$/.test(process.env.POSTHOG_PROJECT_ID.trim())) {
    errors.push("POSTHOG_PROJECT_ID must be numeric.");
  }
  const salt = process.env.ANALYTICS_SALT?.trim();
  if (!salt || Buffer.byteLength(salt, "utf8") < 32) {
    errors.push("ANALYTICS_SALT must be at least 32 bytes when analytics is enabled.");
  }
  if (!posthogIngestionHost()) errors.push("POSTHOG_HOST must be an https origin outside localhost.");
  if (process.env.POSTHOG_APP_HOST && !validOrigin(process.env.POSTHOG_APP_HOST)) {
    errors.push("POSTHOG_APP_HOST must be an https origin outside localhost.");
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
  for (const name of ["KILL_SWITCH_SECRET", "METRICS_SECRET"] as const) {
    if (!internalSecret(name)) {
      warnings.push(`${name} is missing or shorter than ${INTERNAL_SECRET_MIN_BYTES} bytes; its internal endpoint is disabled.`);
    }
  }
  return warnings;
}

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { authSubkey } from "./env";
import { unwrapKey, wrapKey } from "./kms";

const ALGORITHM = "aes-256-gcm";
const MIN_LENGTH_FOR_LAST4 = 20;

export interface EncryptedSecret {
  id: string;
  keyId: string;
  wrappedDek: string;
  dekNonce: string;
  dekTag: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  fingerprint: string;
  last4: string;
}

export type StoredSecret = Omit<EncryptedSecret, "fingerprint" | "last4">;

/** Keyed fingerprint: a database reader cannot test candidate provider keys offline. */
export function credentialFingerprint(plaintext: string): string {
  return createHmac("sha256", authSubkey("credential-fingerprint")).update(plaintext).digest("hex").slice(0, 16);
}

/** Shared slot key; only the provider prefix and a keyed digest are persisted. */
export function providerSlotKey(provider: "brave", key: string): string {
  return `${provider}:${createHmac("sha256", authSubkey("provider-slot")).update(key).digest("hex").slice(0, 32)}`;
}

function seal(key: Buffer, plaintext: Buffer, aad: Buffer): { nonce: string; ciphertext: string; tag: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function open(
  key: Buffer,
  payload: { nonce: string; ciphertext: string; tag: string },
  aad: Buffer,
): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.nonce, "base64"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
}

// scripts/rewrap-credentials.mjs builds the same AAD; keep the two in sync.
export function credentialAad(userId: string, credentialId: string, kind: string, provider: string): Buffer {
  return Buffer.from(`beamling:v1:${userId}:${credentialId}:${kind}:${provider}`, "utf8");
}

export async function encryptCredential(
  userId: string,
  kind: string,
  provider: string,
  plaintext: string,
  credentialId: string = randomUUID(),
): Promise<EncryptedSecret> {
  const aad = credentialAad(userId, credentialId, kind, provider);
  const dek = randomBytes(32);
  const secret = seal(dek, Buffer.from(plaintext, "utf8"), aad);
  const wrapped = await wrapKey(dek, `beamling:credential:v1:${userId}:${credentialId}:${kind}:${provider}`);
  return {
    id: credentialId,
    keyId: wrapped.keyId,
    wrappedDek: wrapped.wrappedKey,
    dekNonce: wrapped.nonce ?? "",
    dekTag: wrapped.tag ?? "",
    nonce: secret.nonce,
    ciphertext: secret.ciphertext,
    tag: secret.tag,
    fingerprint: credentialFingerprint(plaintext),
    // Four characters of a short key would reveal a large part of it.
    last4: plaintext.length >= MIN_LENGTH_FOR_LAST4 ? plaintext.slice(-4) : "••••",
  };
}

export async function decryptCredential(
  userId: string,
  credential: StoredSecret & { kind: string; provider: string },
): Promise<string> {
  const aad = credentialAad(userId, credential.id, credential.kind, credential.provider);
  const dek = await unwrapKey(
    {
      keyId: credential.keyId,
      wrappedKey: credential.wrappedDek,
      nonce: credential.dekNonce || undefined,
      tag: credential.dekTag || undefined,
    },
    `beamling:credential:v1:${userId}:${credential.id}:${credential.kind}:${credential.provider}`,
  );
  return open(dek, { nonce: credential.nonce, ciphertext: credential.ciphertext, tag: credential.tag }, aad).toString(
    "utf8",
  );
}

/**
 * True when decryption failed because the stored ciphertext or its wrapped key does not
 * authenticate, as opposed to a KMS, network or configuration failure. Only the former means the
 * saved key is unreadable for good.
 */
export function isDecryptIntegrityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = (error as { name?: string }).name ?? "";
  const code = (error as { code?: unknown }).code;
  return (
    /unable to authenticate data|unsupported state|bad decrypt/i.test(error.message) ||
    name === "InvalidCiphertextException" ||
    // gRPC INVALID_ARGUMENT from Google Cloud KMS: the ciphertext or its AAD does not match.
    code === 3
  );
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Keyed hash for low-entropy identifiers such as IP addresses; a DB dump cannot brute-force them. */
export function hmacToken(value: string): string {
  // Production startup requires AUTH_SECRET. A keyless development hash keeps `web:dev` usable
  // before the first secret is configured; it is never accepted in production.
  if (!process.env.AUTH_SECRET) return hashToken(value).slice(0, 32);
  return createHmac("sha256", authSubkey("ip-hash")).update(value).digest("hex").slice(0, 32);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

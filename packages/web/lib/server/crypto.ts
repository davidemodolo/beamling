import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { credentialMasterKey } from "./env";

const ALGORITHM = "aes-256-gcm";

export interface EncryptedSecret {
  id: string;
  wrappedDek: string;
  dekNonce: string;
  dekTag: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  fingerprint: string;
  last4: string;
}

export interface StoredSecret extends Omit<EncryptedSecret, "id" | "fingerprint" | "last4"> {
  id: string;
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

function credentialAad(userId: string, credentialId: string, kind: string, provider: string): Buffer {
  return Buffer.from(`beamling:v1:${userId}:${credentialId}:${kind}:${provider}`, "utf8");
}

export function encryptCredential(
  userId: string,
  kind: string,
  provider: string,
  plaintext: string,
): EncryptedSecret {
  const credentialId = randomUUID();
  const aad = credentialAad(userId, credentialId, kind, provider);
  const dek = randomBytes(32);
  const secret = seal(dek, Buffer.from(plaintext, "utf8"), aad);
  const wrapped = seal(credentialMasterKey(), dek, aad);
  return {
    id: credentialId,
    wrappedDek: wrapped.ciphertext,
    dekNonce: wrapped.nonce,
    dekTag: wrapped.tag,
    nonce: secret.nonce,
    ciphertext: secret.ciphertext,
    tag: secret.tag,
    fingerprint: createHash("sha256").update(plaintext).digest("hex").slice(0, 16),
    last4: plaintext.slice(-4) || "0000",
  };
}

export function decryptCredential(
  userId: string,
  credential: StoredSecret & { kind: string; provider: string },
): string {
  const aad = credentialAad(userId, credential.id, credential.kind, credential.provider);
  const dek = open(
    credentialMasterKey(),
    { nonce: credential.dekNonce, ciphertext: credential.wrappedDek, tag: credential.dekTag },
    aad,
  );
  return open(dek, { nonce: credential.nonce, ciphertext: credential.ciphertext, tag: credential.tag }, aad).toString(
    "utf8",
  );
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

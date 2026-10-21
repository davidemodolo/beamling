import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { unwrapKey, wrapKey, type WrappedKey } from "./kms";
import { userDataKeys } from "./schema";

const PREFIX = "enc:v1:";
const CACHE_LIMIT = 500;
const cache = new Map<string, Buffer>();

interface Envelope {
  n: string;
  c: string;
  t: string;
  k: string;
}

function aad(userId: string, table: string, rowId: string, field: string): string {
  return `beamling:content:v1:${userId}:${table}:${rowId}:${field}`;
}

function wdkAad(userId: string): string {
  return `beamling:wdk:v1:${userId}`;
}

function cacheSet(userId: string, key: Buffer) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(userId, key);
}

export function forgetWorkspaceKey(userId: string): void {
  cache.delete(userId);
}

async function readStoredKey(userId: string): Promise<Buffer | null> {
  const [row] = await db.select().from(userDataKeys).where(eq(userDataKeys.userId, userId)).limit(1);
  if (!row) return null;
  const wrapped: WrappedKey = {
    keyId: row.keyId,
    wrappedKey: row.wrappedKey,
    nonce: row.wrapNonce ?? undefined,
    tag: row.wrapTag ?? undefined,
  };
  const key = await unwrapKey(wrapped, wdkAad(userId));
  if (key.length !== 32) throw new Error("Workspace key has the wrong length.");
  return key;
}

export async function ensureWorkspaceKey(userId: string): Promise<Buffer> {
  const cached = cache.get(userId);
  if (cached) return cached;

  const existing = await readStoredKey(userId);
  if (existing) {
    cacheSet(userId, existing);
    return existing;
  }

  const key = randomBytes(32);
  const wrapped = await wrapKey(key, wdkAad(userId));
  const [inserted] = await db
    .insert(userDataKeys)
    .values({
      userId,
      keyId: wrapped.keyId,
      wrappedKey: wrapped.wrappedKey,
      wrapNonce: wrapped.nonce ?? null,
      wrapTag: wrapped.tag ?? null,
    })
    .onConflictDoNothing()
    .returning({ userId: userDataKeys.userId });
  if (!inserted) {
    const raced = await readStoredKey(userId);
    if (!raced) throw new Error("Workspace key could not be created.");
    cacheSet(userId, raced);
    return raced;
  }
  cacheSet(userId, key);
  return key;
}

export async function encryptText(
  userId: string,
  table: string,
  rowId: string,
  field: string,
  plaintext: string,
): Promise<string> {
  const key = await ensureWorkspaceKey(userId);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad(userId, table, rowId, field), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const envelope: Envelope = {
    n: nonce.toString("base64"),
    c: ciphertext.toString("base64"),
    t: cipher.getAuthTag().toString("base64"),
    k: "wdk1",
  };
  return `${PREFIX}${Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")}`;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export async function decryptText(
  userId: string,
  table: string,
  rowId: string,
  field: string,
  value: string,
): Promise<string> {
  if (!isEncrypted(value)) return value;
  const key = await ensureWorkspaceKey(userId);
  let envelope: Envelope;
  try {
    envelope = JSON.parse(Buffer.from(value.slice(PREFIX.length), "base64url").toString("utf8")) as Envelope;
  } catch {
    throw new Error("Stored content is not a valid envelope.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.n, "base64"));
  decipher.setAAD(Buffer.from(aad(userId, table, rowId, field), "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.t, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.c, "base64")), decipher.final()]).toString("utf8");
}

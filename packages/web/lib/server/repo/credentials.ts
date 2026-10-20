import { and, asc, eq } from "drizzle-orm";
import type { Credential, CredentialStatus } from "../../types";
import type { EncryptedSecret } from "../crypto";
import { db } from "../db";
import { credentials } from "../schema";
import { mapCredential } from "./shared";

export async function listCredentials(userId: string): Promise<Credential[]> {
  const rows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.userId, userId))
    .orderBy(asc(credentials.createdAt));
  return rows.map(mapCredential);
}

export async function getCredentialRow(userId: string, kind: string, provider: string) {
  const [row] = await db
    .select()
    .from(credentials)
    .where(
      and(eq(credentials.userId, userId), eq(credentials.kind, kind), eq(credentials.provider, provider)),
    )
    .limit(1);
  return row ?? null;
}

export async function getCredentialById(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
    .limit(1);
  return row ?? null;
}

type CredentialKindValue = "llm" | "search";

/**
 * Inserts or atomically replaces the user's credential for this kind and provider. The id is
 * replaced too, because the ciphertext's AAD is bound to the id it was encrypted with.
 */
export async function saveCredential(input: {
  userId: string;
  kind: CredentialKindValue;
  provider: string;
  encrypted: EncryptedSecret;
  status: CredentialStatus;
}): Promise<Credential> {
  const now = new Date();
  const values = {
    ...input.encrypted,
    status: input.status,
    lastValidatedAt: now,
    updatedAt: now,
  };
  const [row] = await db
    .insert(credentials)
    .values({ ...values, userId: input.userId, kind: input.kind, provider: input.provider })
    .onConflictDoUpdate({
      target: [credentials.userId, credentials.kind, credentials.provider],
      set: { ...values, createdAt: now },
    })
    .returning();
  return mapCredential(row);
}

export async function updateCredentialValidation(
  userId: string,
  id: string,
  status: CredentialStatus,
): Promise<Credential | null> {
  const now = new Date();
  const [row] = await db
    .update(credentials)
    .set({ status, lastValidatedAt: now, updatedAt: now })
    .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
    .returning();
  return row ? mapCredential(row) : null;
}

export async function deleteCredential(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
    .returning({ id: credentials.id });
  return rows.length > 0;
}

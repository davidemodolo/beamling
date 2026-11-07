import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { usableProviders } from "../../provider-catalog";
import type { BravePlan, Credential, CredentialKind, CredentialProvider, CredentialStatus } from "../../types";
import { decryptCredential, encryptCredential, providerSlotKey, type EncryptedSecret } from "../crypto";
import { currentKmsKeyId } from "../kms";
import { db } from "../db";
import { credentialUsage, credentials, providerSlots } from "../schema";
import { mapCredential, type CredentialRow, type CredentialUsageSummary } from "./shared";

/** This month's usage per credential, counted from the budget start when it was set this month. */
async function usageFor(rows: { id: string; budgetStartedAt: Date | null }[]) {
  const out = new Map<string, CredentialUsageSummary>();
  if (!rows.length) return out;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartDay = monthStart.toISOString().slice(0, 10);
  // One query for every credential; no per-credential N+1.
  const usageRows = await db
    .select({
      credentialId: credentialUsage.credentialId,
      day: credentialUsage.day,
      requests: credentialUsage.requests,
      estimatedCostUsd: credentialUsage.estimatedCostUsd,
    })
    .from(credentialUsage)
    .where(and(inArray(credentialUsage.credentialId, rows.map((row) => row.id)), gte(credentialUsage.day, monthStartDay)));
  for (const row of rows) {
    const startDay = row.budgetStartedAt && row.budgetStartedAt > monthStart ? row.budgetStartedAt.toISOString().slice(0, 10) : monthStartDay;
    const summary = { requests: 0, spentUsd: 0 };
    for (const entry of usageRows) {
      if (entry.credentialId !== row.id || entry.day < startDay) continue;
      summary.requests += entry.requests;
      summary.spentUsd += Number(entry.estimatedCostUsd);
    }
    out.set(row.id, summary);
  }
  return out;
}

export async function listCredentials(userId: string): Promise<Credential[]> {
  const rows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.userId, userId))
    .orderBy(asc(credentials.createdAt));
  const usage = await usageFor(rows);
  return rows.map((row) => mapCredential(row, usage.get(row.id)));
}

/** Providers with a usable saved key, without reading usage or key material. */
export async function keyedProviders(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ provider: credentials.provider, status: credentials.status })
    .from(credentials)
    .where(eq(credentials.userId, userId));
  return usableProviders(rows);
}

export async function getCredentialRow(userId: string, kind: CredentialKind, provider: CredentialProvider) {
  const [row] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.kind, kind), eq(credentials.provider, provider)))
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

/**
 * Decrypts a stored provider key. Once the configured KMS key has changed, the key is re-encrypted
 * under the current one (same row id, so usage history stays), letting the old KMS key be retired.
 */
export async function readCredentialKey(userId: string, row: CredentialRow): Promise<string> {
  const plaintext = await decryptCredential(userId, row);
  if (row.keyId !== (await currentKmsKeyId().catch(() => row.keyId))) {
    try {
      const { keyId, wrappedDek, dekNonce, dekTag, nonce, ciphertext, tag } = await encryptCredential(
        userId,
        row.kind,
        row.provider,
        plaintext,
        row.id,
      );
      // Matching the old wrapped key skips a row the user replaced in the meantime.
      await db
        .update(credentials)
        .set({ keyId, wrappedDek, dekNonce, dekTag, nonce, ciphertext, tag })
        .where(and(eq(credentials.id, row.id), eq(credentials.wrappedDek, row.wrappedDek)));
    } catch {
      // A failed opportunistic re-wrap must not fail the request; try again on the next read.
    }
  }
  return plaintext;
}

export async function saveCredential(input: {
  userId: string;
  kind: CredentialKind;
  provider: CredentialProvider;
  encrypted: EncryptedSecret;
  status: CredentialStatus;
  plan?: BravePlan | null;
  expiresOn?: string | null;
  budgetUsd?: number | null;
  preserveUsage?: boolean;
}): Promise<Credential> {
  const now = new Date();
  const existing = await getCredentialRow(input.userId, input.kind, input.provider);
  const { id, ...mutable } = input.encrypted;
  const updateValues = {
    ...mutable,
    status: input.status,
    plan: input.plan ?? null,
    expiresOn: input.expiresOn ?? null,
    budgetUsd: input.budgetUsd == null ? null : input.budgetUsd.toFixed(2),
    budgetPeriod: input.budgetUsd == null ? null : ("month" as const),
    budgetStartedAt: input.budgetUsd == null ? null : existing?.budgetStartedAt ?? now,
    lastValidatedAt: input.status === "unverified" ? null : now,
    updatedAt: now,
  };
  let [row] = await db
    .insert(credentials)
    .values({
      ...updateValues,
      id,
      userId: input.userId,
      kind: input.kind,
      provider: input.provider,
      createdAt: input.preserveUsage && existing ? existing.createdAt : now,
    })
    .onConflictDoUpdate({
      target: [credentials.userId, credentials.kind, credentials.provider],
      // Only the row whose id matches the encrypted envelope may be overwritten. A racing
      // different-key insert owns a different id, so its ciphertext must not land on this row.
      setWhere: eq(credentials.id, id),
      set: { ...updateValues, ...(input.preserveUsage && existing ? { createdAt: existing.createdAt } : {}) },
    })
    .returning();
  if (!row) {
    [row] = await db
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.userId, input.userId),
          eq(credentials.kind, input.kind),
          eq(credentials.provider, input.provider),
        ),
      )
      .limit(1);
  }
  if (!row) throw new Error("Credential could not be saved.");
  const usage = await usageFor([row]);
  return mapCredential(row, usage.get(row.id));
}

export async function updateCredentialLimits(
  userId: string,
  id: string,
  input: {
    plan?: BravePlan | null;
    expiresOn?: string | null;
    budgetUsd?: number | null;
  },
): Promise<Credential | null> {
  const now = new Date();
  const existing = await getCredentialById(userId, id);
  if (!existing) return null;
  const budgetChanged = (existing.budgetUsd == null ? null : Number(existing.budgetUsd)) !== input.budgetUsd;
  const [row] = await db
    .update(credentials)
    .set({
      plan: input.plan,
      expiresOn: input.expiresOn,
      budgetUsd: input.budgetUsd == null ? null : input.budgetUsd.toFixed(2),
      budgetPeriod: input.budgetUsd == null ? null : "month",
      budgetStartedAt: input.budgetUsd == null ? null : budgetChanged ? now : existing.budgetStartedAt,
      updatedAt: now,
    })
    .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
    .returning();
  if (!row) return null;
  const usage = await usageFor([row]);
  return mapCredential(row, usage.get(row.id));
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
  if (!row) return null;
  const usage = await usageFor([row]);
  return mapCredential(row, usage.get(row.id));
}

export async function recordCredentialUsage(credentialId: string, costUsd: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await db
    .insert(credentialUsage)
    .values({ credentialId, day, requests: 1, estimatedCostUsd: costUsd.toFixed(6) })
    .onConflictDoUpdate({
      target: [credentialUsage.credentialId, credentialUsage.day],
      set: {
        requests: sql`${credentialUsage.requests} + 1`,
        estimatedCostUsd: sql`${credentialUsage.estimatedCostUsd} + ${costUsd.toFixed(6)}`,
      },
    });
}

export async function deleteCredential(userId: string, id: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
    .limit(1);
  if (!row) return false;
  // The Brave slot key is derived from the plaintext key, so release it before the ciphertext goes.
  if (row.provider === "brave") {
    try {
      const plaintext = await decryptCredential(userId, row);
      await db.delete(providerSlots).where(eq(providerSlots.key, providerSlotKey("brave", plaintext)));
    } catch {
      // The age-based cleanup remains the fallback; credential removal must still succeed.
    }
  }
  const rows = await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
    .returning({ id: credentials.id });
  return rows.length > 0;
}

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Credential, CredentialStatus } from "../../types";
import type { EncryptedSecret } from "../crypto";
import { db } from "../db";
import { credentialUsage, credentials } from "../schema";
import { mapCredential, type CredentialUsageSummary } from "./shared";

async function usageFor(rows: { id: string; budgetPeriod: string | null; budgetStartedAt: Date | null; createdAt: Date }[]) {
  if (!rows.length) return new Map<string, CredentialUsageSummary>();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const usageRows = await db
    .select({
      credentialId: credentialUsage.credentialId,
      requests: sql<number>`sum(${credentialUsage.requests})::int`,
      spentUsd: sql<number>`sum(${credentialUsage.estimatedCostUsd})::float8`,
      day: sql<string>`min(${credentialUsage.day})`,
    })
    .from(credentialUsage)
    .where(inArray(credentialUsage.credentialId, rows.map((row) => row.id)))
    .groupBy(credentialUsage.credentialId);
  const byId = new Map(usageRows.map((row) => [row.credentialId, row]));
  const out = new Map<string, CredentialUsageSummary>();
  for (const row of rows) {
    const usage = byId.get(row.id);
    if (!usage) {
      out.set(row.id, { requests: 0, spentUsd: 0 });
      continue;
    }
    if (row.budgetPeriod === "month" || !row.budgetPeriod) {
      const start = row.budgetStartedAt && row.budgetStartedAt > monthStart ? row.budgetStartedAt : monthStart;
      const [monthly] = await db
        .select({
          requests: sql<number>`coalesce(sum(${credentialUsage.requests}), 0)::int`,
          spentUsd: sql<number>`coalesce(sum(${credentialUsage.estimatedCostUsd}), 0)::float8`,
        })
        .from(credentialUsage)
        .where(
          and(
            eq(credentialUsage.credentialId, row.id),
            gte(credentialUsage.day, start.toISOString().slice(0, 10)),
          ),
        );
      out.set(row.id, { requests: monthly.requests, spentUsd: monthly.spentUsd });
    } else {
      out.set(row.id, { requests: usage.requests, spentUsd: usage.spentUsd });
    }
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

export async function getCredentialRow(userId: string, kind: string, provider: string) {
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

type CredentialKindValue = "llm" | "search";

export async function saveCredential(input: {
  userId: string;
  kind: CredentialKindValue;
  provider: string;
  encrypted: EncryptedSecret;
  status: CredentialStatus;
  plan?: "free" | "paid" | null;
  expiresOn?: string | null;
  budgetUsd?: number | null;
  budgetPeriod?: "month" | "total" | null;
  preserveUsage?: boolean;
}): Promise<Credential> {
  const now = new Date();
  const existing = await getCredentialRow(input.userId, input.kind, input.provider);
  const values = {
    ...input.encrypted,
    id: input.encrypted.id,
    status: input.status,
    plan: input.plan ?? null,
    expiresOn: input.expiresOn ?? null,
    budgetUsd: input.budgetUsd == null ? null : input.budgetUsd.toFixed(2),
    budgetPeriod: input.budgetPeriod ?? (input.budgetUsd == null ? null : "month"),
    budgetStartedAt: input.budgetUsd == null ? null : existing?.budgetStartedAt ?? now,
    lastValidatedAt: input.status === "unverified" ? null : now,
    updatedAt: now,
  };
  const [row] = await db
    .insert(credentials)
    .values({ ...values, userId: input.userId, kind: input.kind, provider: input.provider })
    .onConflictDoUpdate({
      target: [credentials.userId, credentials.kind, credentials.provider],
      set: { ...values, createdAt: input.preserveUsage && existing ? existing.createdAt : now },
    })
    .returning();
  const usage = await usageFor([row]);
  return mapCredential(row, usage.get(row.id));
}

export async function updateCredentialLimits(
  userId: string,
  id: string,
  input: {
    plan?: "free" | "paid" | null;
    expiresOn?: string | null;
    budgetUsd?: number | null;
    budgetPeriod?: "month" | "total" | null;
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
      budgetPeriod: input.budgetPeriod ?? null,
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
  const rows = await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
    .returning({ id: credentials.id });
  return rows.length > 0;
}

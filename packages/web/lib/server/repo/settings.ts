import { eq } from "drizzle-orm";
import { isAllowedModel } from "../../providers";
import type { Settings } from "../../types";
import { db } from "../db";
import { settings } from "../schema";
import { mapSettings } from "./shared";

export async function ensureSettings(userId: string): Promise<Settings> {
  const [existing] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
  if (existing) return mapSettings(existing);
  const [created] = await db.insert(settings).values({ userId }).onConflictDoNothing().returning();
  return created ? mapSettings(created) : ensureSettings(userId);
}

export async function updateSettings(userId: string, patch: Partial<Settings>): Promise<Settings> {
  const current = await ensureSettings(userId);
  const next: Settings = {
    ...current,
    ...patch,
    llmModel: patch.llmModel && isAllowedModel(patch.llmModel) ? patch.llmModel : current.llmModel,
  };
  const [row] = await db
    .update(settings)
    .set({
      llmModel: next.llmModel,
      defaultMode: next.defaultMode,
      updatedAt: new Date(),
    })
    .where(eq(settings.userId, userId))
    .returning();
  return mapSettings(row);
}

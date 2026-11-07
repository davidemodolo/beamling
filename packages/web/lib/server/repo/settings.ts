import { eq, sql } from "drizzle-orm";
import { isSearchProvider } from "../../contracts";
import { isAllowedModel, setupState, usableDefaults } from "../../provider-catalog";
import type { Settings } from "../../types";
import { db } from "../db";
import { analyticsErasures, settings } from "../schema";
import { keyedProviders } from "./credentials";
import { mapSettings } from "./shared";

export async function ensureSettings(userId: string): Promise<Settings> {
  const [existing] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
  if (existing) return mapSettings(existing);
  const [created] = await db.insert(settings).values({ userId }).onConflictDoNothing().returning();
  return created ? mapSettings(created) : ensureSettings(userId);
}

// Exclusion answers are cached per process so analytics adds no query per event. Another instance
// may capture for up to EXCLUSION_TTL_MS after an opt-out; the queued erasure's confirming pass,
// an hour later, deletes those events too.
const EXCLUSION_TTL_MS = 60_000;
const EXCLUSION_CACHE_MAX = 10_000;
const exclusionCache = new Map<string, { excluded: boolean; expiresAt: number }>();

/**
 * True when no event may be captured for the account: it objected to product analytics, or an
 * erasure of its PostHog person is still pending (events sent now would be deleted with it).
 */
export async function analyticsExcluded(userId: string, distinctId: string | null): Promise<boolean> {
  const cached = exclusionCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.excluded;
  const [row] = await db
    .select({
      optOut: settings.analyticsOptOut,
      erasing: distinctId
        ? sql<boolean>`exists (select 1 from ${analyticsErasures} where ${analyticsErasures.distinctId} = ${distinctId})`
        : sql<boolean>`false`,
    })
    .from(settings)
    .where(eq(settings.userId, userId))
    .limit(1);
  const excluded = Boolean(row?.optOut || row?.erasing);
  exclusionCache.delete(userId);
  if (exclusionCache.size >= EXCLUSION_CACHE_MAX) exclusionCache.delete(exclusionCache.keys().next().value!);
  exclusionCache.set(userId, { excluded, expiresAt: Date.now() + EXCLUSION_TTL_MS });
  return excluded;
}

/** Drops the cached answer after the account changes its choice on this instance. */
export function forgetAnalyticsExclusion(userId: string): void {
  exclusionCache.delete(userId);
}

/**
 * Moves the answer defaults onto providers that have a key and reports whether setup is complete.
 * Runs when the app opens and after keys change, so a key saved for any provider is used at once.
 */
export async function alignDefaults(userId: string): Promise<{ settings: Settings; complete: boolean }> {
  const [current, keyed] = await Promise.all([ensureSettings(userId), keyedProviders(userId)]);
  const usable = usableDefaults(current, keyed);
  const changed = usable.llmModel !== current.llmModel || usable.defaultSearchProvider !== current.defaultSearchProvider;
  const settings = changed ? await updateSettings(userId, usable) : current;
  return { settings, complete: setupState(keyed).complete };
}

/** Updates the answer defaults. The analytics objection has its own path (setAnalyticsOptOut). */
export async function updateSettings(
  userId: string,
  patch: Partial<Omit<Settings, "analyticsOptOut">>,
): Promise<Settings> {
  const current = await ensureSettings(userId);
  const next: Settings = {
    ...current,
    ...patch,
    llmModel: patch.llmModel && isAllowedModel(patch.llmModel) ? patch.llmModel : current.llmModel,
    defaultSearchProvider:
      patch.defaultSearchProvider && isSearchProvider(patch.defaultSearchProvider)
        ? patch.defaultSearchProvider
        : current.defaultSearchProvider,
  };
  const [row] = await db
    .update(settings)
    .set({
      llmModel: next.llmModel,
      defaultSearchProvider: next.defaultSearchProvider,
      defaultMode: next.defaultMode,
      updatedAt: new Date(),
    })
    .where(eq(settings.userId, userId))
    .returning();
  return mapSettings(row);
}

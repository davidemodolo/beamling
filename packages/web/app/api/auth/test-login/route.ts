import { db } from "@/lib/server/db";
import { appUrl, isFakeProviders } from "@/lib/server/env";
import { ApiError, errorResponse, json } from "@/lib/server/http";
import { ensureSettings } from "@/lib/server/repo";
import { users } from "@/lib/server/schema";
import { createSession, getCurrentUser } from "@/lib/server/session";
import { ensureWorkspaceKey } from "@/lib/server/workspace-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Test-only sign-in. Disabled unless explicitly enabled on a localhost app URL. */
export async function POST() {
  try {
    return await testLogin();
  } catch (error) {
    return errorResponse(error);
  }
}

async function testLogin() {
  const local = new URL(appUrl()).hostname === "localhost";
  if (process.env.BEAMLING_TEST_AUTH !== "1" || !local || !isFakeProviders()) {
    throw new ApiError("NOT_FOUND", "Not found.", 404);
  }
  const existing = await getCurrentUser();
  if (existing) return json({ ok: true });
  const suffix = crypto.randomUUID();
  const [user] = await db
    .insert(users)
    .values({ googleSub: `e2e-${suffix}`, email: `${suffix}@e2e.beamling.local`, emailVerified: true, name: "E2E Test" })
    .returning({ id: users.id });
  await ensureSettings(user.id);
  await ensureWorkspaceKey(user.id);
  await createSession(user.id);
  return json({ ok: true });
}

import { cache } from "react";
import { redirect } from "next/navigation";
import { LEGAL_VERSION } from "../legal";
import type { SessionUser } from "./session";
import { getCurrentUser } from "./session";

/**
 * The session user of the current request, read once per render. Null when signed out or when the
 * database is down, so `/` can still show the landing page.
 */
export const pageUser = cache(async (): Promise<SessionUser | null> => getCurrentUser().catch(() => null));

/** The signed-in user of an app page. Accounts that have not accepted the current terms go to /welcome first. */
export async function requirePageUser(returnTo: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (user.termsVersion !== LEGAL_VERSION) redirect(`/welcome?next=${encodeURIComponent(returnTo)}`);
  return user;
}

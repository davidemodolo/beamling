import { redirect } from "next/navigation";
import type { SessionUser } from "./session";
import { getCurrentUser } from "./session";

export async function requirePageUser(returnTo: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return user;
}

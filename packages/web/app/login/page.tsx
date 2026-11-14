import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { Wordmark } from "@/components/wordmark";
import { redirect } from "next/navigation";
import { getPublicShutdown } from "@/lib/server/repo";
import { getCurrentUser } from "@/lib/server/session";
import { isClosed, shutdownDateLabel } from "@/lib/server/shutdown";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const params = await searchParams;
  const next = params.next && /^\/(onboarding|chat\/[0-9a-f-]{36})?$/i.test(params.next) ? params.next : "/";
  const shutdown = await getPublicShutdown().catch(() => null);
  const closed = isClosed(shutdown);
  return (
    <div className="onboard-shell">
      <header className="onboard-top">
        <Wordmark />
      </header>
      <main className="onboard-main">
        <section className="onboard-step" aria-labelledby="login-title">
          <span className="badge badge-beam" style={{ width: "fit-content" }}>Sign in</span>
          <h1 id="login-title">A little light on every answer.</h1>
          <p className="lead">
            Beamling keeps your keys and conversations behind a Google account. No passwords, no newsletters,
            no guest workspaces.
          </p>
          {shutdown ? (
            <p className="service-notice" role="status" style={{ borderRadius: 8, border: 0 }}>
              {closed
                ? "Beamling has shut down and every account has been deleted. Thank you for using it."
                : `Beamling shuts down on ${shutdownDateLabel(shutdown.scheduledAt)}. New accounts are no longer accepted; existing users can sign in to download their data until then.`}
            </p>
          ) : null}
          {params.error ? (
            <p className="validation-err" role="alert">
              {params.error === "signups_paused"
                ? "New sign-ups are paused for a while. Try again in an hour."
                : params.error === "signup_not_invited"
                  ? "This alpha is invite-only. Ask the operator for an invitation."
                  : params.error === "login_rate_limited"
                    ? "Too many sign-in attempts. Wait a few minutes and try again."
                    : params.error === "auth_unavailable"
                      ? "Google sign-in is temporarily unavailable. Try again shortly or check the status page."
                      : params.error === "service_closing"
                        ? "Beamling is shutting down and no longer accepts new accounts."
                        : params.error === "service_closed"
                          ? "Beamling has shut down."
                          : "Sign-in did not complete. Try again."}
            </p>
          ) : null}
          {closed ? null : (
            <a className="btn btn-primary btn-lg" href={`/api/auth/login?next=${encodeURIComponent(next)}`}>
              Continue with Google
            </a>
          )}
          <p className="hint">
            Before you start, you will be asked to accept the <Link href="/terms">Terms</Link> and{" "}
            <Link href="/privacy">Privacy notice</Link>. Beamling is for people aged 18 and over. Need help?{" "}
            <Link href="/contact">Contact us</Link>.
          </p>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}

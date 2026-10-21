import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/chat");
  const params = await searchParams;
  const next = params.next && /^\/(chat|onboarding)/.test(params.next) ? params.next : "/chat";
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
          {params.error ? (
            <p className="validation-err" role="alert">Sign-in did not complete. Try again.</p>
          ) : null}
          <a className="btn btn-primary btn-lg" href={`/api/auth/login?next=${encodeURIComponent(next)}`}>
            Continue with Google
          </a>
          <p className="hint">
            By continuing you agree to the <Link href="/terms">Terms</Link> and{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}

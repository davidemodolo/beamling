import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LegalFooter } from "@/components/legal-footer";
import { TermsAcceptance } from "@/components/terms-acceptance";
import { Wordmark } from "@/components/wordmark";
import { LEGAL_LAST_UPDATED, LEGAL_VERSION, MINIMUM_AGE } from "@/lib/legal";
import { getCurrentUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Terms", robots: { index: false, follow: false } };

const NEXT_PATH = /^\/(onboarding|chat\/[0-9a-f-]{36})?$/i;

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = params.next && NEXT_PATH.test(params.next) ? params.next : "/";
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (user.termsVersion === LEGAL_VERSION) redirect(next);
  const updated = user.termsVersion !== null;
  return (
    <div className="onboard-shell">
      <header className="onboard-top">
        <Wordmark />
      </header>
      <main className="onboard-main">
        <section className="onboard-step" aria-labelledby="welcome-title">
          <span className="badge badge-beam" style={{ width: "fit-content" }}>
            {updated ? "Updated terms" : "Before you start"}
          </span>
          <h1 id="welcome-title">{updated ? "Our terms have changed." : "A few things to agree on."}</h1>
          <p className="lead">
            {updated
              ? `The terms and privacy notice were updated on ${LEGAL_LAST_UPDATED}. Review them and accept to keep using Beamling.`
              : "Beamling is free, open source and runs on your own keys."}
          </p>
          <ul className="hint" style={{ display: "grid", gap: 6, paddingLeft: 18 }}>
            <li>Answers are AI-generated and can be wrong. Check the sources.</li>
            <li>You are responsible for your provider keys, their terms and what they charge.</li>
            <li>Your data is encrypted; export or delete it any time.</li>
          </ul>
          <TermsAcceptance version={LEGAL_VERSION} next={next} minimumAge={MINIMUM_AGE} />
          <p className="hint">
            Don&apos;t want to continue? You can <Link href="/contact">contact us</Link>, or sign out; accounts that never
            accept are deleted after seven days.
          </p>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}

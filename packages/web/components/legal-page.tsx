import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { Wordmark } from "@/components/wordmark";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";

export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="legal-shell">
      <header className="legal-top">
        <Wordmark />
        <span style={{ flex: 1 }} />
        <Link href="/" className="btn btn-secondary btn-sm">
          Back to Beamling
        </Link>
      </header>
      <main className="legal">
        <h1>{title}</h1>
        <p className="updated">Alpha · last updated {LEGAL_LAST_UPDATED}</p>
        {intro ? <p>{intro}</p> : null}
        {children}
      </main>
      <LegalFooter />
    </div>
  );
}

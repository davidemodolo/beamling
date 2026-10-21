import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { Wordmark } from "@/components/wordmark";

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
        <Link href="/chat" className="btn btn-secondary btn-sm">
          Back to chat
        </Link>
      </header>
      <main className="legal">
        <h1>{title}</h1>
        <p className="updated">Alpha · last updated 21 October 2026</p>
        {intro ? <p>{intro}</p> : null}
        {children}
      </main>
      <LegalFooter />
    </div>
  );
}

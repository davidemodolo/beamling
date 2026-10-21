import Link from "next/link";

export function LegalFooter() {
  return (
    <footer className="legal-foot">
      <nav aria-label="Legal and project links">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/cookies">Cookies</Link>
        <Link href="/subprocessors">Subprocessors</Link>
        <Link href="/security">Security</Link>
        <Link href="/status">Status</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/licenses">Licenses</Link>
      </nav>
      <span>© 2026 Beamling. The application source is proprietary.</span>
    </footer>
  );
}

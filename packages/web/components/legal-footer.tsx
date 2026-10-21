import Link from "next/link";
import { SOURCE_URL } from "@/lib/legal";

export function LegalFooter() {
  return (
    <footer className="legal-foot">
      <nav aria-label="Legal and project links">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/cookies">Cookies</Link>
        <Link href="/subprocessors">Data processors</Link>
        <Link href="/security">Security</Link>
        <Link href="/status">Status</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/licenses">Licenses</Link>
      </nav>
      <span>
        Beamling is open source under the <a href={`${SOURCE_URL}/blob/main/LICENSE`}>MIT License</a>.
      </span>
    </footer>
  );
}

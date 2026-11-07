import Link from "next/link";
import { Mascot } from "@/components/mascot";
import { Icon } from "@/components/ui/icon";
import { SOURCE_URL } from "@/lib/legal";
import { versionLabel } from "@/lib/version";
import { LLM_NAMES, SEARCH_NAMES } from "./landing-data";

export function Brand() {
  return (
    <Link href="/" className="l-brand" aria-label="Beamling home">
      <span className="l-brand-mark" aria-hidden="true">
        <Mascot expression="curious" beams={false} label="" style={{ width: 24 }} />
      </span>
      Beamling
    </Link>
  );
}

export function ProviderPills() {
  return (
    <div className="l-providers">
      <div className="l-provider-row">
        <span className="l-provider-label">Models</span>
        <div className="l-pills">
          {LLM_NAMES.map((name) => (
            <span className="l-pill" key={name}>
              {name}
            </span>
          ))}
        </div>
      </div>
      <div className="l-provider-row">
        <span className="l-provider-label">Search</span>
        <div className="l-pills">
          {SEARCH_NAMES.map((name) => (
            <span className="l-pill" key={name}>
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="l-footer">
      <div className="lp-container l-footer-grid">
        <div className="l-footer-brand">
          <Brand />
          <p>Answers you can check.</p>
        </div>
        <div>
          <h3>Product</h3>
          <a href="#free">Setup</a>
          <a href="#how">How it works</a>
          <a href="#faq">FAQ</a>
          <a href={SOURCE_URL}>Source code</a>
        </div>
        <div>
          <h3>Trust</h3>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/cookies">Cookies</Link>
          <Link href="/subprocessors">Data processors</Link>
          <Link href="/security">Security</Link>
          <Link href="/status">Status</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/licenses">Licenses</Link>
        </div>
      </div>
      <div className="lp-container l-footer-base">
        <span>© 2026 Beamling</span>
        <span className="l-footer-note">
          <Icon name="lock" size={11} /> Your keys. Your models. Clear answers.
        </span>
        <span>{versionLabel()}</span>
      </div>
    </footer>
  );
}

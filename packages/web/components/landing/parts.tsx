import Link from "next/link";
import { Mascot } from "@/components/mascot";
import { Icon } from "@/components/ui/icon";
import { LLM_NAMES, SEARCH_NAMES } from "./data";

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
          <p>A little light on every answer. Free at launch, with your own keys.</p>
        </div>
        <div>
          <h3>Product</h3>
          <a href="#how">How it works</a>
          <a href="#features">Why Beamling</a>
          <a href="#providers">Providers</a>
          <Link href="/chat">Open the app</Link>
        </div>
        <div>
          <h3>Trust</h3>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>Keys encrypted at rest</span>
          <span>No training on your data</span>
        </div>
        <div>
          <h3>Get started</h3>
          <Link href="/chat">Open app</Link>
          <Link href="/onboarding">Connect a key</Link>
          <span>Made for the open web</span>
        </div>
      </div>
      <div className="lp-container l-footer-base">
        <span>© 2026 Beamling</span>
        <span className="l-footer-note">
          <Icon name="lock" size={11} /> Your keys. Your models. Clear answers.
        </span>
      </div>
    </footer>
  );
}

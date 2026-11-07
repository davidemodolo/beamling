import Link from "next/link";
import { Mascot } from "@/components/mascot";
import { Icon } from "@/components/ui/icon";
import { SOURCE_URL } from "@/lib/legal";
import { appUrl } from "@/lib/server/env";
import { LandingDemo } from "./demo";
import { FAQ, FREE_STEPS, MODE_CARDS, PRINCIPLES } from "./landing-data";
import { Brand, ProviderPills, SiteFooter } from "./landing-parts";

/** The primary call to action: straight into the app when signed in, the free setup otherwise. */
function MainCta({ signedIn, large }: { signedIn: boolean; large?: boolean }) {
  return (
    <Link href="/chat" className={`l-btn l-btn-solid${large ? " l-btn-lg" : ""}`}>
      {signedIn ? "Open the app" : "Start free"} <Icon name="arrow-right" size={large ? 15 : 13} />
    </Link>
  );
}

export function Landing({ signedIn }: { signedIn: boolean }) {
  const host = new URL(appUrl()).host;
  return (
    <div className="lp">
      <nav className="lp-nav" aria-label="Main">
        <div className="lp-container l-nav-row">
          <Brand />
          <div className="l-links">
            <a href="#free">Free setup</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="l-actions">
            {signedIn ? null : (
              <Link href="/login" className="l-btn l-btn-ghost">
                Sign in
              </Link>
            )}
            <MainCta signedIn={signedIn} />
          </div>
        </div>
      </nav>

      <main>
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <span className="l-eyebrow">Free · open source</span>
              <h1>
                Answers you can <em>check.</em>
              </h1>
              <p className="lp-lead">
                Web answers where every claim links to its source. Runs on your own keys, free to start.
              </p>
              <div className="l-cta">
                <MainCta signedIn={signedIn} large />
                <a href="#how" className="l-btn l-btn-ghost l-btn-lg">
                  See how it works
                </a>
              </div>
              <ul className="lp-checks">
                <li>
                  <Icon name="check" size={13} /> Free
                </li>
                <li>
                  <Icon name="check" size={13} /> Encrypted keys
                </li>
                <li>
                  <Icon name="check" size={13} /> MIT licensed
                </li>
              </ul>
            </div>
            <div className="lp-hero-demo">
              <LandingDemo host={host} />
            </div>
          </div>
        </section>

        <section className="lp-section" id="free">
          <div className="lp-container">
            <div className="lp-head">
              <span className="l-eyebrow">Start free</span>
              <h2>Start free in three steps.</h2>
            </div>
            <ol className="lp-free">
              {FREE_STEPS.map((step, index) => (
                <li key={step.title}>
                  <span className="lp-free-num">{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <div className="lp-free-foot">
                    <span className="lp-tag">{step.cost}</span>
                    {step.href ? (
                      <a href={step.href} target="_blank" rel="noopener noreferrer">
                        Open <Icon name="external" size={11} />
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            <div className="l-cta lp-section-cta">
              <MainCta signedIn={signedIn} large />
              <span className="lp-note">Or use your paid keys.</span>
            </div>
          </div>
        </section>

        <section className="lp-section" id="how">
          <div className="lp-container">
            <div className="lp-head">
              <span className="l-eyebrow">How it works</span>
              <h2>Three modes.</h2>
            </div>
            <div className="lp-modes">
              {MODE_CARDS.map((card) => (
                <article key={card.mode} className="lp-mode">
                  <span className="lp-mode-icon">
                    <Icon name={card.icon} size={17} />
                  </span>
                  <h3>{card.label}</h3>
                  <p className="lp-mode-hint">{card.hint}</p>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section" id="trust">
          <div className="lp-container lp-trust">
            <div className="lp-head">
              <span className="l-eyebrow">Built to be checked</span>
              <h2>Quiet interface. Loud evidence.</h2>
            </div>
            <div className="lp-principles">
              {PRINCIPLES.map((item) => (
                <article key={item.title}>
                  <Icon name={item.icon} size={17} />
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section" id="providers">
          <div className="lp-container lp-providers">
            <div className="lp-head">
              <span className="l-eyebrow">Providers</span>
              <h2>Use the accounts you already have.</h2>
              <p>Requests go straight to your provider.</p>
            </div>
            <ProviderPills />
          </div>
        </section>

        <section className="lp-section" id="faq">
          <div className="lp-container lp-faq">
            <div className="lp-head">
              <span className="l-eyebrow">FAQ</span>
              <h2>Good questions.</h2>
              <p>
                More in the <a href={SOURCE_URL}>source</a>, or <Link href="/contact">get in touch</Link>.
              </p>
            </div>
            <div className="lp-faq-list">
              {FAQ.map((item) => (
                <details key={item.q}>
                  <summary>
                    {item.q}
                    <Icon name="plus" size={14} />
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-final">
          <div className="lp-container">
            <div className="lp-final-inner">
              <div>
                <h2>Ask your first question.</h2>
                <p>Free and open source.</p>
                <div className="l-cta">
                  <MainCta signedIn={signedIn} large />
                </div>
              </div>
              <div className="lp-final-mark" aria-hidden="true">
                <Mascot expression="happy" beams={false} label="" style={{ width: "100%" }} />
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

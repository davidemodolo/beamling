import Link from "next/link";
import { Mascot } from "@/components/mascot";
import { Icon } from "@/components/ui/icon";
import { LandingDemo } from "./demo";
import { FEATURES, STATS, STEPS } from "./landing-data";
import { Brand, ProviderPills, SiteFooter } from "./landing-parts";
import { appUrl } from "@/lib/server/env";

export function CinematicLanding() {
  const host = new URL(appUrl()).host;
  return (
    <div className="lp v1">
      <nav className="lp-nav">
        <div className="lp-container l-nav-row">
          <Brand />
          <div className="l-links">
            <a href="#how">How it works</a>
            <a href="#features">Why Beamling</a>
            <a href="#providers">Providers</a>
          </div>
          <div className="l-actions">
            <Link href="/chat" className="l-btn l-btn-ghost">
              Open app
            </Link>
            <Link href="/onboarding" className="l-btn l-btn-solid">
              Start free
            </Link>
          </div>
        </div>
      </nav>

      <main>
        <section className="v1-hero">
          <div className="lp-container v1-hero-inner">
            <span className="l-eyebrow">Bring your own key · Free at launch</span>
            <div className="v1-mark" aria-hidden="true">
              <Mascot expression="neutral" beams={false} followPointer label="" style={{ width: "100%" }} />
            </div>
            <span className="v1-mark-caption">Two eyes made of light</span>
            <h1>
              A little light on <em>every answer.</em>
            </h1>
            <p className="v1-lead">
              Ask anything. Beamling searches with your keys, works through the results, and shows you exactly where each answer
              comes from. Your models. Your search. Your bill.
            </p>
            <div className="l-cta">
              <Link href="/onboarding" className="l-btn l-btn-solid l-btn-lg">
                Ask your first question <Icon name="arrow-right" size={15} />
              </Link>
              <a href="#how" className="l-btn l-btn-ghost l-btn-lg">
                See how it works
              </a>
            </div>
          </div>
        </section>

        <section className="v1-demo">
          <div className="lp-container">
            <LandingDemo host={host} />
          </div>
        </section>

        <section className="v1-stats">
          <div className="lp-container v1-stats-grid">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="v1-section" id="how">
          <div className="lp-container">
            <div className="v1-section-head">
              <span className="l-eyebrow">Three steps</span>
              <h2>From a key to a cited answer.</h2>
            </div>
            <div className="v1-steps">
              {STEPS.map((step, index) => (
                <div className="v1-step" key={step.title}>
                  <span className="v1-step-num">0{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="v1-section" id="features">
          <div className="lp-container">
            <div className="v1-section-head">
              <span className="l-eyebrow">Product principles</span>
              <h2>Quiet interface. Loud evidence.</h2>
            </div>
            <div className="v1-cards">
              {FEATURES.map((feature) => (
                <article className="v1-card" key={feature.title}>
                  <span className="v1-card-icon">
                    <Icon name={feature.icon} size={18} />
                  </span>
                  <span className="v1-card-num">{feature.label}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="v1-section" id="providers">
          <div className="lp-container v1-providers">
            <div>
              <span className="l-eyebrow">Launch providers</span>
              <h2>Use the accounts you already pay for.</h2>
              <p>
                Beamling never proxies model or search traffic through a shared account. A provider is listed only after its
                adapter passes validation, streaming and cost-estimation tests.
              </p>
            </div>
            <ProviderPills />
          </div>
        </section>

        <section className="v1-cta">
          <div className="lp-container">
            <div className="v1-cta-inner">
              <div>
                <span className="l-eyebrow">Free at launch</span>
                <h2>Ask. See the sources.</h2>
                <p>No subscription, no bundled tokens. Connect a key and start in under three minutes.</p>
                <div className="l-cta">
                  <Link href="/onboarding" className="l-btn l-btn-solid l-btn-lg">
                    Start free <Icon name="arrow-right" size={15} />
                  </Link>
                  <Link href="/chat" className="l-btn l-btn-ghost l-btn-lg">
                    Open app
                  </Link>
                </div>
              </div>
              <div className="v1-cta-mark" aria-hidden="true">
                <Mascot expression="happy" beams={false} label="" style={{ width: 150 }} />
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

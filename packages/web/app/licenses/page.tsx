import type { Metadata } from "next";
import Link from "next/link";
import licenseData from "@/lib/generated/licenses.json";
import { LegalFooter } from "@/components/legal-footer";
import { Wordmark } from "@/components/wordmark";
import { SOURCE_URL } from "@/lib/legal";

export const metadata: Metadata = { title: "Open-source licenses" };

const groups = [...new Set(licenseData.packages.map((entry) => entry.license))].sort();
export default function LicensesPage() {
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
        <h1>Open-source licenses</h1>
        <p className="updated">Generated from the production dependency graph</p>
        <p>
          Beamling is open source under the <a href={`${SOURCE_URL}/blob/main/LICENSE`}>MIT License</a>: you may use,
          copy, modify, distribute and sell it, provided the copyright and license notice are kept. The source is at{" "}
          <a href={SOURCE_URL}>{SOURCE_URL.replace("https://", "")}</a>. Beamling also uses the third-party open-source
          packages below, each under its own license.
        </p>
        <p>
          This page lists {licenseData.packages.length} installed production packages, their versions, license,
          project link and copyright notices. CI checks every license against a reviewed allowlist.
        </p>

        <h2>Reviewed policy</h2>
        <p>
          Allowed licenses: {licenseData.policy.allowed.join(", ")}. Each reviewed exception is listed with the
          package it covers.
        </p>
        <ul>
          {licenseData.policy.exceptions.map((exception) => (
            <li key={exception.license}>
              <strong>{exception.license}</strong> ({exception.packages.join(", ")}): {exception.reason}
            </li>
          ))}
        </ul>

        {groups.map((license) => {
          const entries = licenseData.packages.filter((entry) => entry.license === license);
          return (
            <section className="license-group" key={license}>
              <h2>
                {license} <span className="license-count">{entries.length}</span>
              </h2>
              <ul className="license-list">
                {entries.map((entry) => (
                  <li className="license-item" key={`${entry.name}-${entry.license}`}>
                    <div className="license-item-head">
                      <span className="license-name">{entry.name}</span>
                      <span className="license-version">{entry.versions.join(", ")}</span>
                      <a href={entry.homepage ?? `https://www.npmjs.com/package/${entry.name}`}>Project</a>
                    </div>
                    {entry.notice ? <p className="license-notice">{entry.notice}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <h2>License texts</h2>
        {licenseData.licenseTexts.map((entry) => (
          <details className="license-text" key={entry.license}>
            <summary>{entry.license}</summary>
            <pre>{entry.text}</pre>
          </details>
        ))}
      </main>
      <LegalFooter />
    </div>
  );
}

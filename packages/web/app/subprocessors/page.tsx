import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Subprocessors" };

const SUBPROCESSORS = [
  ["Google Identity", "Sign-in, stable account identifier, verified email, name and profile picture."],
  ["Fly.io", "Application hosting, TLS termination and structured logs."],
  ["Neon", "Managed PostgreSQL database and backups."],
  ["Google Cloud KMS", "Wrapping and unwrapping workspace and credential keys."],
  ["OpenRouter", "Model routing. OpenRouter may select or fail over to upstream model providers."],
  ["Brave Search", "Search results when you choose Brave."],
  ["Tavily", "Search results when you choose Tavily."],
  ["Exa", "Search results when you choose Exa."],
  ["PostHog Cloud", "Optional server-side product analytics, using the EU region by default."],
  ["Error tracking provider", "Optional exception reporting when configured by the operator."],
] as const;

export default function SubprocessorsPage() {
  return (
    <LegalPage
      title="Subprocessors"
      intro="These are the service providers a production Beamling deployment may use to run the product."
    >
      <div className="legal-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map(([name, purpose]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        A deployment may omit optional providers. Your chosen model and search providers receive the prompt, search query
        and the credential needed for that request. OpenRouter may route a request to an upstream model provider. The
        operator must keep a signed data-processing agreement with each provider before processing personal data.
      </p>
      <p>
        For a current list or a data-processing agreement, use the <Link href="/contact">contact page</Link>. See the{" "}
        <Link href="/privacy">privacy policy</Link> for data categories and retention.
      </p>
    </LegalPage>
  );
}

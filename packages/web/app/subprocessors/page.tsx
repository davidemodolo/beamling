import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { legalDetails } from "@/lib/legal";

export const metadata: Metadata = { title: "Data processors" };

/** Processors the operator uses to run Beamling, under a data-processing agreement. */
const PROCESSORS = [
  ["Google Cloud", "Application hosting (Cloud Run), TLS termination and logs; Cloud KMS wraps and unwraps encryption keys and receives no content or account data.", "Belgium (hosting, logs) and Frankfurt, Germany (KMS) (company in the US)", "https://cloud.google.com/terms/cloud-privacy-notice"],
  ["Neon", "Managed PostgreSQL database and backups. Content and keys are stored encrypted.", "Frankfurt, Germany (company in the US)", "https://neon.com/privacy-policy"],
  ["PostHog Cloud (optional)", "Server-side product analytics: metadata only, linked to a keyed hash.", "EU region (company in the US)", "https://posthog.com/privacy"],
] as const;

/** Providers the user chooses and connects with their own account and key. */
const USER_PROVIDERS = [
  ["Google", "Sign-in. Google shares your account identifier, verified email, name and picture with Beamling.", "Global", "https://policies.google.com/privacy"],
  ["OpenRouter", "Model routing. Receives your question, retrieved snippets and conversation context, and may route them to an upstream model provider.", "United States and upstream providers' locations, which can include China", "https://openrouter.ai/privacy"],
  ["DeepSeek", "Models and search, when you choose DeepSeek. Receives your question, search queries, retrieved snippets and conversation context.", "China", "https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html"],
  ["Brave Search", "Search, when you choose Brave. Receives search queries.", "United States", "https://search.brave.com/help/privacy-policy"],
  ["Tavily", "Search, when you choose Tavily. Receives search queries.", "United States", "https://tavily.com/privacy"],
  ["Exa", "Search, when you choose Exa. Receives search queries.", "United States", "https://exa.ai/privacy-policy"],
] as const;

function ProviderTable({ rows }: { rows: readonly (readonly [string, string, string, string])[] }) {
  return (
    <div className="legal-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Purpose and data</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, purpose, location, policy]) => (
            <tr key={name}>
              <td>
                <a href={policy}>{name}</a>
              </td>
              <td>{purpose}</td>
              <td>{location}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SubprocessorsPage() {
  const { mailProvider } = legalDetails();
  const processors = mailProvider
    ? [
        ...PROCESSORS,
        [
          `${mailProvider} (email)`,
          "Delivers essential service notices, such as a closure notice. Receives your email address and the notice text only.",
          "As stated by the provider",
          "/contact",
        ] as const,
      ]
    : PROCESSORS;
  return (
    <LegalPage title="Data processors" intro="Who processes data when you use Beamling. Each name links to that provider's privacy policy.">
      <h2>Processors that run Beamling</h2>
      <p>
        These providers process personal data on behalf of the operator, under a data-processing agreement (Art. 28 GDPR).
        Transfers outside the European Economic Area rely on the EU-US Data Privacy Framework or on standard contractual
        clauses.
      </p>
      <ProviderTable rows={processors} />

      <h2>Providers you choose</h2>
      <p>
        You connect these services with your own account and key. Beamling sends them data only when you sign in or ask a
        question, at your instruction. They act under their own terms and privacy policies, which govern your relationship
        with them, including how long they keep requests and whether they use them for training.
      </p>
      <ProviderTable rows={USER_PROVIDERS} />

      <p>
        For a copy of a data-processing agreement or transfer safeguard, use the <Link href="/contact">contact page</Link>.
        See the <Link href="/privacy">privacy notice</Link> for data categories and retention.
      </p>
    </LegalPage>
  );
}

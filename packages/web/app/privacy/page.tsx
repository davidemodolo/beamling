import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { legalDetails } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  const legal = legalDetails();
  const contactConfigured = legal.contactEmail.includes("@");
  return (
    <LegalPage
      title="Privacy"
      intro="Beamling is a hosted answer engine with bring-your-own-key credentials. This page explains what a production deployment collects, why, and how to exercise your rights."
    >
      <h2>Controller</h2>
      <p>
        The controller for this deployment is <strong>{legal.entity}</strong>
        {legal.address ? `, ${legal.address}` : ""}. Privacy requests go to{" "}
        {contactConfigured ? (
          <a href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a>
        ) : (
          "the monitored contact once this deployment configures one"
        )}
        .
      </p>

      <h2>What we collect and why</h2>
      <ul>
        <li>
          <strong>Account data from Google:</strong> stable account identifier, verified email address, and any name or
          profile picture Google returns. Used to create and secure your account (contract).
        </li>
        <li>
          <strong>Session data:</strong> a random session token in an HttpOnly cookie. Only its SHA-256 hash is stored on
          the server. Used to keep you signed in and to revoke access (contract and security).
        </li>
        <li>
          <strong>Content:</strong> conversations, messages and retrieved sources, encrypted at rest. Used to provide the
          answer service (contract).
        </li>
        <li>
          <strong>Credentials:</strong> encrypted provider keys, a short fingerprint, the last four characters, and the
          last validation time. Plaintext keys are never stored or returned to the browser (contract and security).
        </li>
        <li>
          <strong>Usage:</strong> token counts, model, recorded cost and latency. Retained with your conversations until
          deleted (contract).
        </li>
        <li>
          <strong>Product analytics when enabled:</strong> metadata such as mode, search provider, model, token counts,
          estimated cost, latency and error codes, linked to a keyed hash of your account identifier. Questions, answers,
          titles, source content, keys, email addresses and IP addresses are not sent. Used for product improvement
          (legitimate interests, with an operator kill switch).
        </li>
        <li>
          <strong>Logs:</strong> structured error and security logs intended to exclude keys, session tokens, request
          bodies, questions and answers. Retention and access are configured at the hosting provider (security and
          legitimate interests).
        </li>
      </ul>

      <h2>Your keys and provider traffic</h2>
      <p>
        Model and search traffic goes from Beamling to the provider you chose, using your key. For model calls this means
        OpenRouter, which may select or fail over to an upstream model provider. For search this means Brave, Tavily or Exa.
        Those providers process the prompt, search query and related metadata under their own terms and privacy policies.
        Beamling does not route your traffic through a shared provider account, sell it, or use it to train models.
      </p>
      <p>
        Keys are encrypted with envelope encryption using a managed KMS master key and decrypted only inside the request
        that needs them.
      </p>

      <h2>Cookies</h2>
      <p>
        Beamling uses two essential cookies: a session cookie and a short-lived sign-in transaction cookie. Both are
        HttpOnly, SameSite=Lax, Secure in production, and are not used for advertising. See the{" "}
        <Link href="/cookies">cookie policy</Link> for names and lifetimes.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Your account and conversations stay until you delete them. Signing in again does not create a new workspace.
        Sessions expire after 30 days without use; expired sessions are deleted, but the account and its content remain so
        that you can sign in again. Deleting your account hard-deletes the account, conversations, messages, sources,
        credentials, usage records and workspace encryption key immediately. When product analytics is configured, account
        deletion also queues deletion of the hashed analytics person and its events. Provider-slot and rate-limit metadata
        can remain for up to one hour. Logs and database backups are retained according to the hosting provider&apos;s
        configured policy; backups, when enabled, contain ciphertext and the operator must configure a retention window.
      </p>

      <h2>Subprocessors and international transfers</h2>
      <p>
        The <Link href="/subprocessors">subprocessor list</Link> names the providers a production deployment may use.
        Some providers process data outside the European Economic Area. Where required, the operator relies on an
        adequacy decision or standard contractual clauses and keeps a data-processing agreement with each provider.
      </p>

      <h2>Your rights</h2>
      <p>
        Subject to applicable law, you may request access, rectification, erasure, restriction, portability, or object to
        processing based on legitimate interests. You may also withdraw consent where processing relies on consent. Use the{" "}
        <Link href="/contact">contact page</Link> to make a request. You have the right to complain to the competent
        supervisory authority in your country; in Italy this is the Garante per la protezione dei dati personali.
      </p>
      <p>Beamling does not sell personal data or share it for cross-context behavioural advertising.</p>

      <h2>Changes</h2>
      <p>
        Material changes to this notice will be published before they take effect. The date at the top of the page shows
        the current version.
      </p>
    </LegalPage>
  );
}

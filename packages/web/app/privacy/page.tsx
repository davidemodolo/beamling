import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
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
        <h1>Privacy</h1>
        <p className="updated">Alpha · last updated 21 October 2026</p>
        <p>
          Beamling is a hosted answer engine with bring-your-own-key credentials. We keep the product small, and we keep the
          data we hold small too. This page describes what Beamling collects when you sign in with Google and use the
          service.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            Account data from Google: the stable Google account identifier, verified email address, and any name or profile
            picture Google returns.
          </li>
          <li>Session data: a random session token in an HttpOnly cookie. Only its SHA-256 hash is stored on the server.</li>
          <li>Content: conversations, messages and retrieved sources.</li>
          <li>
            Credentials: encrypted provider keys, a short fingerprint, the last four characters, and the last validation time.
            Plaintext keys are never stored or returned to the browser.
          </li>
          <li>Usage: token counts, model, recorded cost and latency. Retained with your conversations until deleted.</li>
          <li>
            Logs: structured error and security logs without keys, session tokens, request bodies or message text, kept for
            at most 30 days.
          </li>
        </ul>

        <h2>Your keys</h2>
        <p>
          Model and search traffic goes directly from Beamling to the provider you chose, using your key. We do not route it
          through a shared account, sell it, or use it to train models. Keys are encrypted with envelope encryption using a
          managed KMS master key and decrypted only inside the request that needs them.
        </p>

        <h2>Cookies</h2>
        <p>
          Beamling uses two essential cookies: a session cookie and a short-lived sign-in transaction cookie. Both are
          HttpOnly, SameSite=Lax, Secure in production, and are not used for advertising or analytics.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Your account and conversations stay until you delete them. Signing in again does not create a new workspace.
          Sessions expire after 30 days without use; expired sessions are deleted, but the account and its content remain
          so that you can sign in again. Deleting your account hard-deletes the account, conversations, messages, sources,
          credentials, usage records and workspace encryption key immediately. When database backups are enabled, they expire within 30 days.
        </p>

        <h2>Subprocessors</h2>
        <p>
          A production deployment uses Google for sign-in, a hosting platform, a managed Postgres database, OpenRouter,
          the search providers you choose (Brave, Tavily or Exa), a managed KMS master-key provider and optional error tracking. There is no email provider or
          advertising network in Alpha 1.
        </p>

        <h2>Contact</h2>
        <p>
          Privacy questions and data requests: the monitored contact published with your Beamling invitation or on the
          deployment&apos;s sign-in page.
        </p>
      </main>
    </div>
  );
}

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
        <p className="updated">Draft · last updated 20 October 2026</p>
        <p>
          Beamling is a hosted answer engine with bring-your-own-key credentials. We keep the product small, and we keep the
          data we hold small too. This page describes what the Alpha guest workspace collects and stores.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>Workspace data: a random guest identifier and a hashed session token. No email, name or OAuth identity.</li>
          <li>Content: conversations, messages and retrieved sources.</li>
          <li>Credentials: encrypted provider keys, a masked fingerprint, and the last validation time. Plaintext keys are never stored or returned.</li>
          <li>Usage: token counts, model, recorded cost and latency. Retained with your conversations until deleted.</li>
          <li>Logs: structured application logs for 30 days, with secrets and headers redacted.</li>
        </ul>

        <h2>Your keys</h2>
        <p>
          Model and search traffic goes directly from Beamling to the provider you chose, using your key. We do not route it
          through a shared account, sell it, or use it to train models. Keys are encrypted with envelope encryption and
          decrypted only inside the request that needs them.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Conversations stay until you delete them. Deleting the workspace hard-deletes conversations, messages, sources,
          credentials and usage records. Backups expire within 30 days.
        </p>

        <h2>Subprocessors</h2>
        <p>
          A production deployment uses a hosting platform, a managed Postgres database, OpenRouter, Brave Search, a
          master-key provider and optional error tracking. There is no email provider in Alpha 1.
        </p>

        <h2>Contact</h2>
        <p>
          Privacy questions and data requests: the monitored alpha contact published with the beta invite.
        </p>
      </main>
    </div>
  );
}

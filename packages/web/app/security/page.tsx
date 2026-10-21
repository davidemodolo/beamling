import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return (
    <LegalPage title="Security" intro="The controls protecting a Beamling deployment and how to report a problem.">
      <h2>Sign-in and sessions</h2>
      <p>
        Sign-in uses Google OIDC with state, nonce and PKCE. The transaction is encrypted and expires after ten minutes.
        Session tokens are random, stored only as SHA-256 hashes, and delivered in HttpOnly, Secure, SameSite=Lax cookies
        in production. A session expires after 30 days without use and 90 days after sign-in at the latest; signing in
        again replaces the previous session. You can revoke one session or all sessions from Settings.
      </p>

      <h2>Encryption</h2>
      <p>
        Provider credentials and conversation content are encrypted in the application with AES-256-GCM before they reach
        PostgreSQL. Each workspace has its own data key, wrapped by a managed KMS master key. A database dump or backup
        contains ciphertext, not plaintext content. Transport to the database and to public origins uses TLS.
      </p>

      <h2>Access and logging</h2>
      <p>
        Application access is scoped to the signed-in account. Internal operator endpoints require a separate secret of at
        least 32 bytes and expose no user content. Structured logs are intended to exclude keys, session tokens, request
        bodies, questions and answers. Sign-ins, key changes, data exports and account deletions are recorded as audit
        events with a keyed hash of the account and IP address.
      </p>

      <h2>Reporting a vulnerability</h2>
      <p>
        Report vulnerabilities privately through the <Link href="/contact">contact page</Link>; the address is also
        published in <a href="/.well-known/security.txt">security.txt</a>. Include the affected URL, reproduction steps and
        impact. We acknowledge reports within two working days, keep you informed while we fix the issue, and credit you
        when the fix is published if you wish.
      </p>
      <p>
        We will not pursue legal action for research done in good faith that follows these rules: use only your own
        account, keys and data; do not access, change or keep other users&apos; data; do not degrade the service, send
        spam or run denial-of-service or social-engineering tests; and give us reasonable time to fix the issue before
        disclosing it.
      </p>

      <h2>Limits</h2>
      <p>
        Beamling is an alpha service. No service can promise perfect security. This page describes the current controls,
        not a warranty or an independent certification.
      </p>
    </LegalPage>
  );
}

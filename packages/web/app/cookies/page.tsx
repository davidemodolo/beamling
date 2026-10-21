import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Cookies" };

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookies"
      intro="Beamling uses only the cookies needed to sign you in and protect the sign-in flow."
    >
      <h2>Essential cookies</h2>
      <div className="legal-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cookie</th>
              <th>Purpose</th>
              <th>Lifetime</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>__Host-beamling_session</code>
              </td>
              <td>Keeps you signed in. HttpOnly, Secure, SameSite=Lax, host-only.</td>
              <td>30 days without use, at most 90 days after sign-in</td>
            </tr>
            <tr>
              <td>
                <code>__Host-beamling_oidc</code>
              </td>
              <td>Carries the encrypted OIDC state, nonce and PKCE verifier during sign-in.</td>
              <td>10 minutes</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Outside production the cookie names omit the <code>__Host-</code> prefix and may be non-Secure on localhost.
        Deleting cookies in your browser signs you out; the server-side session can also be revoked from Settings.
      </p>

      <h2>No analytics or advertising cookies</h2>
      <p>
        Product analytics, when enabled, runs on the server and sends metadata only. The browser loads no PostHog SDK, no
        advertising network and no non-essential script. There is therefore no cookie banner for optional cookies.
      </p>
      <p>
        See the <Link href="/privacy">privacy policy</Link> for retention and your rights.
      </p>
    </LegalPage>
  );
}

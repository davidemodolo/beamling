import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { legalDetails } from "@/lib/legal";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  const legal = legalDetails();
  const configured = legal.contactEmail.includes("@");
  return (
    <LegalPage title="Contact" intro="How to reach the operator of this Beamling deployment.">
      <h2>Operator</h2>
      <p>{legal.entity}</p>
      {legal.address ? <p>{legal.address}</p> : null}

      <h2>Privacy, data and abuse</h2>
      {configured ? (
        <p>
          Email <a href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a> for privacy requests, account questions,
          security reports and abuse reports. We aim to acknowledge within two working days.
        </p>
      ) : (
        <p>
          This deployment has not configured a monitored contact address. Do not open public sign-ups until{" "}
          <code>LEGAL_CONTACT_EMAIL</code> is set.
        </p>
      )}

      <h2>Security disclosure</h2>
      <p>
        Please report vulnerabilities privately to the contact above. Include the affected URL, a short reproduction and
        whether any personal data is exposed. Do not test against other users&apos; accounts or run destructive load tests.
        See the <Link href="/security">security page</Link> for the current controls.
      </p>

      <h2>Status</h2>
      <p>
        Operational status and planned maintenance are published on the deployment&apos;s status page when one is
        configured. The sign-in page links here during an incident.
      </p>
    </LegalPage>
  );
}

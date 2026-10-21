import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { legalDetails } from "@/lib/legal";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  const legal = legalDetails();
  const email = legal.contactEmail ? (
    <a href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a>
  ) : (
    "the operator"
  );
  return (
    <LegalPage title="Contact" intro="How to reach the operator of this Beamling deployment.">
      <h2>Operator</h2>
      <p>{legal.entity}</p>
      {legal.address ? <p>{legal.address}</p> : null}
      {legal.vatId ? <p>VAT {legal.vatId}</p> : null}

      <h2>Privacy, data and abuse</h2>
      <p>
        Email {email} for privacy requests, account questions, security reports and abuse reports. We acknowledge within
        two working days and answer privacy requests within one month.
      </p>

      <h2>Single point of contact (Digital Services Act)</h2>
      <p>
        The same address is the single point of contact for users and for Member State authorities, the European Commission
        and the European Board for Digital Services under Articles 11 and 12 of Regulation (EU) 2022/2065. We accept
        messages in English. To report illegal content, include where it appears, why you believe it is
        illegal, and your name and email unless the report concerns child sexual abuse material.
      </p>

      <h2>Security disclosure</h2>
      <p>
        Please report vulnerabilities privately to the address above. Include the affected URL, a short reproduction and
        whether any personal data is exposed. See the <Link href="/security">security page</Link> for the disclosure policy.
      </p>

      <h2>Status</h2>
      <p>
        Current service status is on the <Link href="/status">status page</Link>.
      </p>
    </LegalPage>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import {
  CONVERSATION_RETENTION_DAYS,
  INACTIVE_ACCOUNT_MONTHS,
  legalDetails,
  MAX_CONVERSATIONS,
  MINIMUM_AGE,
  SHUTDOWN_NOTICE_DAYS,
  SOURCE_URL,
} from "@/lib/legal";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  const legal = legalDetails();
  return (
    <LegalPage title="Terms" intro="These terms apply to the alpha Beamling deployment operated by the entity below.">
      <h2>Operator</h2>
      <p>
        This deployment is operated by <strong>{legal.entity}</strong>
        {legal.address ? `, ${legal.address}` : ""}
        {legal.vatId ? ` (VAT ${legal.vatId})` : ""}. Contact details are on the <Link href="/contact">contact page</Link>.
      </p>

      <h2>The service</h2>
      <p>
        Beamling provides an interface and pipeline for asking questions against language models and search providers that
        you connect with your own credentials. Beamling charges nothing. Access requires a Google account.
      </p>

      <h2>Who can use Beamling</h2>
      <p>
        You must be at least {MINIMUM_AGE} years old, or the age of majority where you live if that is higher, and able to
        enter into a binding agreement. You accept these terms and the <Link href="/privacy">privacy notice</Link> when you
        first open your workspace, and again whenever they change materially.
      </p>

      <h2>Your provider keys and costs</h2>
      <p>
        Your OpenRouter and search keys belong to your own accounts with those providers. You are responsible for keeping
        those accounts in good standing, for complying with each provider&apos;s terms of service and acceptable-use policy,
        and for every cost they charge. Beamling only sends requests you start, and never switches providers silently on
        your behalf. Use only keys you are entitled to use.
      </p>

      <h2>Alpha availability</h2>
      <p>
        Beamling is an alpha service. Features, limits and providers may change, and the service may be interrupted for
        maintenance or withdrawn. We do not promise uninterrupted availability or a particular level of service. Do not use
        Beamling as the only copy of important content; you can download your data from Settings at any time.
      </p>

      <h2>Storage limits</h2>
      <p>
        Because Beamling is free, it keeps conversations for a limited time. A conversation, pinned or not, is deleted{" "}
        {CONVERSATION_RETENTION_DAYS} days after its last question. Each account keeps at most {MAX_CONVERSATIONS}{" "}
        conversations: starting a new one beyond that deletes the least recently used, unpinned ones first. The interface
        shows these limits and warns you as you approach the maximum.
      </p>

      <h2>Acceptable use</h2>
      <p>You are responsible for the questions you ask and for what you do with the answers. Do not use Beamling to:</p>
      <ul>
        <li>create, request or distribute illegal content, including child sexual abuse material, terrorist content or incitement to violence or hatred;</li>
        <li>harass, threaten, defame or impersonate others, or carry out unlawful surveillance or profiling of individuals;</li>
        <li>infringe intellectual-property, privacy or other rights of third parties;</li>
        <li>develop malware, attack systems or networks, or engage in any practice prohibited by Article 5 of the EU AI Act;</li>
        <li>present generated output as professional medical, legal, financial or other advice;</li>
        <li>use keys or accounts that are not yours, extract other users&apos; data, bypass limits, scrape the service automatically, or resell or share access to your account;</li>
        <li>disrupt the service or the providers it connects to.</li>
      </ul>

      <h2>AI-generated answers</h2>
      <p>
        Answers are generated automatically by third-party AI models chosen by you and are marked as AI-generated in the
        interface. They may be wrong, incomplete, outdated or biased. Citations help you verify claims; they are not a
        guarantee of correctness. Check important information against the sources before relying on it.
      </p>

      <h2>Your content and intellectual property</h2>
      <p>
        You retain ownership of the questions, answers, sources and other content you submit or receive, to the extent
        rights exist in them. You grant the operator a limited licence to store, process and transmit that content only to
        operate the service, including sending it to the providers you selected. The Beamling source code is open source
        under the <a href={`${SOURCE_URL}/blob/main/LICENSE`}>MIT License</a>. The Beamling name and logo are not licensed
        for use in other services. Third-party components are listed on the <Link href="/licenses">licenses page</Link>.
      </p>

      <h2>No warranty</h2>
      <p>
        Beamling is provided free of charge, as is and as available, without warranties of any kind, to the extent
        permitted by law. Nothing in these terms affects the statutory rights you have as a consumer.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent permitted by law, the operator is not liable for indirect or consequential loss, loss of profits, loss
        of data you could have exported, or costs charged by your providers, including costs caused by misuse of your keys
        outside Beamling. Nothing in these terms limits or excludes liability for wilful misconduct or gross negligence
        (Article 1229 of the Italian Civil Code), for death or personal injury, or any other liability
        that cannot be limited under applicable law, including the Italian Consumer Code.
      </p>

      <h2>Suspension and termination</h2>
      <p>
        You can stop using the service and delete your account at any time from Settings. The operator may suspend or close
        an account for a serious breach of these terms, a security risk to the service or other users, or where required by
        law or by an order of an authority. Unless urgency or the law prevents it, the operator will tell you the reason and
        give you a chance to respond and to download your data. Accounts unused for {INACTIVE_ACCOUNT_MONTHS} months are
        deleted, as explained in the <Link href="/privacy">privacy notice</Link>.
      </p>
      <p>
        The operator may close the service entirely. You will be told at least {SHUTDOWN_NOTICE_DAYS} days in advance by
        email and in the interface; during that period new accounts are not accepted and you can still sign in to download
        your data. On the closing date every account is deleted with all its data.
      </p>

      <h2>Your data</h2>
      <p>
        Deleting your account removes its conversations, sources, credentials, settings, sessions, usage records and
        workspace encryption key. See the <Link href="/privacy">privacy notice</Link> for details. Beamling sends email only
        for essential service notices, such as a closure notice; it sends no newsletters or marketing.
      </p>

      <h2>Reports and contact point</h2>
      <p>
        Report illegal content, abuse of the service or a security problem through the <Link href="/contact">contact page</Link>,
        which is also the single point of contact for users and authorities under the EU Digital Services Act.
      </p>

      <h2>Governing law and disputes</h2>
      <p>
        These terms are governed by {legal.governingLaw}. If you are a consumer, you keep the protection of the mandatory
        rules of your country of residence, and disputes may be brought before the courts of the place where you live
        (Article 66-bis of the Italian Consumer Code).
      </p>

      <h2>Changes</h2>
      <p>
        The operator may change these terms to reflect changes to the service, the law or providers. Material changes are
        shown in the interface before they apply, and you are asked to accept them before you continue using Beamling. If
        you do not accept them, you can delete your account and download your data at any time.
      </p>
    </LegalPage>
  );
}

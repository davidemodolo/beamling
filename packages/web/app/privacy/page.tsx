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
  UNACCEPTED_ACCOUNT_DAYS,
} from "@/lib/legal";
import { SESSION_MAX_AGE_DAYS, SESSION_TTL_DAYS } from "@/lib/server/env";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  const legal = legalDetails();
  const contact = legal.contactEmail ? (
    <a href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a>
  ) : (
    <Link href="/contact">the contact page</Link>
  );
  return (
    <LegalPage
      title="Privacy"
      intro="Beamling is a hosted answer engine with bring-your-own-key credentials. This notice explains what personal data the service processes, why, for how long, and how to exercise your rights (Articles 13 and 14 GDPR)."
    >
      <h2>Controller</h2>
      <p>
        The controller is <strong>{legal.entity}</strong>
        {legal.address ? `, ${legal.address}` : ""}
        {legal.vatId ? ` (VAT ${legal.vatId})` : ""}. Write to {contact} for any privacy question or request. No data
        protection officer has been appointed.
      </p>

      <h2>What we process, why, and on what basis</h2>
      <ul>
        <li>
          <strong>Account data from Google:</strong> stable account identifier, verified email address, and any name or
          profile picture Google returns. Used to create and secure your account, and to email you essential service
          notices such as a notice that the service is closing. Legal basis: performance of the contract (Art. 6(1)(b)
          GDPR). Beamling sends no newsletters or marketing email.
        </li>
        <li>
          <strong>Acceptance record:</strong> the version of these documents you accepted and when. Used to prove
          acceptance. Legal basis: legal obligation and legitimate interests (Art. 6(1)(c) and (f)).
        </li>
        <li>
          <strong>Session data:</strong> a random session token in an HttpOnly cookie. Only its SHA-256 hash is stored on
          the server, with its creation and expiry time. Used to keep you signed in and to revoke access. Legal basis:
          contract and security.
        </li>
        <li>
          <strong>Content:</strong> conversations, messages and retrieved sources, encrypted at rest with a key specific to
          your workspace. Images you attach are not stored on the server, only the fact that a message had them. The
          images stay in your browser for 7 days, or until you delete the chat or sign out, so follow-up questions can
          use them. Used to provide the answer service. Legal basis: contract.
        </li>
        <li>
          <strong>Credentials:</strong> your provider keys, encrypted with a managed key-management service, a keyed
          fingerprint, the last four characters, plan, budget settings and last validation time. Plaintext keys are never
          stored or returned to the browser. Legal basis: contract and security.
        </li>
        <li>
          <strong>Usage:</strong> token counts, model, recorded cost and latency per answer, and daily request counts per
          key. Legal basis: contract.
        </li>
        <li>
          <strong>Security metadata:</strong> your IP address, converted on arrival into a keyed hash, to rate-limit abuse
          of sign-in and answers. Legal basis: legitimate interests in keeping the service secure (Art. 6(1)(f)).
        </li>
        <li>
          <strong>Logs:</strong> structured request, error and security logs containing the request path, status, timing
          and a keyed hash of your account identifier. They exclude keys, session tokens, request bodies, questions and
          answers. Legal basis: legitimate interests in operating and securing the service.
        </li>
        <li>
          <strong>Product analytics, when enabled:</strong> metadata such as mode, search provider, model, token counts,
          estimated cost, latency and error codes, linked to a keyed hash of your account identifier. Questions, answers,
          titles, source content, keys, email addresses and IP addresses are never sent. Legal basis: legitimate interests
          in understanding how the service is used. You can opt out at any time in Settings → Account, which also deletes
          the analytics already linked to you.
        </li>
      </ul>
      <p>
        A Google account and email address are required to use Beamling; without them we cannot create an account. Beamling
        makes no decisions about you based solely on automated processing, including profiling. Beamling is not intended
        for anyone under {MINIMUM_AGE}.
      </p>

      <h2>Your keys and provider traffic</h2>
      <p>
        When you ask a question, Beamling sends it, with any images you attach, the search query, retrieved snippets and your key, to the providers
        you chose: OpenRouter or DeepSeek for the model (OpenRouter may route the request to an upstream model provider),
        and Brave, Tavily, Exa or DeepSeek for search. These requests run under your own account with those providers, at
        your instruction, and those providers process the data under their own terms and privacy policies, linked on the{" "}
        <Link href="/subprocessors">data processors page</Link>. Some of them process data outside the European Union:
        DeepSeek, and some hosts OpenRouter can route to, are in China. Choosing such a provider is your decision; check its
        terms before you use it. Beamling does not send your IP address, email or account
        identifier to them, does not route your traffic through a shared provider account, and does not sell your data or
        use it to train models.
      </p>

      <h2>Cookies</h2>
      <p>
        Beamling uses two essential cookies: a session cookie and a short-lived sign-in transaction cookie. They do not
        require consent and are not used for analytics or advertising. See the <Link href="/cookies">cookie policy</Link>.
      </p>

      <h2>How long we keep data</h2>
      <ul>
        <li>
          Conversations, with their messages and sources: {CONVERSATION_RETENTION_DAYS} days after the last question in
          them, pinned or not. At most {MAX_CONVERSATIONS} per account; beyond that the least recently used, unpinned ones
          are deleted first.
        </li>
        <li>Account, credentials, settings and usage: until you delete them or your account.</li>
        <li>
          Inactive accounts: deleted with all their data after {INACTIVE_ACCOUNT_MONTHS} months without a sign-in or
          session use.
        </li>
        <li>Accounts that never accept the terms: deleted after {UNACCEPTED_ACCOUNT_DAYS} days.</li>
        <li>
          Sessions: expire after {SESSION_TTL_DAYS} days without use and at most {SESSION_MAX_AGE_DAYS} days after
          sign-in, then are deleted.
        </li>
        <li>Hashed IP addresses and rate-limit counters: up to one hour.</li>
        <li>Logs: up to {legal.logRetentionDays} days.</li>
        <li>
          Database backups and recovery history: up to {legal.backupRetentionDays} days. Content and keys in backups are
          encrypted.
        </li>
        <li>Analytics: until you opt out or delete your account.</li>
        <li>
          If the service closes: everything, on the closing date announced by email and in the interface at least{" "}
          {SHUTDOWN_NOTICE_DAYS} days in advance.
        </li>
      </ul>
      <p>
        Deleting your account in Settings immediately and permanently deletes the account, sessions, settings,
        conversations, messages, sources, credentials, usage records and workspace encryption key, and starts deletion of
        the analytics linked to you. Deleted data then disappears from logs and backups as they expire.
      </p>

      <h2>Recipients and international transfers</h2>
      <p>
        The <Link href="/subprocessors">data processors page</Link> lists the processors that run Beamling for us and the
        providers you choose with your own keys, with where they process data. Hosting runs in Belgium and the database in Frankfurt, Germany. Some
        providers are based in, or process data in, the United States or other countries outside the European Economic
        Area. These transfers rely on the EU-US Data Privacy Framework for certified providers, or on the European
        Commission&apos;s standard contractual clauses (Art. 45 and 46 GDPR). Write to {contact} for a copy of the relevant
        safeguards.
      </p>

      <h2>Your rights</h2>
      <p>
        You have the right to access your data, to rectify it, to have it erased, to restrict its processing, to data
        portability, and to object to processing based on legitimate interests (Articles 15 to 21 GDPR). You can exercise
        several of these yourself in Settings: download all your data as a JSON file, opt out of analytics, sign out
        everywhere and delete your account. For anything else, write to {contact}; we answer within one month. You can
        also complain to the Garante per la protezione dei dati personali (
        <a href="https://www.garanteprivacy.it">garanteprivacy.it</a>) or to the supervisory authority where you live or
        work.
      </p>

      <h2>Changes</h2>
      <p>
        When this notice changes materially, Beamling shows the new version and asks you to accept it before you continue.
        The date at the top of the page shows the current version.
      </p>
    </LegalPage>
  );
}

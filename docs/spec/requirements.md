# Functional Requirements

Each requirement has a priority (P0 = Alpha 1 target, P1 = private alpha/v1, P2 = later) and an acceptance criterion. Priority does not mean implemented; current coverage is in [Snapshot (verified 2026-10-22)](index.md#snapshot) and the [technical reference](../reference/index.md).

## Authentication and account

- **FR-01 (P0):** A first visit requires Google sign-in; there is no guest workspace.
  - Acceptance: unauthenticated API requests return `UNAUTHENTICATED`; unauthenticated visits to `/chat` or `/onboarding` redirect to `/login`; completing Google OIDC creates or resumes exactly one account per Google subject.
- **FR-02 (P0):** Google is the only identity provider. There is no password, magic link, email OTP, passkey or other OAuth provider in Alpha 1.
  - Acceptance: `/login` exposes only Google; the callback rejects any other issuer; sign-in needs no email delivery. The only email Beamling sends is the service-shutdown notice (FR-75), over an optional SMTP relay.
- **FR-03 (P0):** The OIDC flow uses authorization code + PKCE, `state` and `nonce`; ID tokens are verified for signature, issuer, audience, expiry and verified email before login.
  - Acceptance: replayed state, mismatched nonce, wrong audience and unverified email are rejected; the transaction cookie expires within 10 minutes.
- **FR-04 (P0):** Sessions are opaque, database-backed, 30-day sliding with a 90-day absolute lifetime, and revoked on sign-out, account deletion or a new sign-in from the same browser. Implemented.
  - Acceptance: the cookie is HttpOnly, SameSite=Lax, Secure outside localhost; only a SHA-256 hash is stored; account deletion and sign-out remove every session.
- **FR-05 (P0):** Users can sign out and can delete the account and all associated data immediately.
  - Acceptance: sign-out clears the cookie and revokes the session; deletion completes in the same request and revokes every session; the UI confirms without sending email.
- **FR-71 (P0):** Before using the app, every account confirms it is 18 or older and accepts the current version of the Terms and Privacy notice; a material change to either asks every account to accept again. Implemented.
  - Acceptance: an account without the current version is redirected to `/welcome` and every API call except accepting the terms, exporting data, signing out and deleting the account returns `TERMS_REQUIRED`; acceptance of a stale version returns `TERMS_OUTDATED`; the accepted version and time are stored.
- **FR-72 (P0):** Users can download all their stored data as a machine-readable file and object to product analytics without contacting the operator (Art. 15, 20 and 21 GDPR). Implemented.
  - Acceptance: `GET /api/account/export` returns the account, settings, credential metadata, sessions and every conversation with decrypted messages and sources, and never key material or session tokens; opting out stops new analytics events and queues erasure of past ones.
- **FR-73 (P0):** Personal data is not kept longer than needed: accounts unused for 24 months, and accounts that never accepted the terms after 7 days, are deleted with all their data by the cleanup job. Implemented.
- **FR-75 (P0):** The operator can close the service with at least 14 days' notice. Every account is told by email and in the interface, can still sign in and export its data until the closing date, and is then deleted with all its data. Implemented.
  - Acceptance: scheduling (`POST /api/internal/shutdown`, `KILL_SWITCH_SECRET`) refuses fewer than 14 days, and refuses email notice without SMTP (`MAIL_NOT_CONFIGURED`); each account receives one English plain-text notice, resumed after restarts and re-sent when rescheduled; while scheduled, new accounts get `SERVICE_CLOSING` and `/chat`, `/login` and `/status` show the date; after the date sign-in returns `SERVICE_CLOSED` and the cleanup job deletes every account through the normal deletion path; cancelling restores normal operation. Destroying the KMS key afterwards makes backups unreadable.
- **FR-60 (P0 — public-launch target):** Every account has its own workspace data encryption key. All user content is encrypted at rest with AES-256-GCM before it is written to PostgreSQL, so a database dump, backup, read replica, or read-only database compromise cannot reveal user content; only the minimized operational metadata listed in [Workspace data encryption (public-launch target)](keys.md#workspace-data-encryption-public-launch-target) remains readable.
  - Acceptance: a raw `pg_dump` of an account containing a question, answer and sources contains none of those plaintext strings; ciphertext from another account cannot be decrypted; the master key is never stored in the database; deleting the account removes its wrapped data key.
- **FR-51 (P0):** Users can choose the search provider for an answer (Brave, Tavily or Exa). The selected provider is stored with the message and is shown in the answer metadata.
  - Acceptance: a missing credential for the selected provider returns `CREDENTIAL_MISSING` and links to onboarding/settings; Beamling never falls back to another provider.

## Credentials

- **FR-06 (P0):** Users can add one credential per provider per kind (LLM or search). Launch search providers are Brave, Tavily and Exa; current code has one credential per provider (OpenRouter, DeepSeek, Brave, Tavily, Exa); the stored kind is derived from the provider.
- **FR-07 (P0):** The server validates a credential before saving it unless the user explicitly saves it unverified.
  - Acceptance: an OpenRouter key is validated with `GET /api/v1/key`; Tavily is validated with its free usage endpoint; Brave and Exa are validated with one minimal search request unless `validate: false` is sent, which saves the key with status `unverified` and no validation time. Invalid keys are rejected and validated keys are saved with status `active`.
- **FR-08 (P0):** Credentials are encrypted at rest with envelope encryption.
- **FR-09 (P0):** The plaintext key is never returned by any API after creation.
- **FR-10 (P0):** The UI displays only a masked fingerprint and the last validation time.
- **FR-11 (P0):** Users can replace or delete a credential at any time.
- **FR-12 (P1):** Credentials can be labeled when multiple keys for the same provider are allowed.
- **FR-13 (P1):** The system warns the user when a credential has not been validated for 30 days.
- **FR-61 (P0):** When adding a Brave key, the user declares whether it is on the **Free** plan (1 request/second) or a **Paid / provider** plan. The declared plan is stored with the credential and controls Beamling's per-key request spacing.
  - Acceptance: Free keys never exceed one request per second across all app instances; Paid keys are not forced to the Free interval; switching plans can be done without re-entering the key.
- **FR-62 (P0):** The user may declare an optional key expiry date and budget, because the provider API does not expose them reliably.
  - Acceptance: expiry is a future date; budget is a positive monthly USD amount; the UI labels both as user-declared, never provider-verified.
- **FR-63 (P0):** Beamling tracks estimated search requests and cost per credential and warns before a declared budget or expiry becomes a problem.
  - Acceptance: warning at 80% and 100% of the declared budget, and 14 days, 7 days and 1 day before expiry; warnings name the key and are dismissible per period; warnings never claim to know the provider's real balance.
- **FR-64 (P0):** Replacing a key with the same fingerprint preserves its declared limits and usage period; replacing it with a different key starts a new usage period.
  - Acceptance: re-entering the same Brave key does not reset its spend warning; a different key does.

## Asking and answering

- **FR-14 (P0):** Users can submit a question in a conversation.
- **FR-15 (P0):** The answer streams token by token over SSE.
- **FR-16 (P0):** The answer contains inline numeric citations that map to the source list.
- **FR-17 (P0):** The source list shows title, domain, URL, publication date when available, and a snippet.
- **FR-18 (P0):** Clicking a citation scrolls to and highlights the corresponding source.
- **FR-19 (P0):** The answer can be stopped by the user; partial text is kept and marked as stopped.
- **FR-20 (P0):** The system shows an explicit message when no reliable sources are found.
- **FR-21 (P0):** The system shows an explicit message when OpenRouter rejects the key, has insufficient credits, or rate-limits; failures from the selected search provider use the same contract.
- **FR-22 (P0):** The system never changes the selected OpenRouter model ID. OpenRouter may route that model to a different upstream provider; the resolved model and upstream provider, when returned, are recorded and disclosed.
- **FR-23 (P0):** Users can choose Quick, Deep or Deeper mode.
- **FR-24 (P0):** Quick uses one search on the selected provider and a concise answer. Deep uses a planner, 3–5 sub-queries, an optional gap pass of at most two extra searches, and a longer report. Deeper gives the model a search tool for the selected provider and lets it choose 1–4 queries per step until it judges the evidence sufficient, with a hard budget of 60 searches and 60 sources.
- **FR-25 (P1):** The system generates three follow-up questions after an answer.
- **FR-26 (P1):** The answer includes a "sources conflict" note when retrieved sources disagree on a material fact.
- **FR-43 (P0):** Beamling shows an animated working state for `queued`, `searching`, `reading`, `writing`, `done`, `stopped`, `no-sources` and `error`.
- **FR-44 (P0):** The UI enters a working state within 100 ms of submit and changes state only on real `stage` or `progress` events from the server.
- **FR-45 (P0):** Every source card shown to the user is part of the prompt context for that answer, and its number matches the citation number.
- **FR-46 (P0):** Progress exposes only real, user-safe status (planned or executed searches, completed searches); it never exposes hidden reasoning.
- **FR-68 (P0):** Deeper uses an agentic tool loop with a hard search budget and stops on either model-judged sufficiency or budget exhaustion. It never searches after the budget is exhausted and never calls any tool other than search in this release.
  - Acceptance: a Deeper run emits a visible trace for every search, stops at or below 60 searches, persists sources with stable citation numbers, and writes the final report with the existing citation contract.

## Conversations

- **FR-27 (P0):** Conversations are persisted and listed with pinned conversations first, then in reverse chronological order.
- **FR-28 (P0):** Users can delete a conversation.
- **FR-30 (P0):** Deleting a conversation deletes its messages and sources.
- **FR-69 (P0):** Users can pin or unpin a conversation from the sidebar. The pinned state is persisted server-side, survives reload and sign-in, and pinned conversations appear in a separate Pinned section.
  - Acceptance: pinning an older conversation moves it ahead of newer unpinned chats; unpinning restores normal date grouping; the state is stored in PostgreSQL, not only in the browser.
- **FR-74 (P0):** Because the service is free, conversation storage is bounded: a conversation, pinned or not, is deleted 60 days after its last activity (new question or mode change), and an account keeps at most 100 conversations. Implemented.
  - Acceptance: the cleanup job deletes conversations whose last activity is older than 60 days; creating a conversation beyond 100 deletes the least recently active unpinned ones first and returns their ids so the sidebar drops them; the sidebar always states the 60-day rule and from 90 conversations warns that new chats replace the oldest; Terms and Privacy state both limits.
- **FR-70 (P1):** Users can search conversations by title from the sidebar.
  - Acceptance for Alpha 1: the search filters the loaded conversation pages immediately and truthfully says that older chats must be loaded to widen the result. Full-history server search is post-alpha.

## Settings and transparency

- **FR-33 (P0):** Users can set a default OpenRouter model, a default search provider (Brave, Tavily or Exa) and a default Quick/Deep/Deeper mode.
- **FR-34 (P0):** Every answer displays the resolved model, selected search provider, token counts, generation cost and search-provider cost; provider-reported cost is labeled actual, configured-rate estimates are labeled estimated.
- **FR-36 (P1):** Users can set a per-query cost ceiling; the system warns before exceeding it.

## Reliability and limits

- **FR-38 (P0):** The API enforces per-user rate limits and a global concurrency cap.
- **FR-39 (P0):** A failed sub-query degrades gracefully: Deep continues with available sources and shows a visible partial-search warning; if all searches fail, the answer is not generated.
- **FR-40 (P0):** All errors return a stable error code and a human-readable message.
- **FR-41 (P1):** The system caches identical search queries per provider for 10 minutes to reduce provider cost.
- **FR-42 (P1):** A provider health page shows current status for OpenRouter, Brave, Tavily and Exa.
- **FR-47 (P0):** OpenRouter errors `401`, `402`, `429`, `502` and `503`, plus mid-stream `error` chunks, map to the stable Beamling error codes.
- **FR-48 (P0):** Brave, Tavily and Exa `401`, `402`, `403`, `422`, `429`, `432`, `433` and `5xx` responses map to stable Beamling error codes; `429` retries at most once with backoff and respects `Retry-After`.
- **FR-49 (P0):** The SSE stream emits `stage`, `plan`, `search`, `progress`, `sources`, `delta`, `reasoning`, `citation`, `usage`, `done` and `error`; unknown event types are ignored by the client.
- **FR-50 (P0):** A stream with zero valid citations completes with a visible "Uncited answer" warning; it is not silently treated as grounded.
- **FR-65 (P0):** Every answer shows the searches actually run: the query text, status and result count, in a control collapsed by default. The record is persisted with the answer and survives reload.
  - Acceptance: Quick shows its one query; Deep shows each planner and gap query; failed searches are visibly marked failed; the panel starts collapsed.
- **FR-66 (P0):** When the model returns reasoning text through the provider stream, the answer shows it in a separate control collapsed by default. The stored reasoning is encrypted with the message content.
  - Acceptance: reasoning streams visibly during generation, is persisted, survives reload, and is absent when the provider returns none; Beamling never invents reasoning.
- **FR-67 (P0):** Markdown rendering supports GitHub-style tables with a header row, delimiter row, alignment and inline formatting in cells, plus horizontal scrolling on narrow screens.
  - Acceptance: a table in a model answer renders as a real `<table>`, not paragraphs; code fences and citations still work.
- **FR-52 (P0):** Product analytics is server-side and metadata-only. It never sends questions, answers, titles, source text, keys, error messages, IP addresses or raw user IDs.
  - Acceptance: an automated allowlist test rejects any disallowed field; PostHog IP/GeoIP capture is disabled; `ANALYTICS_ENABLED=false` stops all events; an account that opted out sends none.
- **FR-53 (P1):** Users can view their own questions, tokens and estimated provider costs on a personal usage page. It reads from the application database, not PostHog.

## Public pages, legal and licenses

- **FR-54 (P0):** The welcome page and global footer link to Privacy, Terms, Cookie Policy, Open-source licenses, Subprocessors, Security, Contact/Abuse, Support, Status, Docs and the public issue tracker.
  - Acceptance: every public page has the footer links; a link checker passes in CI.
- **FR-55 (P0):** `/licenses` is generated from the production dependency graph and includes required notices. CI fails on a disallowed or unknown license.
- **FR-56 (P0):** No non-essential cookie or script loads before consent. The session cookie is essential. If a non-essential script is added, a reputable CMP blocks it until consent, with Reject all as prominent as Accept all, no cookie wall and no pre-ticked boxes.
- **FR-57 (P0):** Privacy, Terms and Cookie Policy accurately describe encryption, metadata, providers, analytics, retention and deletion, never claim end-to-end encryption, and are reviewed by a lawyer before public launch. Partial: the pages are implemented (retention periods, legal bases, rights, transfers, 18+ age limit, AI-generated answers, Italian-law liability limits, DSA contact point, processors vs user-chosen providers, conversation storage limits, service closure with 14 days' notice); lawyer review remains.
- **FR-58 (P2):** The footer links to `/support`, which offers a plain outbound Tipeee link (PayPal fallback). No embedded payment widget, iframe, script or chat interruption.
  - Acceptance: the link opens the provider-hosted page in a new tab; no payment script loads on Beamling; no donation prompt blocks chat.
- **FR-59 (P2):** `/supporters` lists only donors who explicitly consented to publication, with no amounts, emails, legal names or scraped data.
  - Acceptance: every entry has a recorded consent reference; removal requests are honored; the page has no payment SDK.
- **FR-60 (P1, target, not started):** A plain-language page (working title "How Beamling keeps your keys safe", linked from `/security` and onboarding) explains why it is safe to paste an API key into Beamling, and backs each claim with a link to the exact code in the public repository (permalinks pinned to the released commit, so a link never points at changed code). Topics:
  - the key travels over HTTPS and is encrypted before it is stored (KMS envelope encryption, `lib/server/crypto.ts`, `lib/server/kms.ts`);
  - after saving, the full key is never sent back to the browser, only its last four characters, or none for short keys;
  - the key is decrypted only in server memory, for one request, and sent only to its own provider;
  - keys and response bodies are redacted from logs (`lib/server/log.ts`);
  - conversations are encrypted per account at rest (`lib/server/workspace-key.ts`);
  - deleting a key or the account removes it;
  - everything is open source, so each claim can be checked.
  - It also states the limits plainly: this is not end-to-end encryption, because the server must decrypt a key to call the provider on the user's behalf, and the operator runs that server.
  - Acceptance: every claim on the page has a working code permalink; wording reviewed for plain language; the page states its limits and never claims end-to-end encryption (FR-57).

**Current checkout:** `/licenses` states that Beamling is MIT-licensed and lists the third-party inventory generated from the production dependency graph; every installed license is checked against the allowlist in CI. The public pages share a footer with Privacy, Terms, Cookies, Data processors, Security, Status, Contact and Licenses, and the MIT notice. `/contact`, `/cookies`, `/subprocessors`, `/security`, `/status` and `/.well-known/security.txt` exist. Legal review and the public docs/support pages remain target work.

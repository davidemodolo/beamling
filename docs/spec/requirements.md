# Functional Requirements

Priority: P0 = Alpha 1 target, P1 = private alpha/v1, P2 = later. Priority is not implementation status; see [Snapshot](index.md#snapshot) and the [technical reference](../reference/index.md).

## Authentication and account

- **FR-01 (P0):** First visit requires Google sign-in; no guest workspace.
  - Acceptance: unauthenticated API calls return `UNAUTHENTICATED`; `/chat` and `/onboarding` redirect to `/login`; one account per Google subject.
- **FR-02 (P0):** Google is the only identity provider: no password, magic link, OTP, passkey or other OAuth.
  - Acceptance: `/login` shows only Google; other issuers are rejected; no email needed to sign in. The only email sent is the shutdown notice (FR-75), via optional SMTP.
- **FR-03 (P0):** OIDC uses code + PKCE, `state` and `nonce`; ID tokens are checked for signature, issuer, audience, expiry and verified email.
  - Acceptance: replayed state, wrong nonce, wrong audience and unverified email are rejected; the transaction cookie expires within 10 minutes.
- **FR-04 (P0):** Opaque database sessions, 30-day sliding, 90-day absolute, revoked on sign-out, account deletion or a new sign-in from the same browser. Implemented.
  - Acceptance: HttpOnly, SameSite=Lax, Secure outside localhost; only a SHA-256 hash stored; sign-out and deletion remove every session.
- **FR-05 (P0):** Users can sign out and immediately delete the account and all data.
  - Acceptance: sign-out clears the cookie and session; deletion completes in the request and revokes all sessions; confirmed in the UI, no email.
- **FR-71 (P0):** Every account confirms 18+ and accepts the current Terms and Privacy notice; material changes require re-acceptance. Implemented.
  - Acceptance: without the current version, the user is sent to `/welcome` and every API call except accept, export, sign-out and delete returns `TERMS_REQUIRED`; a stale version returns `TERMS_OUTDATED`; version and time are stored.
- **FR-72 (P0):** Self-service data export and analytics objection (GDPR Art. 15, 20, 21). Implemented.
  - Acceptance: `GET /api/account/export` returns account, settings, credential metadata, sessions and decrypted conversations with sources, never keys or tokens; opting out stops new events and queues erasure of past ones.
- **FR-73 (P0):** The cleanup job deletes accounts unused for 24 months, and accounts that never accepted the terms after 7 days, with all data. Implemented.
- **FR-75 (P0):** The operator can close the service with ≥ 14 days' notice. Accounts are told by email and in the UI, can sign in and export until the date, then are deleted. Implemented.
  - Acceptance: `POST /api/internal/shutdown` (`KILL_SWITCH_SECRET`) refuses < 14 days and email notice without SMTP (`MAIL_NOT_CONFIGURED`). One English plain-text notice per account, resumed after restarts, re-sent on reschedule. While scheduled, sign-ups get `SERVICE_CLOSING` and `/chat`, `/login`, `/status` show the date. Afterwards sign-in returns `SERVICE_CLOSED` and cleanup deletes every account via normal deletion. Cancelling restores normal operation. Destroying the KMS key then makes backups unreadable.
- **FR-60 (P0 — public-launch target):** Each account has its own workspace data key; all content is AES-256-GCM encrypted before reaching PostgreSQL, so a dump, backup, replica or read-only compromise reveals only the metadata listed in [Workspace data encryption](keys.md#workspace-data-encryption-public-launch-target).
  - Acceptance: a raw `pg_dump` contains no question, answer or source plaintext; another account's ciphertext can't be decrypted; the master key is never in the database; deletion removes the wrapped key.
- **FR-51 (P0):** Users choose the search provider per answer (Brave, Tavily or Exa); it is stored and shown with the answer.
  - Acceptance: a missing credential returns `CREDENTIAL_MISSING` with a link to setup; never falls back to another provider.

## Credentials

- **FR-06 (P0):** One credential per provider per kind (LLM or search). Current code: one per provider (OpenRouter, DeepSeek, Brave, Tavily, Exa), kind derived from provider.
- **FR-07 (P0):** Credentials are validated before saving unless saved unverified.
  - Acceptance: OpenRouter via `GET /api/v1/key`, Tavily via its free usage endpoint, Brave and Exa via one minimal search. `validate: false` saves as `unverified` with no validation time. Invalid keys are rejected; valid ones saved `active`.
- **FR-08 (P0):** Envelope encryption at rest.
- **FR-09 (P0):** No API returns the plaintext key after creation.
- **FR-10 (P0):** The UI shows only a masked fingerprint and last validation time.
- **FR-11 (P0):** Replace or delete any time.
- **FR-12 (P1):** Labels when several keys per provider are allowed.
- **FR-13 (P1):** Warning after 30 days without validation.
- **FR-61 (P0):** Brave keys are declared **Free** (1 request/second) or **Paid / provider**; the plan sets per-key spacing.
  - Acceptance: Free never exceeds 1 req/s across instances; Paid isn't held to it; plan changes need no key re-entry.
- **FR-62 (P0):** Optional user-declared expiry date and budget.
  - Acceptance: expiry in the future; budget a positive monthly USD amount; both labeled user-declared.
- **FR-63 (P0):** Estimated search requests and cost are tracked per credential, with warnings.
  - Acceptance: at 80% and 100% of budget and 14/7/1 days before expiry; warnings name the key, are dismissible per period and never claim the real balance.
- **FR-64 (P0):** Same-fingerprint replacement keeps declared limits and usage period; a different key starts a new period.
  - Acceptance: re-entering the same Brave key keeps its spend warning; a different key resets it.

## Asking and answering

- **FR-14 (P0):** Submit a question in a conversation.
- **FR-15 (P0):** Answers stream token by token over SSE.
- **FR-16 (P0):** Inline numeric citations map to the source list.
- **FR-17 (P0):** Sources show title, domain, URL, date when available and snippet.
- **FR-18 (P0):** Clicking a citation scrolls to and highlights its source.
- **FR-19 (P0):** Users can stop an answer; partial text is kept and marked stopped.
- **FR-20 (P0):** Explicit message when no reliable sources are found.
- **FR-21 (P0):** Explicit message when OpenRouter rejects the key, lacks credit or rate-limits; search providers follow the same contract.
- **FR-22 (P0):** The selected OpenRouter model id never changes. Resolved model and upstream provider, when returned, are recorded and shown.
- **FR-23 (P0):** Quick, Deep or Deeper mode.
- **FR-24 (P0):** Quick: one search, concise answer. Deep: planner, 3–5 sub-queries, optional gap pass of ≤ 2 searches, longer report. Deeper: the model uses a search tool, 1–4 queries per step, until it judges evidence sufficient; hard budget 60 searches and 60 sources.
- **FR-25 (P1):** Three follow-up questions after an answer.
- **FR-26 (P1):** A "sources conflict" note when sources disagree on a material fact.
- **FR-43 (P0):** Animated working state for `queued`, `searching`, `reading`, `writing`, `done`, `stopped`, `no-sources`, `error`.
- **FR-44 (P0):** Working state within 100 ms of submit; changes only on real `stage`/`progress` events.
- **FR-45 (P0):** Every shown source card was in the prompt, numbered as cited.
- **FR-46 (P0):** Progress shows only real, user-safe status (planned/executed/completed searches), never hidden reasoning.
- **FR-68 (P0):** Deeper is an agentic loop that stops on model-judged sufficiency or budget exhaustion; no searches past budget, no tools besides search.
  - Acceptance: a visible trace per search, ≤ 60 searches, sources with stable numbers, final report uses the citation contract.

## Conversations

- **FR-27 (P0):** Conversations persist and list pinned first, then newest first.
- **FR-28 (P0):** Users can delete a conversation.
- **FR-30 (P0):** Deletion removes its messages and sources.
- **FR-69 (P0):** Pin/unpin from the sidebar, stored server-side, shown in a Pinned section.
  - Acceptance: a pinned old chat sorts ahead of newer unpinned ones; unpinning restores date grouping; state lives in PostgreSQL.
- **FR-74 (P0):** Storage is bounded: conversations (pinned or not) are deleted 60 days after last activity (question or mode change); max 100 per account. Implemented.
  - Acceptance: cleanup deletes chats idle > 60 days; creating the 101st deletes the least recently active unpinned ones first and returns their ids; the sidebar always states the 60-day rule and warns from 90 chats; Terms and Privacy state both limits.
- **FR-70 (P1):** Search conversations by title in the sidebar.
  - Alpha 1: filters loaded pages and says older chats must be loaded. Full-history search is post-alpha.

## Settings and transparency

- **FR-33 (P0):** Defaults for OpenRouter model, search provider (Brave, Tavily or Exa) and mode.
- **FR-34 (P0):** Each answer shows resolved model, search provider, tokens, generation cost and search cost; provider-reported cost is labeled actual, rate-based cost estimated.
- **FR-36 (P1):** Per-query cost ceiling with a warning.

## Reliability and limits

- **FR-38 (P0):** Per-user rate limits and a global concurrency cap.
- **FR-39 (P0):** A failed sub-query degrades gracefully: Deep continues with a visible partial-search warning; if all searches fail, no answer is generated.
- **FR-40 (P0):** Every error has a stable code and readable message.
- **FR-41 (P1):** Identical search queries cached per provider for 10 minutes.
- **FR-42 (P1):** Provider health page for OpenRouter, Brave, Tavily and Exa.
- **FR-47 (P0):** OpenRouter `401`, `402`, `429`, `502`, `503` and mid-stream `error` chunks map to stable codes.
- **FR-48 (P0):** Brave, Tavily and Exa `401`, `402`, `403`, `422`, `429`, `432`, `433` and `5xx` map to stable codes; `429` retries once with backoff, honoring `Retry-After`.
- **FR-49 (P0):** SSE emits `stage`, `plan`, `search`, `progress`, `sources`, `delta`, `reasoning`, `citation`, `usage`, `done`, `error`; clients ignore unknown events.
- **FR-50 (P0):** Zero valid citations completes with a visible "Uncited answer" warning.
- **FR-65 (P0):** Each answer lists the searches run (query, status, result count) in a collapsed control, persisted with the answer.
  - Acceptance: Quick shows one query; Deep each planner and gap query; failures marked; starts collapsed.
- **FR-66 (P0):** Provider-returned reasoning appears in a separate collapsed control, encrypted with the message.
  - Acceptance: streams live, persists, absent when none is returned; never invented.
- **FR-67 (P0):** Markdown supports GitHub tables (header, delimiter, alignment, inline formatting) with horizontal scroll on narrow screens.
  - Acceptance: model tables render as `<table>`; code fences and citations still work.
- **FR-52 (P0):** Analytics is server-side and metadata-only: never questions, answers, titles, source text, keys, error messages, IPs or raw user ids.
  - Acceptance: an allowlist test rejects other fields; IP/GeoIP off; `ANALYTICS_ENABLED=false` stops all events; opted-out accounts send none.
- **FR-53 (P1):** A personal usage page (questions, tokens, estimated costs) from the app database, not PostHog.

## Public pages, legal and licenses

- **FR-54 (P0):** Welcome page and footer link Privacy, Terms, Cookie Policy, Open-source licenses, Subprocessors, Security, Contact/Abuse, Support, Status, Docs and the issue tracker.
  - Acceptance: every public page has them; CI link check passes.
- **FR-55 (P0):** `/licenses` is generated from production dependencies with notices; CI fails on disallowed or unknown licenses.
- **FR-56 (P0):** Nothing non-essential loads before consent. If needed, a CMP blocks it, with Reject all as prominent as Accept all, no cookie wall, no pre-ticked boxes.
- **FR-57 (P0):** Privacy, Terms and Cookie Policy accurately cover encryption, metadata, providers, analytics, retention and deletion, never claim E2E, and get lawyer review before launch. Partial: pages implemented (retention, legal bases, rights, transfers, 18+, AI-generated answers, Italian-law liability limits, DSA contact, processors vs user-chosen providers, storage limits, 14-day closure notice); lawyer review remains.
- **FR-58 (P2):** Footer links to `/support` with an outbound Tipeee link (PayPal fallback); no embedded widget, iframe, script or chat interruption.
  - Acceptance: opens the provider page in a new tab; no payment script on Beamling; nothing blocks chat.
- **FR-59 (P2):** `/supporters` lists only consenting donors; no amounts, emails, legal names or scraped data.
  - Acceptance: each entry has a consent reference; removals honored; no payment SDK.
- **FR-76 (P1, target, not started):** A plain-language page ("How Beamling keeps your keys safe", linked from `/security` and onboarding) explains why pasting a key is safe, each claim linked to code via permalinks pinned to the released commit:
  - HTTPS in transit, KMS envelope encryption before storage (`lib/server/crypto.ts`, `lib/server/kms.ts`);
  - after saving, only the last four characters (or none for short keys) reach the browser;
  - decrypted only in server memory for one request, sent only to its own provider;
  - keys and response bodies redacted from logs (`lib/server/log.ts`);
  - conversations encrypted per account (`lib/server/workspace-key.ts`);
  - deleting a key or the account removes it;
  - all open source.
  - Limits stated plainly: not E2E, because the operator's server must decrypt the key to call the provider.
  - Acceptance: every claim has a working permalink; plain-language review; limits stated, no E2E claim (FR-57).

**Current checkout:** `/licenses` (MIT statement plus generated inventory, CI allowlist), shared footer (Privacy, Terms, Cookies, Data processors, Security, Status, Contact, Licenses, MIT notice), `/contact`, `/cookies`, `/subprocessors`, `/security`, `/status`, `/.well-known/security.txt`. Legal review and public docs/support pages remain target.

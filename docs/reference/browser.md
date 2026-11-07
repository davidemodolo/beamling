# Browser application

## Routes and pages

| Route | Current behavior |
|---|---|
| `/` | Public cinematic landing page with a scripted demo, feature cards, provider list, CTA to `/onboarding` or `/chat`, and the full legal footer |
| `/login` | Google-only sign-in page; redirects to `/onboarding` or `/chat` after the callback. Sign-in start failures redirect back with `auth_unavailable` or `login_rate_limited` instead of returning JSON. Copy says the Terms and Privacy notice are accepted after sign-in and that Beamling is for people aged 18 and over. While a shutdown is scheduled it shows the closing date and that new accounts are no longer accepted; after the date it says Beamling has shut down and hides the sign-in button. `service_closing` and `service_closed` errors have their own copy. |
| `/welcome` | Terms acceptance step ([Terms acceptance](accounts.md#terms-acceptance)), not indexed. Signed-out visitors go to `/login`; accounts already on the current version go to `next`. Shows "Before you start" for a new account or "Updated terms" after a version change, three short points (AI-generated answers, the user's responsibility for provider keys and costs, encryption/export/deletion), an "I am at least 18" checkbox and an "I accept the Terms and have read the Privacy notice" checkbox, Accept and Sign out buttons, and a note that accounts that never accept are deleted after seven days. |
| `/onboarding` | Account setup form: default model (grouped by provider) and that provider's key, search-provider picker and its key (asked once when one provider serves both), plus plan/expiry/budget for providers with key limits; validates and saves, then routes to `/chat` |
| `/chat` | New-question view; loads workspace state, conversation list and threads. While a shutdown is scheduled, the layout shows an alert banner above the app with the closing date and a "Download my data" button that opens Settings → Account |
| `/chat/[id]` | Conversation view; loads the newest 60 messages and supports earlier-message pagination |
| `/privacy` | Privacy notice (Art. 13/14 GDPR): controller with address and optional VAT id, no DPO; data categories with legal basis (account, acceptance record, session, content, credentials, usage, hashed-IP security metadata, logs, optional analytics with opt-out); Google account used to email essential service notices (no newsletters or marketing); Google account required; no solely automated decisions; not for under-18s; provider traffic under the user's own accounts, noting that DeepSeek and some OpenRouter hosts are in China and that the choice is the user's; essential cookies only; retention list (conversations 60 days after their last question, pinned or not, at most 100 per account with the least recently used unpinned ones deleted first; account data until deletion; inactive accounts after 24 months, unaccepted accounts after 7 days, sessions 30 days idle / 90 days max, hashed IPs and counters up to one hour, logs `LEGAL_LOG_RETENTION_DAYS`, backups `LEGAL_BACKUP_RETENTION_DAYS`, analytics until opt-out or deletion; everything on the closing date if the service closes, announced at least 14 days ahead by email and in the interface); recipients and transfers (hosting in Belgium, database in Frankfurt, EU-US Data Privacy Framework or SCCs); rights under Art. 15–21 with the self-service Settings controls, one-month answer and the Garante complaint route; re-acceptance on material changes |
| `/terms` | Alpha terms: operator identity, free service, 18+ (or local age of majority), acceptance on first use and on material change, user responsibility for provider keys and costs (some providers, such as DeepSeek, process data outside the EU, including in China, and Beamling is not responsible for how a chosen provider handles data), data loss and export, storage limits (60-day conversation expiry, 100 conversations per account, warning near the cap), acceptable use (illegal content, harassment, IP and privacy infringement, malware, EU AI Act Art. 5 practices, professional advice, foreign keys, scraping, resale), AI-generated answers, content ownership and MIT-licensed source (name and logo not licensed), as-is availability without affecting consumer rights, liability limits that never exclude wilful misconduct or gross negligence (Art. 1229 Italian Civil Code) or Consumer Code liability, suspension with notice and a chance to export, 24-month inactive deletion, closure of the service with at least 14 days' notice by email and in the interface (no new accounts meanwhile, export still possible, every account deleted on the date), email only for essential service notices, DSA reports and contact point, `LEGAL_GOVERNING_LAW` with consumer forum (Art. 66-bis Consumer Code) |
| `/cookies` | Essential-cookie table (session: 30 days without use, at most 90 days after sign-in); no analytics or advertising cookies |
| `/subprocessors` | "Data processors" page in two tables with purpose, location and privacy-policy link: processors that run Beamling under a DPA (Google Cloud for hosting, logs and KMS, Neon, optional PostHog Cloud, and an email row named by `LEGAL_MAIL_PROVIDER` when set) and providers the user chooses with their own account (Google sign-in, OpenRouter, whose hosts can include China, DeepSeek in China, Brave, Tavily, Exa) |
| `/security` | Security controls, session lifetime, audit events, `security.txt` link and a vulnerability-disclosure policy with a good-faith safe harbor |
| `/contact` | Operator identity, address and optional VAT id; monitored privacy/security/abuse contact; DSA single point of contact (Art. 11–12, English) and how to report illegal content |
| `/status` | Human-readable readiness for the app, database, schema and KMS; a scheduled shutdown date (or that the service has shut down) above it |
| `/licenses` | States that Beamling is open source under the MIT License with a link to the source repository, then the generated third-party inventory from `packages/web/lib/generated/licenses.json`, with notices, license texts and the shared legal footer |
| `/.well-known/security.txt` | RFC 9116 security contact ([Endpoints](api.md#endpoints)) |
| `/api/health` | Cached readiness: database, schema and KMS |
| `/api/live` | DB-free liveness probe |
| `/robots.txt` | Allows `/`, disallows `/chat`, `/onboarding`, `/api/` |

The Next.js metadata base and the landing demo host are derived from `APP_URL`, so metadata, canonical URLs and the visible demo follow the deployed origin.

Legal pages read the operator details from `legalDetails()` and the dates from `LEGAL_LAST_UPDATED`. The source repository URL is `SOURCE_URL` in `lib/legal.ts`.

## Client state

`StoreProvider` (`lib/store/`) owns the workspace and exposes it through two contexts, so a component re-renders only for the half it reads:

- `useAccount()` (`lib/store/account.tsx`): user, settings, credentials, load status, refresh, settings and credential actions, sign-out and account deletion. Settings panels, onboarding and the shell read only this, so streamed answer text does not re-render them.
- `useConversations()` (`lib/store/conversations.tsx`): conversation summaries and count, per-conversation threads, pagination and message updates.
- `lib/store/threads.ts` holds the pure thread-merge helpers.

Behaviour:

- Loads `/api/state` on mount; a 401 redirects to `/login`. Any API response with `TERMS_REQUIRED` replaces the page with `/welcome?next=<current path>`.
- Keeps user, conversation summaries, conversation count, settings, credentials and per-conversation thread state.
- Loads a thread lazily when a conversation route mounts.
- Merges a refreshed newest page with earlier pages already loaded, dropping provisional copies and preserving local failures.
- Uses request sequence numbers so a slow older response cannot overwrite a newer one.
- Tracks conversations created or deleted during an in-flight refresh.
- The sidebar renders a skeleton until the first `/api/state` resolves and shows an inline retry when a later refresh fails, instead of briefly claiming there are no conversations.
- The topbar and Account panel use the same initial/avatar component. Google profile pictures are rendered only from a validated `https://*.googleusercontent.com` URL.
- Streaming deltas are batched per animation frame before updating the live answer.
- Exposes methods for refresh, pagination, thread loading, conversation CRUD, pinning, settings, credential limits, sign-out and account deletion.

`AnswerStreamsProvider` owns live answers:

- One live answer per conversation.
- A stream keeps running when the user switches conversations through client-side navigation.
- A full page navigation aborts the connection; the server stores the outcome as stopped.
- `visibleMessages()` hides stored streaming rows while a live answer stands in for them.
- A stored `streaming` row from another tab or a previous page load is followed by polling the thread every 4 seconds.
- If the connection fails before a message id arrives, the UI reloads the thread to see whether the server stored the exchange. If not, it keeps a local failed question/answer pair that can be retried without duplicating the question.
- If a retry stream fails before `meta`, the existing stored answer gets the error and no duplicate card is added.

## Onboarding

- Requires a key for the selected model's provider if none is stored; changing the model to another provider switches the key field.
- Requires a key for the selected search provider if none is stored. When the model's provider is also the search provider, the search card says it uses the same key and shows no second field.
- The user can switch the selected provider before adding its key. A provider's notice is shown under its key field.
- Brave requires a plan (`Free · 1 request/second` or `Paid / provider plan`) and accepts optional expiry and monthly budget. All three are user-declared.
- “Get a key” links open the provider dashboards in a new tab.
- Keys are masked inputs with show/hide toggles.
- Saving validates each key through the server; a failure keeps the form open with provider copy.
- The user can choose any allowlisted model; the selection is saved only if it differs from the current default.
- If a key is already connected, the field can replace it.
- Once both keys exist, “Start asking” routes to `/chat`; the default model and search provider are preserved.

## Chat view

`components/chat-view.tsx` composes the pane from `components/chat/`: `ChatTopbar`, `useSourcesPanel` (selected source, panel or sheet, citation handlers), `useThreadScroll` (follows new text until the user scrolls up) and `useFollowStoredAnswer` (polls an answer still being written elsewhere).

- Header: conversation title, mode, selected model name, selected search-provider label, source-count button, account avatar.
- Answer cards show **Searches** (query, status, result count) and **Model reasoning** as `<details>` panels, collapsed by default. The same panels appear live while the answer streams.
- Sidebar: title search over loaded pages, a Pinned section, Today/Yesterday/Previous groups in UTC, exact-title links, per-conversation pin/unpin and delete confirmation, “Show older conversations” pagination, a retention note ("Chats are deleted 60 days after their last message"), which from 90 conversations also shows "N of 100 chats. New chats replace the oldest unpinned ones." as a highlighted status, Settings entry, signed-in email and sign-out.
- Thread: user bubbles, answer cards, a working answer card, earlier-message button, empty state, not-found state, load-error state.
- Composer: auto-growing textarea up to 190 px, Enter sends, Shift+Enter inserts a newline, Quick/Deep/Deeper segmented control, model badge, search-provider selector and Stop button while busy. Providers without a saved key are listed as "· no key". The hint under the composer reads "Answers are AI-generated with your keys and can be wrong — check the sources." Sending is not blocked on the client, whose credential list can be stale; the server's `CREDENTIAL_MISSING` shows the "Key needed" card.
- Source panel: desktop right-hand pane; mobile bottom sheet with focus trap; source count, provider badge, title/domain/date/snippet/link. The badge comes from the answer’s stored provider.
- Tables render with a header, alignment and horizontal scrolling; the parser also handles headings, lists, quotes, code fences, links and citations.
- Answer card: streamed markdown, citation buttons, an "Uncited" badge when no valid citation survived, stopped/error/truncated/degraded/partial-search notices, and a retry button for the latest failed or stopped answer. The no-sources answer is its fixed text, without an extra notice. The footer is one muted line: model name, search provider, total cost and time, plus copy and sources buttons. Tooltips hold the details: the model and host the provider actually used, tokens, and the cost split (generation reported by OpenRouter or estimated from DeepSeek token prices, and search estimated from the list price). The AI-generated disclosure is the hint under the composer, the welcome step and the terms.
- Working answer: mascot, stage label, real detail string, skeleton or streaming body, Stop button.
- Stop: the composer switches to a stop control; the client asks the server to stop, waits for confirmation, and keeps the partial answer.

Markdown support is intentionally small:

- Headings `##`–`####`, paragraphs, unordered/ordered lists, blockquotes, horizontal rules and fenced code.
- GitHub-style tables: header row, delimiter row, left/center/right alignment, inline formatting in cells and horizontal scrolling.
- Inline code, bold, italics, and links. Raw HTML is not parsed.
- Links must be `http:` or `https:` **and** exactly match a URL in the answer's retrieved sources; model-chosen links render as plain label text. This blocks model-authored phishing links while keeping cited sources clickable.
- `[n]` renders as a citation button only when `n` is within the answer's source count; otherwise it stays as text.
- Citation clicks use event delegation to a `data-citation` attribute.

## Settings and account

Settings is a modal with three keyboard-navigable tabs:

| Tab | Behavior |
|---|---|
| Keys | One card per catalog provider (what the key is used for, a key link and the provider's notice): add/replace/validate/delete; optional save without validation for providers without a free check (Brave, Exa); masked last four, status, plan, declared expiry/budget, estimated spend and warnings, and limits editing for providers with key limits (Brave). Keys of providers removed from the catalog are listed as unsupported, delete only |
| Defaults | Default mode (Quick/Deep/Deeper), model select grouped by provider (marked `· no key` when that provider has no key), default search provider (same marking), and the notices of the selected providers |
| Account | Google name/email, conversation and credential counts, session explanation (30 days without use, 90 days after sign-in), sign out, sign out everywhere; "Your data" card with **Download my data** (`GET /api/account/export`) and an **Exclude me from product analytics** checkbox (`PATCH /api/settings { analyticsOptOut }`); delete account with typed `DELETE`; link to the accepted terms and privacy notice |

Deleting the account hard-deletes server data and the wrapped workspace key, clears the client store and session cookie, and routes to `/`.

## Landing page

The root page is static marketing content rendered per request so the CSP nonce can be injected:

- Dark brand theme, Inter and JetBrains Mono.
- Hero and mascot.
- A scripted, replayable demo that cycles through queued/searching/reading/writing/done; it is not a live provider call.
- Stats, three-step explanation, three feature cards, provider pills.
- Footer with Privacy, Terms, Cookies, Data processors, Security, Status, Contact and Licenses, “Keys encrypted at rest” and “No training by Beamling.”
- `prefers-reduced-motion` skips the demo animation.

## Accessibility and responsive behavior

- The mobile sidebar is a focus-trapped dialog drawer.
- The mobile source panel is a focus-trapped bottom sheet.
- The settings modal uses tab roles, arrow-key tab navigation, `aria-selected`, and panels.
- The chat thread has a polite live region for stage announcements; tokens are not announced individually.
- The mascot is hidden from assistive technology; stage text carries the state.
- Focus-visible outlines are defined globally.
- Streaming animation respects reduced motion in the mascot and landing demo.
- Touch targets and 360 px layout are handled by the responsive CSS.
- The E2E suite runs axe-core on `/`, `/chat`, `/onboarding`, `/welcome`, `/privacy`, `/terms`, `/licenses`, `/cookies`, `/subprocessors`, `/security`, `/status` and `/contact` and fails on serious or critical violations.

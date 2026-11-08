# Browser application

## Routes and pages

| Route | Current behavior |
|---|---|
| `/` | Signed out: landing page ([below](#landing-page)), CTAs to `/login`. Signed in: the app (new question). Signing out is the only way back to the landing page. `/` and `/chat/:id` share `app/(app)/layout.tsx`, which checks terms and setup and mounts the shell |
| `/login` | Google-only sign-in; returns to the requested page (default `/`). Start failures redirect back with `auth_unavailable` or `login_rate_limited` instead of JSON. Says terms are accepted after sign-in and Beamling is 18+. During a scheduled shutdown it shows the closing date and that new accounts are closed; after it, that Beamling has shut down, with no sign-in button. `service_closing` and `service_closed` have their own copy |
| `/welcome` | Terms acceptance ([Terms acceptance](accounts.md#terms-acceptance)), not indexed. Signed out → `/login`; already current → `next`. Badge "Before you start" (new) or "Updated terms" (version change), three points (AI answers can be wrong, user owns provider keys and costs, data encrypted and exportable), checkboxes "I am at least 18 years old." and "I accept the Terms and have read the Privacy notice", Accept and Sign out, and a note that unaccepted accounts are deleted after seven days |
| `/onboarding` | Two steps (model key, search key) after picking a path; redirects to `/` once setup is complete |
| `/chat/:id` | A conversation; signed-out visitors go to `/login`. The app loads workspace state, conversation list and threads. During a scheduled shutdown a banner shows the closing date and a "Download my data" button (Settings → Account) |
| `/chat/[id]` | Conversation; newest 60 messages, then earlier pages |
| `/limits` | Signed in only, not indexed, rendered per request. Storage, chats and hourly/daily question meters, the five largest chats (decrypted titles, size, questions) and the rules (including images per question and their browser retention). Linked from the sidebar and from `STORAGE_FULL`/`CONVERSATION_FULL` answer errors |
| `/privacy` | GDPR Art. 13/14 notice: controller, data and legal bases, retention (below), providers on the user's accounts (some in China), transfers (hosting in Belgium, database in Frankfurt), Art. 15–21 rights, Garante complaints |
| `/terms` | Alpha terms: 18+, user owns keys, costs and provider choice, storage limits, acceptable use, MIT source (name and logo not licensed), liability limits, 24-month inactive deletion, closure with 14 days' notice, DSA contact, `LEGAL_GOVERNING_LAW` with consumer forum |
| `/cookies` | Essential cookies only (session: 30 days idle, 90 days max); no analytics or ad cookies |
| `/subprocessors` | "Data processors": DPA processors (Google Cloud, Neon, optional PostHog Cloud, email via `LEGAL_MAIL_PROVIDER`) and user-chosen providers (Google sign-in, OpenRouter, DeepSeek, Brave, Tavily, Exa) |
| `/security` | Security controls, sessions, audit events, disclosure policy with safe harbor |
| `/contact` | Operator details, privacy/security/abuse contact, DSA contact point and illegal-content reports |
| `/status` | Readiness of app, database, schema and KMS; scheduled shutdown date or shut-down notice |
| `/licenses` | MIT statement with source link, then the third-party inventory from `packages/web/lib/generated/licenses.json` |
| `/.well-known/security.txt` | RFC 9116 contact ([Endpoints](api.md#endpoints)) |
| `/api/health` | Cached readiness: database, schema, KMS |
| `/api/live` | DB-free liveness probe |
| `/robots.txt` | Allows `/`; disallows `/chat/`, `/limits`, `/onboarding`, `/api/` |

Privacy-page retention: conversations 60 days after the last question, max 100 per account (least recently used unpinned go first), 10 MB per account; inactive accounts 24 months; unaccepted accounts 7 days; sessions 30 days idle / 90 max; hashed IPs and counters one hour; logs `LEGAL_LOG_RETENTION_DAYS`; backups `LEGAL_BACKUP_RETENTION_DAYS`; analytics until opt-out; everything on a closing date.

- Metadata base and landing demo host come from `APP_URL`.
- Legal pages read operator details from `legalDetails()` and dates from `LEGAL_LAST_UPDATED`. The source URL is `SOURCE_URL` in `lib/legal.ts`.

## Client state

`StoreProvider` (`lib/store/`) exposes the workspace through two contexts, so components re-render only for what they read:

- `useAccount()` (`account.tsx`): user, settings, credentials, load status and their actions, sign-out, account deletion. Settings, onboarding and the shell use only this, so streamed text does not re-render them.
- `useConversations()` (`conversations.tsx`): summaries, count, threads, pagination, message updates.
- `threads.ts`: pure thread-merge helpers.

Behavior:

- Loads `/api/state` on mount; 401 → `/login`. Any `TERMS_REQUIRED` response → `/welcome?next=<current path>`.
- Loads threads lazily when a conversation route mounts.
- Merges a refreshed newest page with loaded earlier pages, dropping provisional copies and keeping local failures.
- Request sequence numbers stop a slow older response overwriting a newer one; conversations created or deleted mid-refresh are tracked.
- The sidebar shows a skeleton until the first load, and an inline retry if a later refresh fails.
- Topbar and Account panel share one avatar component. Google pictures render only from a validated `https://*.googleusercontent.com` URL.
- Streaming deltas are batched per animation frame.

`AnswerStreamsProvider` owns live answers:

- One live answer per conversation; it survives client-side navigation between conversations.
- A full page navigation aborts the connection; the server stores the answer as stopped.
- `visibleMessages()` hides stored streaming rows while a live answer replaces them.
- A stored `streaming` row from another tab or load is followed by polling the thread every 4 seconds.
- If the connection fails before a message id arrives, the UI reloads the thread. If nothing was stored, it keeps a local failed pair that can be retried without duplicating the question.
- If a retry fails before `meta`, the stored answer gets the error; no duplicate card.

## Setup and onboarding

Setup is complete with a model key (OpenRouter or DeepSeek) and a search key (Brave, Tavily, Exa or DeepSeek) not marked `invalid`. One DeepSeek key counts for both (`setupState` in `lib/provider-catalog.ts`).

- Signed in, `/` redirects to `/onboarding` until setup is complete, and back once it is. Later changes happen in Settings → Models and Search.
- Opening `/`, saving a key and deleting one run `alignDefaults`: a default model or search provider without a key moves to the first keyed option. `POST /api/credentials` and `DELETE /api/credentials/{id}` return the resulting `settings`.
- Two paths: **Quick setup** ("An OpenRouter free model and Brave Search.") uses `FREE_LLM_MODEL` and Brave, and notes that limits and data use follow OpenRouter's terms. **Use my own providers** offers every allowlisted model and search provider.
- Step 1 saves the model key and model; step 2 saves the search key, writes the defaults and routes to `/`. If one provider serves both, step 1 finishes setup.
- An account with a model key starts at step 2. A saved key shows "Key saved." with placeholder "Saved · paste a new key to replace it"; leave it empty to keep it.
- Brave's plan (default `Free · 1 request/second`), expiry and budget sit under "Plan, expiry and budget", all user-declared. Brave and Exa show "Validate the key now".
- "Get a key" opens the provider dashboard in a new tab. Key inputs are masked with a show/hide toggle. A rejected key keeps the step open.
- The header has **Sign out**, and "Not continuing? Delete your account" opens the same deletion form as Settings, so an account without keys can leave.
- If keys are deleted mid-visit, the empty chat shows "A key is missing." with an "Add a key" button.

## Chat view

`components/chat-view.tsx` composes `components/chat/`: `ChatTopbar`, `useSourcesPanel` (selected source, panel or sheet), `useThreadScroll` (follows new text until the user scrolls up) and `useFollowStoredAnswer` (polls an answer written elsewhere).

- **Header**: title, mode, model, search provider, source-count button, avatar.
- **Sidebar**: title search over loaded pages, Pinned section, Today/Yesterday/Previous (UTC), pin/unpin, delete confirmation, **Select chats** (checkboxes, select all, one confirmed delete for the selected chats on screen; a search hides and excludes the others), "Show older conversations", Limits, Settings, email, sign-out. Retention note: "Chats are deleted 60 days after their last question." From 90 conversations it adds "N of 100 chats. New chats replace the oldest unpinned ones." as a highlighted status.
- **Thread**: user bubbles, answer cards, working card, earlier-messages button, empty, not-found and load-error states.
- **Composer**: image button, paste or drop for up to 4 images ([Images](#images)), textarea growing to 190 px, Enter sends, Shift+Enter adds a newline, Quick/Deep/Deeper control, model badge, search-provider selector (unkeyed ones marked "· no key"), Stop while busy. Hint: "Answers are AI-generated with your keys and can be wrong. Check the sources." Sending is not blocked client-side; the server's `CREDENTIAL_MISSING` shows the "Key needed" card.
- **Answer card**: streamed markdown, citation buttons, **Searches** and **Model reasoning** panels (collapsed, also live), an "Uncited" badge when no valid citation survives, stopped/error/truncated/degraded/partial-search notices, and retry on the latest failed or stopped answer. The no-sources answer is its fixed text, no extra notice. Footer: model, search provider, total cost and time, copy and sources buttons; tooltips show the actual model and host, tokens and cost split (generation from OpenRouter or DeepSeek token estimate, search from list price).
- **Source panel**: right pane on desktop, focus-trapped bottom sheet on mobile; count, provider badge (from the stored answer), title, domain, date, snippet, link.
- **Working card**: mascot, stage label, detail string, skeleton or streaming body, Stop.
- **Stop**: the client asks the server to stop, waits for confirmation and keeps the partial answer.

The AI-generated disclosure appears in the composer hint, the welcome step and the terms.

Markdown is intentionally small:

- Headings `##`–`####`, paragraphs, lists, blockquotes, horizontal rules, fenced code.
- GitHub tables with alignment, inline formatting and horizontal scroll.
- Inline code, bold, italics, links. No raw HTML.
- Links must be `http:`/`https:` **and** match a retrieved source URL exactly; others render as plain text. This blocks model-authored phishing links.
- `[n]` is a citation button only when `n` is within the source count.
- Citation clicks use event delegation on `data-citation`.

Dialogs render into `document.body`, so the sidebar's backdrop filter and the drawer's animation cannot clip them.

## Images

- The browser decodes the image, scales it to at most 1,568 px on the long side and re-encodes it as WebP (JPEG where WebP encoding is missing), at most 1.5 MB. Re-encoding drops metadata such as location.
- Each image is kept in IndexedDB (`beamling-images`) with its conversation for 7 days (`IMAGE_RETENTION_DAYS`), and sent with follow-ups whose history window includes its question (at most 4, newest first; questions that never reached the server are skipped, as on the server). Expired images are never sent, and are deleted at the next app load.
- The image limit and retention are listed in the `/limits` rules, and in the privacy notice.
- Questions show thumbnails from this browser; once expired, or in another browser, an image placeholder ("No longer available").
- Local images are also deleted with their conversation once the server confirms the delete (including when the cap removes it), on sign-out and on account deletion.
- A model without `vision` (`lib/provider-catalog.ts`) disables the image button; attached images then show "<model> cannot read images. Change model" and block sending. Unknown model ids follow the default model, as on the server. Every current catalog model reads images.

## Settings and account

Settings is a modal with three keyboard-navigable tabs:

| Tab | Behavior |
|---|---|
| Models | Default mode, then one card per model provider (OpenRouter, DeepSeek): its key, then its models as radio buttons that set the default model, disabled until the key is saved (a rejected key counts as none), and its notice. Keys of removed providers are listed as unsupported, delete only |
| Search | One card per search provider; the card's radio button sets the default search provider and is disabled without a key. Brave, Tavily and Exa carry their key; DeepSeek uses the key from Models |
| Account | Google name/email, conversation and key counts, session lifetime (30 days idle, 90 days max), sign out, sign out everywhere; "Your data" with **Download my data** (`GET /api/account/export`) and **Exclude me from product analytics** (`PATCH /api/settings { analyticsOptOut }`); delete account by typing `DELETE`; links to terms and privacy |

Each key block shows "No key yet" with a link to get one and **Add key**, or the masked last four, status, plan, declared expiry/budget, estimated spend and warnings with **Replace**, **Validate**, **Delete** and, for Brave, **Limits**. Brave and Exa keys can be saved without validation. Credential errors on an answer open Models, or Search for search-plan errors.

Deleting the account hard-deletes server data and the wrapped workspace key, clears the store and cookie, and routes to `/`.

## Landing page

Rendered per request, so the CSP nonce is injected and CTAs follow the session (a failed lookup renders signed out).

- Dark theme, Inter and JetBrains Mono.
- Hero with a scripted, replayable demo (queued → searching → reading → writing → done); no live provider call.
- "Get started in three steps": Google sign-in, an OpenRouter key, a Brave key, each with a dashboard link. The copy makes no claims about provider plans, limits or privacy.
- Modes, four principles, provider pills, FAQ (cost, own keys, limits and billing, other models, data location), final CTA with the mascot.
- Nav: Setup, How it works, FAQ; "Sign in" and "Get started". Footer: product links, source repository, Privacy, Terms, Cookies, Data processors, Security, Status, Contact, Licenses.
- `prefers-reduced-motion` skips the demo animation.

## Installable app

Beamling can be installed to a phone or desktop home screen and opens without browser chrome.

- `app/manifest.ts` serves `/manifest.webmanifest`: standalone display, start URL `/`, dark theme and background, 192 and 512 px icons plus a maskable 512 px icon.
- iOS uses `apple-touch-icon.png` and the `apple-mobile-web-app-*` tags from the root layout metadata.
- `components/service-worker.tsx` registers `public/sw.js` in production builds. Offline, a page load shows `public/offline.html`; nothing else works offline.

## Accessibility and responsive behavior

- Mobile sidebar and source panel are focus-trapped dialogs.
- Settings uses tab roles, arrow-key navigation and `aria-selected`.
- A polite live region announces stages, not tokens.
- The mascot is hidden from assistive tech; stage text carries the state.
- Global focus-visible outlines; reduced motion respected in the mascot and demo.
- Touch targets and 360 px layout via responsive CSS.
- E2E runs axe-core on `/` (signed out and signed in), `/limits`, `/onboarding`, `/welcome`, `/privacy`, `/terms`, `/licenses`, `/cookies`, `/subprocessors`, `/security`, `/status` and `/contact`, failing on serious or critical violations.

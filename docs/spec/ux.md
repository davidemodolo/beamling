# UI and UX

## Routes

**Implemented**

| Route | Purpose |
|---|---|
| `/` | Landing page with free-start path and FAQ; CTAs go to `/chat`, which routes to setup if keys are missing |
| `/onboarding` | Free path or own providers, then model key and search key |
| `/chat` | New conversation; signed-in only |
| `/chat/[id]` | Conversation with pagination |
| `/login` | Google-only sign-in; then `/onboarding` or `/chat` |
| `/welcome` | Terms and 18+ confirmation; shown again when terms change |
| `/privacy`, `/terms`, `/cookies`, `/subprocessors`, `/security`, `/contact`, `/status` | Legal/status pages; legal review pending |
| `/licenses` | MIT statement and generated third-party inventory |
| `/.well-known/security.txt` | RFC 9116 contact |

**Public-launch target**

| Route | Purpose |
|---|---|
| `/support` | Optional donation page, outbound Tipeee/PayPal links |
| `/supporters` | Opt-in donor list |

Landing, sign-in, welcome and legal pages share a footer: Privacy, Terms, Cookies, Data processors, Security, Status, Contact, Licenses. Docs and support links are target.

## Layout

```text
+--------------------------------------------------------------------------------------+
| Beamling            [ Quick | Deep ]                               [ avatar ]    |
+----------------------+-----------------------------------------------+---------------+
| + New question       |  Q: What changed in the EU AI Act in 2026?    | Sources (8)   |
|                      |                                               |               |
| Today                |  A: The Act entered into force in August      | 1. EU AI Act  |
|   EU AI Act          |     2026 [1]. Compliance deadlines begin      |    example.org|
|   Rust async         |     in February 2027 [2][4].                  |    snippet... |
|                      |                                               | 2. ...        |
| Yesterday            |  Sources conflict: two outlets disagree on    |               |
|   Naples weather     |  the exact obligations for GPAI models [3][5].|               |
|                      |                                               |               |
|                      |  ------------------------------------------------------------- |
|                      |  [ Ask a question...                               ] [ Send ] |
+----------------------+-----------------------------------------------+---------------+
```

## Components

- **AnswerCard:** streamed markdown, citation chips, conflict notes, controls; collapsed panels **Searches** (query, status, result count) and **Model reasoning** (provider text only).
- **CitationChip:** numbered, focusable, highlights its source card.
- **SourceCard:** favicon, title, domain, date, snippet, link.
- **SourcePanel:** collapsible on desktop, bottom sheet on mobile, with count.
- **ModelBadge:** selected model, plus resolved model and upstream provider when different.
- **UsageLine:** per answer: tokens in/out, reported generation cost, estimated Brave cost, search count, latency. No session meter.
- **KeyCard:** last four, status dot, last validation, revalidate/replace/delete.
- **ModelPicker:** native select of the six allowlisted OpenRouter models (one free); no search or prices.
- **WorkingBeamling:** animated mascot with the real stage label and progress; the only progress indicator.
- **EmptyState:** mascot, headline, composer prompt.

## Answer states

| State | UI | Beamling |
|---|---|---|
| Queued | Input locked, skeleton shimmer | Curious; thinking; beams on |
| Searching | "Searching with {provider}", real Deep progress | Focused; searchlight sweep; beams on |
| Reading | Source skeletons | Focused; reading saccades; beams on |
| Writing | Streaming text, blinking cursor | Neutral; typing flickers; beams off |
| Done | Full answer, stable citations | Happy, idle |
| Stopped | Partial text, "Stopped" marker, "Ask again" (new answer, no resume) | Sleepy, idle |
| No sources | Insufficient-sources notice, no invented answer | Confused, idle |
| Error | Card with code, message, retry | Sad, idle |

### Search animation contract

- The mascot is the visible state machine, not a spinner.
- `queued` renders on submit, before the network resolves (target ≤ 100 ms).
- Stages change only on server `stage`/`progress` events. No fake timers, percentages or delays.
- `searching` shows the provider and, in Deep, `completed / total`. A sub-query only if user-safe; never hidden reasoning.
- `reading` starts when results arrive and are being assembled; skeletons resolve on `sources`.
- `writing` starts on the first `delta`; beams stop before it.
- New source: `pulse(0.25)`; valid citation: `pulse()`. No layout shift.
- One mascot engine per answer; never unmount between stages.
- Compositor animation where possible; never block SSE parsing, rendering or scrolling.
- `prefers-reduced-motion`: same labels, expressions and beams; no eye motion, pulses or shimmer. Nothing conveyed by motion alone.
- Mascot is `aria-hidden`; the stage label goes to the polite live region, throttled.
- A stream ending without `done` goes to `error` or `stopped`; never animate forever.

## Accessibility

- Streaming text: `aria-live="polite"` summary, not every token.
- Citation chips and source cards are labeled buttons.
- The source panel is a landmark with a heading.
- Focus returns to the input when an answer ends. Moving focus to the answer on start is target.
- Motion respects `prefers-reduced-motion`; status stays clear without it.
- Body text contrast ≥ 4.5:1.

## Mobile

- Sidebar → drawer.
- Source panel → bottom sheet with drag handle.
- Input fixed at bottom with safe-area padding.
- Citation chips ≥ 44 px tall.

## Welcome page, legal surface and consent (public-launch target)

The "welcome page" is the public marketing page at `/` (distinct from the `/welcome` terms step). Current content: [technical reference](../reference/index.md).

**Welcome page**

- Primary CTA "Start free"; secondary "How it works", "Docs", "Status".
- Plainly explain: BYOK (OpenRouter or DeepSeek, plus Brave/Tavily/Exa/DeepSeek search), keys encrypted at rest, questions go to the selected providers, not end-to-end encrypted, free alpha.
- No fake testimonials, counts, benchmarks, "private" claims, unpermitted logos or autoplay video.
- Short "What Beamling is not": not a lawyer or doctor, not a search index.
- Footer on every public page: Privacy, Terms, Cookies, Licenses, Subprocessors, Security, Contact/Abuse, Support, Status, Docs, Report an issue.
- `/welcome` requires 18+ confirmation and Terms/Privacy acceptance via two unticked checkboxes; no pre-checked marketing consent. Implemented.

Content order:

1. Hero: ask, see the sources. One CTA, one secondary link.
2. How it works: connect a model key, pick a search provider, ask, inspect sources.
3. Why BYOK: your keys and costs, no shared account, encrypted at rest.
4. Your data: content encryption, visible metadata, no E2E, deletion and retention; links to Privacy and Subprocessors.
5. Providers: OpenRouter, Brave, Tavily, Exa, each linking its terms; no implied partnership.
6. Alpha limits: cost depends on your providers, answers can be wrong, no professional advice, no page fetching.
7. FAQ and footer.

**Layout and performance:** responsive, WCAG 2.2 AA, reduced-motion safe; LCP < 2.5 s on throttled 4G.

**Legal pages**

- Routes: `/privacy`, `/terms`, `/cookies`, `/licenses`, `/subprocessors`, `/security`, `/contact` (or `/abuse`).
- Privacy: controller and contact, purposes and legal bases, data categories, Google identity data (subject, email, name, avatar), session cookie, encrypted content, visible metadata, server-side PostHog, subprocessors, donation links and supporters page, transfers, retention, deletion, rights, complaint authority, no sale of data, no E2E.
- Terms: BYOK and provider costs, storage limits (60 days, 100 conversations per account), acceptable use, no professional advice, IP, alpha availability, liability, termination, ≥ 14 days' notice of closure, governing law.
- Cookies: session cookie (essential, HttpOnly, Secure, SameSite=Lax, 30 days idle, 90 days max after sign-in); no analytics cookies; CMP cookies if enabled.
- A lawyer reviews legal text before public launch.

**Support and supporters**

Rules are in [Donations](business.md#donations-post-public-optional). On the UI side: plain outbound links only (no widget, iframe, script, SDK or webhook, no Beamling cookie); `/supporters` is static from `content/supporters.json`; no ranking or pressure copy; no ads at launch. Hard caps stay in [Spend guardrails, alerts and killswitch](quality-ops.md#spend-guardrails-alerts-and-killswitch-target).

**Open-source licenses**

- `/licenses` is generated from the production dependency graph: package, version, license, repository, notices.
- Allowlist: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, OFL-1.1. GPL, AGPL, SSPL and unknown fail CI until reviewed.
- Include Inter and JetBrains Mono OFL notices and Apache NOTICE files.
- States that Beamling is MIT, links the repo and `LICENSE`, then lists third-party packages. The name and logo are not licensed.
- Links the public issue tracker.

**Current checkout:** `pnpm licenses:check` enforces the allowlist in CI. 177 packages with notices and one text per license. `caniuse-lite` has a reviewed CC-BY-4.0 exception; Sharp is excluded (unused), so LGPL libvips is not shipped. No public docs/feedback repo yet.

**Consent and the popup**

- The session cookie is essential; PostHog is server-side and cookie-free. No client analytics SDK.
- No blocking banner while nothing non-essential exists; a notice and footer link suffice.
- If a non-essential script is added, use an EU CMP: **Iubenda** (default) or **Cookiebot** free tier. No custom banner.
- Banner: equal **Accept all** / **Reject all**, no pre-ticked boxes or cookie wall, granular categories, scripts blocked until consent, remembered choice, withdrawal link, accessible, no dark patterns, consent log, re-consent every ≤ 12 months.
- The CMP is a subprocessor if it handles personal data. Add its domains to CSP `script-src`, `connect-src` (and `frame-src` if needed). The page works if the CMP fails.
- Never gate the product on non-essential cookies.
- Donation links load no provider script; any future embed is non-essential and goes through the CMP and subprocessor list.

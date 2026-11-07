# UI and UX

## Routes

**Implemented**

| Route | Purpose |
|---|---|
| `/` | Public marketing landing page; CTA to onboarding or chat |
| `/onboarding` | One-screen OpenRouter + Brave key setup, Brave plan and optional key limits, and default model |
| `/chat` | New conversation; requires a signed-in account |
| `/chat/[id]` | Conversation view with pagination |
| `/login` | Google-only sign-in page; redirects to `/onboarding` or `/chat` after callback |
| `/welcome` | Terms acceptance and 18+ confirmation before the app; shown again when the terms change |
| `/privacy`, `/terms`, `/cookies`, `/subprocessors`, `/security`, `/contact`, `/status` | Implemented legal/status surface; legal review still required |
| `/licenses` | MIT license statement and generated third-party license inventory with package notices and license texts |
| `/.well-known/security.txt` | RFC 9116 security contact |

**Public-launch target**

| Route | Purpose |
|---|---|
| `/support` | Optional donation page with outbound Tipeee/PayPal links |
| `/supporters` | Opt-in public list of donors |

The landing page, sign-in, welcome and legal pages share a footer with Privacy, Terms, Cookies, Data processors, Security, Status, Contact and Licenses. Public docs and support links remain target work.

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

- **AnswerCard:** streamed markdown, citation chips, conflict notes, controls, plus two collapsed-by-default panels: **Searches** (query, status, result count) and **Model reasoning** (provider-supplied text only).
- **CitationChip:** numbered chip, keyboard-focusable, highlights the source card on activation.
- **SourceCard:** favicon, title, domain, date, snippet, external link.
- **SourcePanel:** collapsible on desktop, bottom sheet on mobile, shows source count.
- **ModelBadge:** selected model plus the resolved OpenRouter model and upstream provider when they differ.
- **UsageLine:** tokens in/out, provider-reported generation cost, estimated Brave cost, search count and latency. It is per answer; there is no cumulative session meter.
- **KeyCard:** masked last four, status dot, last validation time, revalidate, replace and delete actions.
- **ModelPicker:** a native select with the five allowlisted OpenRouter models; no search field or price hints.
- **WorkingBeamling:** the animated mascot plus the current real stage label and progress. It is the only progress indicator.
- **EmptyState:** mascot, headline and composer prompt.

## Answer states

| State | UI | Beamling |
|---|---|---|
| Queued | Input locked, skeleton answer shimmer | Curious; thinking; search beams on |
| Searching | "Searching with {provider}" plus real progress for Deep | Focused; searchlight eye sweep; beams on |
| Reading | Source skeletons appear in the panel | Focused; reading saccades; beams on |
| Writing | Streaming text with a blinking cursor | Neutral; small typing flickers; beams off |
| Done | Full answer and stable citations | Happy, idle |
| Stopped | Partial text plus a "Stopped" marker and an "Ask again" action that starts a new answer (it does not resume the partial one) | Sleepy, idle |
| No sources | "Insufficient sources" notice, no invented answer | Confused, idle |
| Error | Error card with code, message, and a retry action | Sad, idle |

### Search animation contract

- The mascot is the visible state machine. It is not a decorative loading spinner.
- On submit, the client renders `queued` immediately, before the network request resolves. Target: visible within 100 ms.
- The client changes stage only on server `stage` or `progress` events. Do not fake timers, fake percentages or synthetic "thinking" delays.
- `searching` shows the selected search provider and, in Deep, `completed / total` searches. It may show the current sub-query only if it is user-safe; never show hidden reasoning.
- `reading` starts when the selected provider's results have arrived and the server is ranking and assembling them. Source skeletons resolve as `sources` arrives.
- `writing` starts on the first model `delta`. Search beams stop before the first token.
- Each newly arrived source triggers a subtle `pulse(0.25)`; each valid citation triggers `pulse()`. Pulses must not shift layout.
- The mascot component must not unmount between stages. Keep one engine instance for the lifetime of the answer.
- Animation runs on the compositor where possible; no animation may block SSE parsing, markdown rendering or scrolling.
- With `prefers-reduced-motion`, keep the same state labels, expressions and beam visibility but remove continuous eye motion, pulses and shimmer. No information may be conveyed by motion alone.
- The mascot is `aria-hidden`; the stage label is announced through the existing polite live region with throttling, not on every frame.
- If the stream ends without `done`, transition to `error` or `stopped`, never leave the animation running indefinitely.

## Accessibility

- Streaming text is announced through an `aria-live="polite"` region with a summary, not every token.
- Citation chips and source cards are buttons with descriptive labels.
- The source panel is a landmark region with a heading.
- Current code returns focus to the input when a live answer ends. Moving focus to the answer when generation starts is target behavior.
- All animations respect `prefers-reduced-motion`; status remains understandable with motion disabled.
- Minimum contrast ratio 4.5:1 for body text.

## Mobile

- Sidebar becomes a drawer.
- Source panel becomes a bottom sheet with a drag handle.
- Input fixed at the bottom with safe-area padding.
- Citation chips remain tappable at 44 px minimum height.

## Welcome page, legal surface and consent (public-launch target)

The current checkout has a marketing landing page at `/`, `/login`, a `/welcome` terms-acceptance step for signed-in accounts, and implemented privacy, terms, cookies, data processors, security, contact and status pages with a shared footer. The "welcome page" below is the public marketing page, currently served at `/`. This section describes the target public surface; the implemented landing content is documented in the [technical reference](../reference/index.md).

**Welcome page**

- One primary CTA: "Start free". Secondary links: "How it works", "Docs" and "Status".
- Explain in plain language: BYOK, OpenRouter or DeepSeek plus Brave/Tavily/Exa/DeepSeek, keys encrypted at rest, questions go to the selected providers, the service is not end-to-end encrypted, and the alpha is free.
- No fake testimonials, user counts, benchmarks, "private" claims or provider logos without permission. No autoplay video.
- A short "What Beamling is not": not a lawyer or doctor, not its own search index.
- The global footer on every public page links to: Privacy Policy, Terms of Service, Cookie Policy, Open-source licenses, Subprocessors, Security, Contact/Abuse, Support, Status, Docs and "Report an issue".
- Before onboarding, `/welcome` asks the user to confirm they are 18 or older and to accept the Terms and acknowledge the Privacy notice, with links and two unticked checkboxes. No pre-checked marketing consent. Implemented.

Content order:

1. Hero: "Ask anything. See exactly where the answer comes from." One primary CTA and one secondary link.
2. How it works: connect your OpenRouter key, choose a search provider, ask, inspect the sources.
3. Why BYOK: your keys, your provider costs, no shared account, keys encrypted at rest.
4. What happens to your data: content encryption, visible metadata, the no-E2E boundary, deletion and retention; link to Privacy and Subprocessors.
5. Launch providers: OpenRouter, Brave, Tavily and Exa, each linking to its own terms/privacy; no implied partnership.
6. Honest alpha limits: cost depends on the user's providers, answers can be wrong, no professional advice, no page fetching.
7. FAQ and footer: free alpha, supported models/providers, data deletion, reporting issues, status, legal and licenses.

**Layout and performance**

- Responsive, WCAG 2.2 AA, reduced-motion safe; LCP target under 2.5 s on a throttled 4G profile.

**Legal pages**

- Routes: `/privacy`, `/terms`, `/cookies`, `/licenses`, `/subprocessors`, `/security`, `/contact` (or `/abuse`).
- Privacy Policy covers controller and contact, purposes and legal bases, data categories, Google identity data (subject, email, name, avatar), the essential session cookie, encrypted content, visible metadata, server-side PostHog events, providers/subprocessors, donation links and the opt-in supporters page, international transfers, retention, deletion, rights, complaint authority, no sale of data and the no-E2E boundary.
- Terms cover BYOK and provider terms and costs, conversation storage limits (60 days, 100 per account), acceptable use, no professional advice, IP, availability and alpha status, liability, termination, closure of the service with at least 14 days' notice, and governing law.
- Cookie Policy lists the session cookie (essential, HttpOnly, Secure, SameSite=Lax, 30 days without use and at most 90 days after sign-in), states that there are no analytics cookies, and lists CMP cookies if a CMP is enabled.
- Legal text is a reviewed draft, not blindly generated copy. A lawyer reviews it before public launch.

**Support and supporters**

- `/support` is optional and post-public. It explains what donations cover, shows the current monthly target, and links out to **Tipeee** (primary) or **PayPal.me** (fallback). Confirm fees and payout terms before publishing.
- Use plain outbound links. Do not embed a Tipeee/PayPal widget, iframe or script; do not add a payment SDK or webhook. Donation links set no Beamling cookie.
- `/supporters` is a static, opt-in list generated from `content/supporters.json`. Publish display name or handle, optional link and optional short message only. Never publish amounts, tiers, emails, legal names or anonymous donors' identities without specific consent.
- Consent is specific and revocable. Record the exact text approved; honor removal requests promptly. Do not scrape Tipeee or PayPal. No ranking by amount and no pressure copy.
- Do not promise that donations fund infrastructure automatically. Payouts are manual or scheduled; cloud bills are charged separately. Keep the hard caps in [Spend guardrails, alerts and killswitch (target)](quality-ops.md#spend-guardrails-alerts-and-killswitch-target).
- No ads at launch. Any ad box later needs a separate privacy, CMP, security and UX review.

**Open-source licenses**

- `/licenses` is generated from the production dependency graph at build or release time. It lists package, version, license, repository and required notices.
- Allowlist: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 and OFL-1.1. GPL, AGPL, SSPL and unknown licenses fail CI until reviewed.
- Include Inter and JetBrains Mono OFL notices and any Apache-2.0 NOTICE files.
- Beamling itself is open source under the MIT License. The page says so, links to the source repository and the `LICENSE` file, and then lists the third-party packages, each under its own license. The Beamling name and logo are not licensed for use in other services.
- Link to the public issue tracker.

**Current checkout:** `pnpm licenses:check` reads the production dependency graph, applies the allowlist and fails CI on an unreviewed license. The committed inventory contains 177 packages, package notices and one full text per license. `caniuse-lite` has a reviewed CC-BY-4.0 exception for build-time browser data. Sharp is deliberately excluded as an unused optional dependency, so the LGPL libvips binary is not shipped. The public docs/feedback repository does not exist yet.

**Consent and the popup**

- The session cookie is essential and exempt from consent. PostHog is server-side and cookie-free, so do not load a client-side analytics SDK.
- Do not show a blocking cookie banner while no non-essential cookies or scripts exist. Show a cookie notice and footer link instead.
- If a non-essential script is added (client analytics, marketing, embedded media), use a reputable EU CMP: **Iubenda** as the default (Italian/EU, policy plus cookie solution), or **Cookiebot** free tier if policies are drafted separately. Do not build a custom banner.
- The banner must make **Accept all** and **Reject all** equally prominent, use no pre-ticked boxes or cookie wall, offer granular categories, block non-essential scripts until consent, remember consent, provide a withdrawal link, be keyboard and screen-reader accessible, avoid dark patterns, and keep a consent log. Re-consent at least every 12 months.
- The CMP is a subprocessor if it processes personal data. Add it to the subprocessor list and privacy policy. Update CSP `script-src`, `connect-src` and, if needed, `frame-src` for the CMP domains. The page must still work if the CMP fails to load.
- Do not use the essential session cookie as a marketing hook and do not condition access to the product on accepting non-essential cookies.
- Donation links are outbound and load no provider script. Do not embed Tipeee or PayPal; if that ever changes, treat it as a non-essential script and add the provider to the CMP and subprocessor list.

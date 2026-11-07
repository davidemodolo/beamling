# Business model and metrics

## Business Model

At launch Beamling is free. Users sign in with Google, connect their own keys, and use the product without a paywall.

- No paid plan, no billing code, and no payment provider integration at launch. Post-public donation links are outbound only.
- Users pay their model and search providers directly. Beamling never touches token billing.
- The free product exists to establish retention and word of mouth before any monetization.
- Donations and a donor page are optional post-public additions; ads are not part of the public launch.

Monetization is explicitly deferred. Options to evaluate once usage data exists, in rough order of preference:

1. **Hosted subscription.** A paid tier for power features (higher Deep limits, longer history, exports, sharing) while BYOK remains required.
2. **Prepaid credits.** Users buy credits that Beamling spends on their behalf through Beamling-owned provider accounts, removing the BYOK requirement for non-technical users.
3. **Token resale.** Beamling buys provider capacity wholesale and resells it with a margin. This is the most operationally and legally complex option and is not a launch consideration.

Constraints on any future monetization:

- No silent markup on keys the user supplies.
- The free tier must remain genuinely usable.
- No lock-in: users can always bring their own keys and export their data.

### Donations (post-public, optional)

Donations are the chosen support mechanism if fixed infrastructure costs need help. They are optional, post-public and never gate a feature.

- **Primary: Tipeee.** EU/Italy-friendly and handles one-time or recurring support. **Fallback: PayPal.me.** Use plain outbound links; no embedded widget, iframe, script, API or webhook. Confirm current fees and payout terms before publishing.
- Place "Support Beamling" in the footer and on `/support`; do not interrupt chat with modals, banners or nag screens.
- `/support` explains what donations cover (domain, hosting, Neon, KMS, monitoring), shows the current monthly target, and states that donations are voluntary and do not buy features, priority, influence or data.
- No billing code, no card data and no payment webhooks. Tipeee and PayPal are external; Beamling receives no payment credentials.
- Do not promise automatic funding. Platform payouts are manual or scheduled and cloud bills are charged separately. Keep the hard caps in [Spend guardrails, alerts and killswitch (target)](quality-ops.md#spend-guardrails-alerts-and-killswitch-target). At near-zero scale, donations are symbolic, not a funding guarantee. If donations exceed costs, keep a reserve rather than raising caps automatically.
- **No ads at launch.** An ad box is not part of the public launch. Adding ads later requires a separate privacy, CMP, security and UX review; it is not a default monetization path.

**Supporters page**

- `/supporters` lists only donors who explicitly opt in to public display. Store a manually curated `content/supporters.json`; no backend and no payment-data import.
- Publish display name or handle, optional link and optional short message. Never publish amounts, tiers, emails, legal names or anonymous donors' identities.
- Consent is specific and revocable: the donor confirms the exact text to publish; removal requests are honored promptly. Do not scrape Tipeee or PayPal.
- No ranking by amount, no "top donors", no pressure copy. Link the page from `/support`; the footer links to `/support`, not to the chat.

---

## Metrics (target)

| Metric | Definition | Target |
|---|---|---|
| Activation | First sign-in to first cited answer | 70% of new accounts |
| Time to first answer | First visit to first rendered answer | Under 3 minutes median |
| Quick time to first token | Request to first streamed token | Under 3 seconds p95 |
| Deep time to first progress | Submit to first truthful `stage`/`progress` event | Under 1 second p95 |
| Deep completion | Submit to final `done` | Under 45 seconds p95, 90 seconds max |
| Uncited answers | Completed answers with zero valid citations | Under 2% |
| Provider cost accuracy | Recorded cost versus OpenRouter and selected search-provider invoices | Within 5% |
| D7 retention | Users active on day 7 after first visit | 35% |
| D30 retention | Users active on day 30 | 20% |
| Queries per active user | Weekly average | 8 or more |
| Citation click-through | Answers with at least one citation click | 25% |
| Weekly active users | Users asking at least one question in a week | Growth over 12 weeks |
| Provider error rate | Non-200 provider responses | Under 2% |
| NPS | In-product survey | 40 or more |

Guardrail metrics: credential validation failures, key decryption errors, rate-limit incidents, support tickets per 100 users.

### Usage analytics service (target)

The checkout implements the event contract below; the PostHog project, dashboards and alerts are operator setup. Alpha 1 target uses **PostHog Cloud EU (Frankfurt)** for internal product analytics and usage dashboards. It is the cheapest suitable option: the free plan includes **1,000,000 analytics events per month**, one project, one year of retention, no credit card, and it stops accepting events at the free limit instead of charging. Beamling does not operate an always-on analytics service.

**Scope**

- Internal operator analytics only. No customer-facing usage dashboard in Alpha 1. A personal `/usage` page is P1 and reads from the application database, not PostHog.
- Server-side events only. No PostHog browser SDK, autocapture, session replay, heatmaps, surveys or feature flags in Alpha 1.
- Analytics is best-effort and must never block, delay or fail a chat request. Events are queued with a short timeout and dropped on failure. `ANALYTICS_ENABLED=false` is the kill switch.
- Local, test and preview environments do not send events by default.

**Events and allowed properties**

| Event | When | Allowed properties |
|---|---|---|
| `account_created` | First successful Google sign-in for a new account | `app_version` |
| `question_asked` | Chat request accepted | `mode`, `search_provider`, `llm_model`, `app_version` |
| `answer_completed` | `done` emitted | `mode`, `search_provider`, `llm_model`, `resolved_model`, `upstream_provider`, `tokens_in`, `tokens_out`, `cost_usd`, `search_cost_usd`, `search_requests`, `search_failures`, `latency_ms`, `uncited`, `no_sources`, `degraded` |
| `answer_failed` | Error emitted | `mode`, `search_provider`, `llm_model`, `error_code`, `latency_ms`, `search_failures` |
| `answer_stopped` | User stops a stream | `mode`, `search_provider`, `latency_ms` |
| `credential_added` | Credential validated and saved | `kind`, `provider`, `status` |
| `credential_validation_failed` | Provider rejects a key | `kind`, `provider`, `error_code` |
| `search_provider_selected` | Default provider changed | `search_provider`, `previous_provider` |

Rules:

- `distinctId = HMAC-SHA256(userId, ANALYTICS_SALT)` truncated to 32 hex characters. No email, IP address, session token or raw user ID is sent. Keep `ANALYTICS_SALT` stable for the life of the project; rotating it breaks deletion by hash for older events.
- PostHog IP capture and GeoIP are disabled. No geolocation, device fingerprint or page URL.
- Never send questions, answers, conversation titles, source URLs, source titles, snippets, credential plaintext, error messages or provider-request bodies. `error_code` is allowed; `error_message` is not.
- Cost fields record whether the value is provider-reported or estimated. PostHog dashboards keep actual and estimated costs separate.
- Analytics must tolerate PostHog being unavailable: no retries that block requests, no user-visible errors.

**Dashboards and alerts**

- DAU/WAU/MAU, activation, questions/day, Quick vs Deep, search-provider share, model mix, error rate by code, p50/p95 latency, tokens and cost per answer, cost per active workspace, D1/D7 retention and event volume.
- PostHog alerts cover activation, error-rate and usage anomalies. Sentry or Better Stack remains the source for exceptions and uptime; the Google Cloud budget alert, the Cloud Run instance cap and Neon's plan limits remain the source for spend guardrails. PostHog is not the billing or SLO source of truth.
- Keep the project on the free plan or set a **$0 billing limit** so events are dropped rather than billed. Monitor event volume; if it approaches 1,000,000/month, reduce event cardinality or sample before upgrading.
- PostHog access: EU project, 2FA, least-privilege members, no shared logins; review members quarterly.

**Privacy and lifecycle**

- PostHog is a subprocessor. Publish it in the subprocessor list, link its DPA and privacy policy, and document the EU region and legal basis before launch.
- The server-side events use no cookies. If a browser SDK, session replay or client-side analytics is added later, consent is required first.
- Free-plan event retention is one year. Do not send special-category or user content.
- Account deletion also deletes the PostHog person/events for the hashed `distinctId`; the hash is computed from the user ID, so no additional mapping table is needed.
- Legal review of the DPA, retention and consent basis is required before public launch.

**Why this service**

- PostHog is product analytics, not page analytics. Google Analytics, Plausible and Umami would not answer DAU, funnels, retention or per-answer cost questions.
- Metabase, Grafana and a custom admin dashboard would add an always-on service and engineering time. PostHog's free tier is cheaper and sufficient for the alpha.
- A user-facing usage page is still built from the application database; PostHog is internal only.

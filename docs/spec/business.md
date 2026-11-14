# Business model and metrics

## Business Model

Free at launch: sign in with Google, bring your own keys, no paywall.

- No paid plan, billing code or payment integration. Post-public donation links are outbound only.
- Users pay their model and search providers directly; Beamling never touches token billing.
- The goal is retention and word of mouth before monetization.
- Donations and a donor page are optional post-public additions; no ads at launch.

Monetization is deferred. Options, in order of preference:

1. **Hosted subscription:** power features (higher Deep limits, longer history, exports, sharing); BYOK still required.
2. **Prepaid credits:** Beamling spends credits through its own provider accounts, removing BYOK for non-technical users.
3. **Token resale:** wholesale capacity resold at a margin. Most complex; not a launch consideration.

Constraints:

- No silent markup on user keys.
- The free tier stays genuinely usable.
- No lock-in: users can always bring their own keys and export data.

### Donations (post-public, optional)

The chosen support mechanism if fixed costs need help. Never gates a feature.

- **Tipeee** primary, **PayPal.me** fallback, as plain outbound links: no widget, iframe, script, API or webhook. Check fees and payout terms before publishing.
- "Support Beamling" in the footer and on `/support`; no modals, banners or nags in chat.
- `/support` lists what donations cover (domain, hosting, Neon, KMS, monitoring), shows the monthly target, and says donations are voluntary and buy no features, priority, influence or data.
- No billing code, card data or payment webhooks.
- Don't promise automatic funding; payouts and cloud bills are separate. Hard caps stay in [Spend guardrails, alerts and killswitch](quality-ops.md#spend-guardrails-alerts-and-killswitch-target). Surplus goes to a reserve, not higher caps.
- **No ads at launch.** Ads later need a separate privacy, CMP, security and UX review.

**Supporters page**

- `/supporters` lists only donors who opt in, from a hand-curated `content/supporters.json`; no backend or payment import.
- Show display name or handle, optional link and short message. Never amounts, tiers, emails, legal names or anonymous donors.
- Consent covers the exact text and is revocable; honor removals promptly. Never scrape Tipeee or PayPal.
- No ranking, "top donors" or pressure copy. Linked from `/support`.

---

## Metrics (target)

| Metric | Definition | Target |
|---|---|---|
| Activation | First sign-in to first cited answer | 70% of new accounts |
| Time to first answer | First visit to first rendered answer | < 3 min median |
| Quick time to first token | Request to first token | < 3 s p95 |
| Deep time to first progress | Submit to first truthful `stage`/`progress` | < 1 s p95 |
| Deep completion | Submit to `done` | < 45 s p95, 180 s max |
| Uncited answers | Completed answers with no valid citation | < 2% |
| Provider cost accuracy | Recorded vs invoiced cost | Within 5% |
| D7 retention | Active on day 7 | 35% |
| D30 retention | Active on day 30 | 20% |
| Queries per active user | Weekly average | ≥ 8 |
| Citation click-through | Answers with a citation click | 25% |
| Weekly active users | Asked ≥ 1 question in a week | Growth over 12 weeks |
| Provider error rate | Non-200 provider responses | < 2% |
| NPS | In-product survey | ≥ 40 |

Guardrails: credential validation failures, decryption errors, rate-limit incidents, support tickets per 100 users.

### Usage analytics service (target)

**PostHog Cloud EU (Frankfurt)**, free plan, for internal product analytics. The event contract is implemented; project, dashboards and alerts are operator setup. Beamling runs no analytics service of its own.

**Scope**

- Internal only. A personal `/usage` page is P1 and reads the app database, not PostHog.
- Server-side events only: no browser SDK, autocapture, replay, heatmaps, surveys or flags.
- Best-effort: never blocks, delays or fails a chat. Short timeout, dropped on failure. `ANALYTICS_ENABLED=false` is the kill switch.
- Local, test and preview send nothing by default.

**Events and allowed properties**

| Event | When | Allowed properties |
|---|---|---|
| `account_created` | First sign-in of a new account | `app_version` |
| `question_asked` | Chat request accepted | `mode`, `search_provider`, `llm_model`, `images` (count), `app_version` |
| `answer_completed` | `done` emitted | `mode`, `search_provider`, `llm_model`, `resolved_model`, `upstream_provider`, `tokens_in`, `tokens_out`, `cost_usd`, `search_cost_usd`, `search_requests`, `search_failures`, `latency_ms`, `uncited`, `no_sources`, `degraded` |
| `answer_failed` | Error emitted | `mode`, `search_provider`, `llm_model`, `error_code`, `latency_ms`, `search_failures` |
| `answer_stopped` | User stops | `mode`, `search_provider`, `latency_ms` |
| `credential_added` | Key validated and saved | `kind`, `provider`, `status` |
| `credential_validation_failed` | Provider rejects a key | `kind`, `provider`, `error_code` |
| `search_provider_selected` | Default provider changed | `search_provider`, `previous_provider` |

Rules:

- `distinctId = HMAC-SHA256(userId, ANALYTICS_SALT)`, 32 hex chars. No email, IP, session token or raw user id. Never rotate `ANALYTICS_SALT` (it breaks deletion of older events).
- IP capture and GeoIP off. No geolocation, device fingerprint or page URL.
- Never send questions, answers, titles, source URLs/titles/snippets, keys, error messages or provider bodies. `error_code` yes, `error_message` no.
- Cost fields say whether they are reported or estimated; dashboards keep them apart.
- PostHog outages cause no blocking retries and no user-visible errors.

**Dashboards and alerts**

- DAU/WAU/MAU, activation, questions/day, Quick vs Deep, provider share, model mix, errors by code, p50/p95 latency, tokens and cost per answer, cost per workspace, D1/D7 retention, event volume.
- PostHog alerts on activation, error-rate and usage anomalies. Exceptions and uptime: Sentry or Better Stack. Spend: Google Cloud budget alert, Cloud Run instance cap, Neon plan limits. PostHog is not a billing or SLO source.
- Stay on the free plan or set a **$0 billing limit** so excess events are dropped. Near the free limit, reduce cardinality or sample before upgrading.
- EU project, 2FA, least-privilege members, no shared logins; quarterly member review.

**Privacy and lifecycle**

- PostHog is a subprocessor: list it, link its DPA and policy, document region and legal basis before launch.
- No cookies. Any future browser SDK or replay needs consent first.
- Never send special-category or user content.
- Account deletion deletes the PostHog person/events for the hashed `distinctId` (derived from the user id; no mapping table).
- Legal review of DPA, retention and consent basis before public launch.

PostHog was chosen because page analytics (Google Analytics, Plausible, Umami) can't answer funnel, retention or cost questions, and Metabase, Grafana or a custom dashboard would need an always-on service.

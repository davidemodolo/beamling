# Security, Privacy, and Compliance

Implemented: KMS-backed envelope encryption, hashed session tokens, `APP_URL`-anchored same-origin checks, CSP, log redaction, analytics allowlist, HMAC distinct IDs, opt-in kill switch and deletion hook. Target: CMP, counsel review, remaining legal surface.

## Threat model

| Threat | Impact | Mitigation |
|---|---|---|
| Secrets in logs | Credential compromise | Key/body redaction, allowlist logging, tests |
| Analytics metadata leak | Usage patterns exposed | Server-side allowlist, HMAC IDs, no content/keys/error text, IP/GeoIP off, EU PostHog + DPA |
| Database, backup or replica compromise | Content and credentials exposed | Per-workspace content encryption ([Workspace data encryption](keys.md#workspace-data-encryption-public-launch-target)), per-credential encryption ([Scheme](keys.md#scheme)); master key in KMS/env, not the database. Only minimized metadata is readable. |
| SSRF via fetched pages (post-alpha) | Internal network access | No fetching in Alpha 1; later: rules below |
| Prompt injection in snippets | Manipulated answers | Delimited `<source>` blocks, instruction hierarchy, no tools from content, regression set |
| XSS in model output | Session theft | Sanitized markdown, no raw HTML, link scheme allowlist |
| CSRF | Unwanted actions | SameSite cookies, `APP_URL`-anchored origin checks |
| Session theft | Data exposure | HttpOnly/SameSite/Secure cookie, 256-bit opaque token, hashed, 30-day expiry |
| Free-tier abuse | Cost exhaustion | Per-account and per-IP limits, global concurrency cap, alpha access control |
| Cost amplification | Unexpected spend | Cost estimate, ceiling warning, no silent fallbacks |
| Supply chain | Broad impact | Lockfiles, audit, secret and image scans, Dependabot, minimal image |

## SSRF rules for page fetching

Alpha 1 does not fetch pages. If a future adapter does:

- `http`/`https` only.
- Reject private, loopback, link-local, multicast, reserved ranges and `169.254.169.254` (and IPv6 equivalents).
- Pin the resolved IP (no DNS rebinding).
- Max three redirects, each re-validated.
- 10 s timeout, 5 MB cap.
- Only `text/html`, `text/plain`, `application/pdf`.
- Never forward user credentials, cookies or headers.

## Prompt injection policy

- Snippets are wrapped in numbered `<source>` blocks and treated as data; the system prompt says to ignore instructions in them.
- Sources cannot add tool calls, URLs to fetch, citation numbers or roles.
- Deep planner output is data; it cannot change the system prompt, model or search provider.
- No URL-fetch tool in Alpha 1. The server never fetches model-invented URLs; a future fetcher may only use search-provider URLs.
- No feedback or reporting surface in Alpha 1.
- A regression eval includes known injection attempts.

## Compliance

- **GDPR:** contract performance for the service; legitimate interests for security, logs and analytics. DPA, self-service export, analytics objection, account deletion, auto-deletion of inactive and never-accepted accounts. Hosted in Frankfurt; transfers under the EU-US DPF or SCCs.
- **No training:** Beamling does not train on prompts, answers or sources. Link to OpenRouter, upstream and search provider policies; do not claim end-to-end no-training.
- **OpenRouter:** disclose that it picks and may fail over between upstream providers and receives the key and prompt. Show the resolved model and upstream provider.
- **Search:** disclose that queries go to the selected provider (Brave, Tavily or Exa) and link its terms and privacy policy.
- **Subprocessors:** Google Identity, hosting, database, OpenRouter, Brave/Tavily/Exa, master key provider, PostHog EU, the CMP (Iubenda or Cookiebot) when enabled, optional error tracking, and the optional SMTP relay for the shutdown notice (named via `LEGAL_MAIL_PROVIDER`). Tipeee/PayPal are outbound links, not subprocessors, unless an embedded widget is added. No payment processor.
- **Legal pages:** see [Welcome page, legal surface and consent](ux.md#welcome-page-legal-surface-and-consent-public-launch-target). `/licenses` is generated from production dependencies; CI enforces a license allowlist. Source is MIT. Implemented: `/privacy`, `/terms`, `/cookies`, `/subprocessors`, `/security`, `/contact`, `/status`, `/.well-known/security.txt`, `/licenses`. Counsel review pending.
- **Cookies:** only the session cookie, plus the CMP consent cookie when enabled. Analytics is server-side and cookie-free. Any browser SDK, replay or marketing script loads only via the CMP after consent.
- **Age:** 18+ (or local majority), confirmed at terms acceptance. Implemented.
- **Content policy:** no illegal content, harassment, IP/privacy infringement, malware, EU AI Act Art. 5 practices, or output presented as professional medical, legal or financial advice. Reports go to a monitored address that is also the DSA single point of contact. Implemented.
- **AI transparency:** answers are labeled AI-generated in the UI and terms. Implemented.
- **Disclosure:** `/security` has a safe-harbor policy; `/.well-known/security.txt` names the contact. Implemented.

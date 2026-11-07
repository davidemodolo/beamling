# Security, Privacy, and Compliance

The current checkout protects credentials and content with KMS-backed envelope encryption, session tokens with hashing, API routes with `APP_URL`-anchored same-origin checks and CSP, and logs with query-parameter and provider-body redaction. The analytics allowlist, HMAC distinct IDs, opt-in kill switch and deletion hook are implemented; the CMP, final legal review and the remaining public legal surface are target work.

## Threat model

| Threat | Impact | Mitigation |
|---|---|---|
| Secret leakage through logs | Credential compromise | Key/body redaction, allowlist logging, automated tests |
| Analytics metadata leakage | Exposure of usage patterns | Server-side event allowlist, HMAC distinct IDs, no content/keys/error messages, IP/GeoIP disabled, EU PostHog project and DPA |
| Database, backup or read-replica compromise | Exposure of conversations, messages, sources and credentials | Application-level envelope encryption of all user content with per-workspace keys ([Workspace data encryption (public-launch target)](keys.md#workspace-data-encryption-public-launch-target)) and per-credential encryption ([Scheme](keys.md#scheme)); the master key is held in a KMS/environment, not in the database; ciphertext is useless without it. Only minimized operational metadata is readable. |
| SSRF through fetched pages (post-alpha) | Internal network access | No page fetching in Alpha 1; when enabled, use IP range blocking, DNS pinning, redirect cap and metadata endpoint blocklist |
| Prompt injection in retrieved snippets | Manipulated answers | Delimited `<source>` blocks, explicit instruction hierarchy, no tool execution from content, injection regression set |
| XSS in model output | Session theft | Sanitized markdown, no raw HTML, link scheme allowlist |
| CSRF | Unwanted actions | SameSite cookies, `APP_URL`-anchored origin checks on state changes |
| Session theft | Data exposure | HttpOnly/SameSite/Secure cookie, 256-bit opaque token, hashed at rest, 30-day expiry |
| Free tier abuse | Cost and resource exhaustion | Per-account and per-IP limits, global concurrency cap, private-alpha access controls |
| Cost amplification | User spends more than expected | Per-query cost estimate, ceiling warning, no silent fallbacks |
| Supply chain compromise | Broad impact | Lockfiles, production audit, secret scan, image scan, Dependabot, minimal runtime image |

## SSRF rules for page fetching

Alpha 1 does not fetch pages: the selected search provider returns snippets. These rules apply only when a future adapter reintroduces direct page fetching.

- Allow only `http` and `https`.
- Resolve DNS and reject private, loopback, link-local, multicast, and reserved ranges.
- Reject the cloud metadata address `169.254.169.254` and its IPv6 equivalents.
- Pin the resolved IP for the connection to prevent DNS rebinding.
- Follow at most three redirects, re-validating each hop.
- Timeout after 10 seconds; cap response size at 5 MB.
- Accept only `text/html`, `text/plain`, and `application/pdf` (v1).
- Never forward user credentials, cookies, or headers to fetched URLs.

## Prompt injection policy

- Retrieved snippets from the selected provider are always wrapped in numbered `<source>` blocks and treated as data.
- The system prompt instructs the model to ignore instructions inside sources.
- Source text cannot introduce tool calls, URLs to fetch, new citation numbers or a new role.
- Deep planner output is validated as data and cannot change the system prompt, model or search provider.
- Alpha 1 exposes no URL-fetch tool to the model. The server never fetches a URL invented by the model, and any future fetcher must only use search-provider URLs.
- Alpha 1 has no feedback or reporting surface.
- A regression eval includes injection attempts from known benchmark sets.

## Compliance

- GDPR: lawful basis is contract performance for the service and legitimate interests for security, logs and analytics; DPA available; self-service export, analytics objection and account deletion; storage limitation through automatic deletion of inactive and never-accepted accounts. Hosting is in Frankfurt; transfers rely on the EU-US Data Privacy Framework or SCCs.
- No-training claim: Beamling itself does not train on prompts, answers or sources. OpenRouter, the selected upstream model provider and the selected search provider have their own policies; link to them and do not claim end-to-end no-training.
- OpenRouter routing: disclose that OpenRouter selects and may fail over to upstream model providers, and that the user's key and prompt are sent to OpenRouter and the selected upstream provider. Display the resolved model and any upstream provider returned by OpenRouter.
- Search providers: disclose that queries go to the selected provider (Brave, Tavily or Exa); link to each provider's current terms and privacy policy. Do not repeat a training claim without linking to the current policy.
- Subprocessors: Google Identity (OIDC), hosting, database, OpenRouter, the selected search providers (Brave, Tavily, Exa), master key provider, PostHog Cloud EU, the CMP (Iubenda or Cookiebot) when enabled, optional error tracking. Publish a subprocessor list and DPAs. Tipeee/PayPal are outbound donation links, not subprocessors, because Beamling sends them no payment data; add them to the list only if an embedded widget is ever introduced. No payment processor at launch. The only email subprocessor is the optional SMTP relay for the shutdown notice, named on the data processors page through `LEGAL_MAIL_PROVIDER` when configured.
- Legal and licenses: publish the pages in [Welcome page, legal surface and consent (public-launch target)](ux.md#welcome-page-legal-surface-and-consent-public-launch-target), keep `/licenses` generated from the production dependency graph, and keep the dependency-license allowlist enforced in CI. The application source is MIT-licensed. Current checkout: implemented `/privacy`, `/terms`, `/cookies`, `/subprocessors`, `/security`, `/contact`, `/status`, `/.well-known/security.txt` and generated `/licenses`; counsel review is still required.
- Cookies: only the essential session cookie and, when a CMP is enabled, its consent-state cookie before consent. Product analytics is server-side and cookie-free. Donation links are outbound and set no Beamling cookie. If a browser SDK, session replay, marketing or other non-essential script is added, load it only through the CMP after consent; see [Welcome page, legal surface and consent (public-launch target)](ux.md#welcome-page-legal-surface-and-consent-public-launch-target). Document the legal basis.
- Age policy: 18+ (or the local age of majority if higher), confirmed at terms acceptance. Implemented.
- Content policy: no illegal content, no targeted harassment, no IP or privacy infringement, no malware or EU AI Act Art. 5 practices, no medical, legal or financial output presented as professional advice. Abuse and illegal-content reports go to a monitored address that is also the Digital Services Act single point of contact. Implemented in the terms and contact page.
- AI transparency: answers are labeled AI-generated in the interface and the terms. Implemented.
- Security disclosure: `/security` publishes a good-faith safe-harbor policy and `/.well-known/security.txt` names the contact. Implemented.

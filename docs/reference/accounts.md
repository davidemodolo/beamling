# Accounts, OIDC and sessions

Accounts come only from Google OIDC sign-in (Dex in the parity stack, same client code).

```text
GET /api/auth/login
  → rate-limit by hashed IP
  → discovery(OIDC_ISSUER)
  → encrypted transaction cookie: state, nonce, PKCE verifier, return path
  → redirect to provider

GET /api/auth/callback/google
  → verify transaction cookie and 10-minute expiry
  → PKCE code exchange; verify state, nonce, ID-token signature, issuer, audience
  → require email_verified
  → after a shutdown date: refuse (SERVICE_CLOSED)
  → upsert user by subject (no new accounts during a scheduled shutdown: SERVICE_CLOSING)
  → ensure settings and workspace data key
  → replace this browser's session, record last_seen_at
  → audit sign_in, clear transaction cookie, redirect
```

## Sign-in

- Users are keyed by `google_sub`, with verified email, optional name and avatar (shown only from a validated `https://*.googleusercontent.com` URL, else an initial).
- No passwords, magic links, OTP, other providers or account recovery.
- Production requires `OIDC_ISSUER=https://accounts.google.com`.
- Transaction cookie: JWE (`dir` + `A256GCM`) with the `oidc-transaction` HKDF subkey of `AUTH_SECRET`, 10-minute expiry, consumed before the token exchange (no replay).
- The callback is rate-limited by hashed IP (`AUTH_CALLBACKS_PER_IP_PER_HOUR`).
- A first sign-in must pass `SIGNUP_MODE`, the allowlists and the global and per-IP signup caps.
- Callback failures are logged and redirect to `/login?error=…`:

  | `error` | Cause |
  |---|---|
  | `signups_paused` | Signup cap reached or sign-ups paused |
  | `signup_not_invited` | Address not allowed |
  | `service_closing` | New account during a scheduled shutdown |
  | `service_closed` | Any sign-in after the shutdown date |
  | `auth_failed` | Anything else |

## Sessions

- Token: 32 random bytes, base64url. The database stores only its SHA-256 hex.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` until the stored expiry. Named `__Host-beamling_session` with Secure cookies, `beamling_session` otherwise.
- Expiry slides to 30 days (`SESSION_TTL_DAYS`) after the last renewal, capped at 90 days (`SESSION_MAX_AGE_DAYS`) after creation. `getCurrentUser` renews at most daily, updating `users.last_seen_at` and the cookie.
- No valid session on a protected route: `UNAUTHENTICATED` (401).
- `/chat/:id` and `/onboarding` redirect signed-out users to `/login`; `/` shows them the landing page.

## Account routes

- `POST /api/auth/logout` revokes the current session and clears the cookie; `?scope=all` revokes every session (Settings → Account → Sign out everywhere).
- `DELETE /api/account` deletes the account, its rows and wrapped workspace key, queues PostHog erasure in the same transaction and tries it once, clears the cookie and returns `{ "ok": true }` ([Data deletion](security.md#data-deletion)).
- `GET /api/account/export` downloads every stored record as JSON ([Endpoints](api.md#endpoints)).
- `POST /api/auth/test-login` exists only with `BEAMLING_TEST_AUTH=1`, `BEAMLING_FAKE_PROVIDERS=1` and a localhost `APP_URL`; otherwise `NOT_FOUND` (404). Playwright gets a new account per request context, terms accepted unless `?terms=pending`.
- Cleanup deletes expired sessions and counters, accounts idle for 24 months, and accounts without terms acceptance after 7 days ([Cleanup](conversations.md#cleanup)); after a shutdown date, every account ([Scheduled shutdown](conversations.md#scheduled-shutdown)).

## Terms acceptance

- `lib/legal.ts` defines `LEGAL_VERSION` (now `2026-11-07.2`), plus `MINIMUM_AGE = 18`, `INACTIVE_ACCOUNT_MONTHS = 24`, `UNACCEPTED_ACCOUNT_DAYS = 7`, `CONVERSATION_RETENTION_DAYS = 60`, `MAX_CONVERSATIONS = 100`, `CONVERSATION_WARNING_THRESHOLD = 90` and `SHUTDOWN_NOTICE_DAYS = 14`.
- `users.terms_version` and `users.terms_accepted_at` record acceptance. While `terms_version` ≠ `LEGAL_VERSION`, `requirePageUser` redirects pages to `/welcome?next=<path>`. `/welcome` accepts only `/`, `/chat`, `/chat/<uuid>` or `/onboarding` as `next`.
- `apiRoute` answers `TERMS_REQUIRED` (403), except routes with `requireTerms: false`: `POST /api/account/terms`, `GET /api/account/export`, `POST /api/auth/logout`, `DELETE /api/account`. The browser client then redirects to `/welcome`.
- `POST /api/account/terms` takes `{ version, confirmAge: true }`. A stale version returns `TERMS_OUTDATED` (409). Success audits `terms_accepted`.
- Bumping `LEGAL_VERSION` forces re-acceptance.

## IP handling

- `clientIpKey()` picks the IP from `X-Forwarded-For` using `TRUSTED_PROXY_HOPS` (one hop: last entry). Fewer entries than hops: `unknown`.
- The IP is HMACed with the `ip-hash` HKDF subkey of `AUTH_SECRET` and truncated to 32 characters for `rate_limits`.

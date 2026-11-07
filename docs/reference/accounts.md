# Accounts, OIDC and sessions

There is no guest workspace. Every account starts from a successful Google OIDC sign-in. The local parity stack substitutes Dex for Google but uses the same OIDC client code.

```text
GET /api/auth/login
  → rate-limit by hashed IP
  → discovery(OIDC_ISSUER)
  → signed+encrypted transaction cookie: state, nonce, PKCE verifier, return path
  → redirect to provider

GET /api/auth/callback/google
  → verify transaction cookie and 10-minute expiry
  → exchange code with PKCE, verify state, nonce, ID-token signature, issuer, audience
  → require email_verified
  → refuse sign-in after a scheduled shutdown date (SERVICE_CLOSED)
  → upsert user by OIDC subject (new accounts refused while a shutdown is scheduled: SERVICE_CLOSING)
  → ensure settings and workspace data key
  → revoke this browser's previous session, create session, record last_seen_at
  → audit sign_in, clear transaction cookie, redirect
```

Details:

- Users are keyed by the OIDC subject (`google_sub`), with verified email, optional name and avatar URL. The avatar is rendered only from a validated `https://*.googleusercontent.com` URL, with an initial fallback.
- There is no password, magic link, email OTP, other identity provider or account recovery inside Beamling. Recovery is Google's.
- The transaction cookie is a JWE (`dir` + `A256GCM`) encrypted with the `oidc-transaction` HKDF subkey of `AUTH_SECRET`; it expires after 10 minutes.
- The callback is rate-limited by hashed IP (`AUTH_CALLBACKS_PER_IP_PER_HOUR`). The transaction cookie is consumed before the token exchange, so a failed attempt cannot be replayed.
- A first sign-in is checked against `SIGNUP_MODE` and the allowlist/domain lists before the user row is created, then counts against global and per-IP signup buckets. Over the cap, the callback logs a warning and redirects to `/login?error=signups_paused`; an uninvited address gets `signup_not_invited`; a new account during a scheduled shutdown gets `service_closing`; any sign-in after the shutdown date gets `service_closed`; other callback failures redirect to `/login?error=auth_failed`.
- Production requires `OIDC_ISSUER=https://accounts.google.com`; Dex is a local-parity substitute only.
- Session token: 32 random bytes, base64url encoded.
- Stored value: SHA-256 hex of the token. The plaintext token never enters the database.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`; `Max-Age` is the time left until the stored expiry.
- Cookie name: `__Host-beamling_session` when Secure cookies are enabled; `beamling_session` otherwise.
- The session expiry slides forward while the account is used, 30 days (`SESSION_TTL_DAYS`) from the last renewal, but never past 90 days (`SESSION_MAX_AGE_DAYS`) after the session was created. `getCurrentUser` extends it when the new expiry is more than one day beyond the stored expiry, updates `users.last_seen_at` and resets the cookie. A session older than 90 days is rejected even if its stored expiry is later.
- Signing in deletes the session the browser's cookie pointed to before creating the new one, so a sign-in never leaves the previous token valid.
- Missing or expired session on a protected route returns `UNAUTHENTICATED` with HTTP 401.
- `/chat` and `/onboarding` are server-guarded and redirect to `/login` when signed out, and to `/welcome?next=…` when the account has not accepted the current terms ([Terms acceptance](#terms-acceptance)).
- `POST /api/auth/logout` revokes the current session and clears the cookie. `POST /api/auth/logout?scope=all` revokes every session of the account (Settings → Account → Sign out everywhere).
- `DELETE /api/account` deletes the account, all rows and the wrapped workspace key while queueing the PostHog erasure of the hashed analytics identity in the same transaction, makes a first erasure attempt, clears the cookie, and returns `{ "ok": true }`. See [Data deletion](security.md#data-deletion).
- `GET /api/account/export` returns every stored record of the account as a JSON download ([Endpoints](api.md#endpoints), [Data deletion](security.md#data-deletion)).
- Cleanup removes expired sessions and counters, and deletes accounts with no sign-in or session renewal for 24 months and accounts that never accepted the terms 7 days after creation ([Cleanup](conversations.md#cleanup)). After a scheduled shutdown date it deletes every account ([Scheduled shutdown](conversations.md#scheduled-shutdown)).
- `POST /api/auth/test-login` exists only when `BEAMLING_TEST_AUTH=1`, `BEAMLING_FAKE_PROVIDERS=1` and `APP_URL` is localhost. It creates a unique test account for each new request context and is used by Playwright; the account has accepted the current terms unless the request sets `?terms=pending`. Otherwise it returns `NOT_FOUND` (404).

## Terms acceptance

- `lib/legal.ts` defines `LEGAL_VERSION` (currently `2026-11-07.2`), the version of the terms and privacy notice an account must accept, plus `MINIMUM_AGE = 18`, `INACTIVE_ACCOUNT_MONTHS = 24`, `UNACCEPTED_ACCOUNT_DAYS = 7`, `CONVERSATION_RETENTION_DAYS = 60`, `MAX_CONVERSATIONS = 100`, `CONVERSATION_WARNING_THRESHOLD = 90` and `SHUTDOWN_NOTICE_DAYS = 14`.
- `users.terms_version` and `users.terms_accepted_at` record the accepted version. A new account has none.
- App pages call `requirePageUser`, which redirects to `/welcome?next=<path>` when `terms_version` differs from `LEGAL_VERSION`. `/welcome` accepts only `/chat`, `/chat/<uuid>` or `/onboarding` as `next`, and redirects there once the version matches.
- `apiRoute` refuses every API call from such an account with `TERMS_REQUIRED` (403), except routes declared with `requireTerms: false`: `POST /api/account/terms`, `GET /api/account/export`, `POST /api/auth/logout` and `DELETE /api/account`. The browser API client redirects to `/welcome` on `TERMS_REQUIRED`, so a version change while the app is open sends the user to accept it.
- `POST /api/account/terms` requires `{ version, confirmAge: true }`. A version other than `LEGAL_VERSION` returns `TERMS_OUTDATED` (409). Success stores the version and time and logs a `terms_accepted` audit event.
- Changing `LEGAL_VERSION` asks every account to accept again on its next request.

IP handling:

- `clientIpKey()` selects the IP from `X-Forwarded-For` using `TRUSTED_PROXY_HOPS` and keyed-HMACs it with the `ip-hash` HKDF subkey of `AUTH_SECRET`, so stored rate-limit keys are not enumerable from a database dump.
- With one trusted proxy, it reads the last entry; earlier entries are treated as client-controlled.
- A request with fewer forwarded entries than trusted hops is treated as `unknown`.
- The hash is truncated to 32 characters and used in `rate_limits`.
